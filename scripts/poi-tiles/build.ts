// Build static POI tiles from a pre-filtered OSM extract.
//
//   npx tsx scripts/poi-tiles/build.ts --expressions > expressions.txt
//   osmium tags-filter in.osm.pbf -e expressions.txt -o filtered.pbf
//   npx tsx scripts/poi-tiles/build.ts filtered.pbf out/ [version]
//
// POI_TILES_MIN_<LAYER> (PARKING, REST, SUPPLY, FOOD, LODGING, BIKE): fail instead
// of writing a build with fewer POIs in that layer (guards against a silently
// broken filter step). Unset = 0.
//
// Output: out/manifest.json + out/{version}/{layer}/{key}.json.gz

import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { gzip } from 'node:zlib'
import { DEFAULT_FILTERS } from '../../src/client/features/filters/filterModel.js'
import { belowMinimum, buildManifest, LAYERS, osmiumExpressions, placeFeature, type Feature, type Layer } from './tiles.js'

const gzipAsync = promisify(gzip)

async function build(input: string, outDir: string, version: string, min: Partial<Record<Layer, number>>): Promise<void> {
  // Serialized POIs per layer → tile key. Kept as JSON strings: far less heap
  // than ~4M live objects for the whole of Europe.
  const tiles = Object.fromEntries(LAYERS.map(l => [l, new Map<string, string[]>()])) as Record<Layer, Map<string, string[]>>
  // osmium exports closed ways as both LineString (w…) and area (a…) and the same
  // element can occur in several country extracts — dedupe on the normalised OSM
  // id, per layer (an element legitimately appears once in each of its layers).
  const seen = Object.fromEntries(LAYERS.map(l => [l, new Set<string>()])) as Record<Layer, Set<string>>
  let lines = 0, kept = 0 // kept = POI placements (an element in two layers counts twice)

  const osmium = spawn('osmium', ['export', '-f', 'geojsonseq', '--add-unique-id=type_id', '-O', '-o', '-', input], {
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const exited = new Promise<number>((resolve, reject) => {
    osmium.on('error', reject)
    osmium.on('close', code => resolve(code ?? 1))
  })

  const rl = createInterface({ input: osmium.stdout, crlfDelay: Infinity })
  for await (const raw of rl) {
    // geojsonseq lines start with the RS (0x1e) record separator.
    const line = raw.charCodeAt(0) === 0x1e ? raw.slice(1) : raw
    if (!line) continue
    lines++
    const placed = placeFeature(JSON.parse(line) as Feature)
    if (!placed) continue
    const uid = `${placed.poi[0]}${placed.poi[1]}`
    let json: string | null = null
    for (const layer of placed.layers) {
      if (seen[layer].has(uid)) continue
      seen[layer].add(uid)
      json ??= JSON.stringify(placed.poi)
      const bucket = tiles[layer].get(placed.key) ?? []
      bucket.push(json)
      tiles[layer].set(placed.key, bucket)
      kept++
    }
  }
  const code = await exited
  if (code !== 0) throw new Error(`osmium export exited with ${code}`)

  const count = (l: Layer) => [...tiles[l].values()].reduce((n, p) => n + p.length, 0)
  const counts = Object.fromEntries(LAYERS.map(l => [l, count(l)])) as Record<Layer, number>
  console.log(`${lines} features read, ${kept} POI placements kept`)
  for (const l of LAYERS) console.log(`  ${l}: ${counts[l]} POIs in ${tiles[l].size} tiles`)
  const low = belowMinimum(counts, min)
  if (low.length > 0) throw new Error(`too few POIs in ${low.join(', ')} — refusing to write a broken build`)

  for (const layer of LAYERS) {
    const dir = join(outDir, version, layer)
    await mkdir(dir, { recursive: true })
    for (const [key, pois] of tiles[layer]) {
      const body = await gzipAsync(`[${pois.join(',')}]`, { level: 9 })
      await writeFile(join(dir, `${key}.json.gz`), body)
    }
  }

  const manifest = buildManifest(
    version, Object.fromEntries(LAYERS.map(l => [l, tiles[l].keys()])) as Record<Layer, Iterable<string>>, counts,
  )
  await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1))
}

const args = process.argv.slice(2)
if (args[0] === '--expressions') {
  // One per line → `osmium tags-filter -e <file>` (no shell word-splitting games).
  console.log(osmiumExpressions(DEFAULT_FILTERS).join('\n'))
} else if (args.length >= 2) {
  const version = args[2] ?? new Date().toISOString().slice(0, 10)
  // Sanity floors (CI sets them for Europe; local regional builds leave them 0).
  const min = Object.fromEntries(
    LAYERS.map(l => [l, Number(process.env[`POI_TILES_MIN_${l.toUpperCase()}`] ?? 0)]),
  ) as Record<Layer, number>
  build(args[0]!, args[1]!, version, min).catch(err => {
    console.error(err)
    process.exit(1)
  })
} else {
  console.error('usage: build.ts --expressions | build.ts <filtered.pbf> <outDir> [version]')
  process.exit(2)
}
