import { classifyElement, type FilterDef, type OsmElementKind } from '@/features/filters/filterModel.js'
import type { LatLngBounds, OsmPoi, OsmTags } from './OverpassClient.js'

// Static POI tiles for the built-in filters, built weekly from Geofabrik
// extracts (scripts/poi-tiles/) and served from the data repo's GitHub Pages.
// One small gzip per 0.25° cell and layer instead of a 9–19 s Overpass query.

export type TileLayer = 'parking' | 'rest'

export interface TileManifest {
  readonly version: string
  readonly date: string
  readonly cellDeg: number
  /** Non-empty tiles per layer — unlisted keys are empty and never requested. */
  readonly tiles: Readonly<Record<TileLayer, readonly string[]>>
  readonly attribution: string
}

/** On-disk record: [n|w|r, id, lat, lon, tags]. */
type TileRecord = readonly [string, number, number, number, OsmTags]

// A hanging tile server must not stall the refresh — the Overpass fallback takes over.
const MANIFEST_TIMEOUT_MS = 5_000
const TILE_TIMEOUT_MS = 15_000
// After a failed manifest, go straight to the Overpass fallback for a while
// instead of paying a request (or a 5 s timeout) on every pan.
const MANIFEST_RETRY_MS = 60_000

const withTimeout = (ms: number, signal?: AbortSignal): AbortSignal =>
  signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms)

const KIND: Readonly<Record<string, OsmElementKind>> = { n: 'node', w: 'way', r: 'relation' }

/** Tile keys (`floor(lat/cell)_floor(lon/cell)`) of every cell intersecting `bounds`. */
export function tileKeysFor(bounds: LatLngBounds, cellDeg: number): string[] {
  const keys: string[] = []
  for (let y = Math.floor(bounds.south / cellDeg); y <= Math.floor(bounds.north / cellDeg); y++) {
    for (let x = Math.floor(bounds.west / cellDeg); x <= Math.floor(bounds.east / cellDeg); x++) {
      keys.push(`${y}_${x}`)
    }
  }
  return keys
}

/** Classify raw tile records against the current filters (store order, first match wins). */
export function recordsToPois(records: readonly TileRecord[], filters: readonly FilterDef[]): OsmPoi[] {
  const out: OsmPoi[] = []
  for (const [t, id, lat, lon, tags] of records) {
    const osmType = KIND[t]
    if (!osmType) continue
    const type = classifyElement(tags, osmType, filters)
    if (type !== null) out.push({ id, osmType, type, lat, lon, tags })
  }
  return out
}

/**
 * Parse a tile body. GitHub Pages serves `.json.gz` as `application/gzip` (no
 * Content-Encoding) so we gunzip ourselves — but if some server/proxy already
 * sets Content-Encoding the browser has decoded it and a second gunzip would
 * throw, hence the magic-byte check.
 */
export async function decodeTile(buf: ArrayBuffer): Promise<unknown> {
  const bytes = new Uint8Array(buf)
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return JSON.parse(new TextDecoder().decode(bytes))
  const stream = new Response(bytes).body!.pipeThrough(new DecompressionStream('gzip'))
  return JSON.parse(await new Response(stream).text())
}

export interface PoiTileSource {
  /** Cached after the first success; a failure is retried after MANIFEST_RETRY_MS. */
  manifest(signal?: AbortSignal): Promise<TileManifest>
  /** Load the given tiles (unlisted ones are skipped as empty) and classify them. */
  fetchTilePois(
    wanted: ReadonlyMap<TileLayer, readonly string[]>,
    filters: readonly FilterDef[],
    signal?: AbortSignal,
  ): Promise<readonly OsmPoi[]>
}

export function createPoiTileSource(
  base: string,
  fetchFn: typeof fetch = (...a) => fetch(...a),
  now: () => number = Date.now,
): PoiTileSource {
  const root = base.replace(/\/+$/, '')
  let cached: Promise<TileManifest> | null = null
  let failedAt = -Infinity
  const listed = new Map<TileLayer, ReadonlySet<string>>()

  async function getJson(url: string, init: RequestInit): Promise<unknown> {
    const res = await fetchFn(url, init)
    if (!res.ok) throw Object.assign(new Error(`POI tiles: ${res.status} ${url}`), { status: res.status })
    return decodeTile(await res.arrayBuffer())
  }

  function manifest(signal?: AbortSignal): Promise<TileManifest> {
    if (!cached && now() - failedAt < MANIFEST_RETRY_MS) {
      return Promise.reject(new Error('POI tiles: manifest unavailable (retry later)'))
    }
    // no-cache = revalidate: picks up a new weekly build without a stale day.
    cached ??= (getJson(`${root}/manifest.json`, { cache: 'no-cache', signal: withTimeout(MANIFEST_TIMEOUT_MS, signal) }) as Promise<TileManifest>)
      .then(m => {
        if (!m?.version || !m.cellDeg || !m.tiles) throw new Error('POI tiles: invalid manifest')
        listed.clear()
        for (const layer of ['parking', 'rest'] as const) listed.set(layer, new Set(m.tiles[layer] ?? []))
        return m
      })
      .catch(err => {
        cached = null
        // A superseded refresh aborting its own request says nothing about the server.
        if (!signal?.aborted) failedAt = now()
        throw err
      })
    return cached
  }

  async function fetchTilePois(
    wanted: ReadonlyMap<TileLayer, readonly string[]>,
    filters: readonly FilterDef[],
    signal?: AbortSignal,
  ): Promise<readonly OsmPoi[]> {
    try {
      return await loadTiles(wanted, filters, signal)
    } catch (err) {
      // 404 = a new weekly build replaced our version's directory while the app
      // was open → drop the stale manifest and retry once with the new one.
      if ((err as { status?: number }).status !== 404) throw err
      cached = null
      return loadTiles(wanted, filters, signal)
    }
  }

  async function loadTiles(
    wanted: ReadonlyMap<TileLayer, readonly string[]>,
    filters: readonly FilterDef[],
    signal?: AbortSignal,
  ): Promise<readonly OsmPoi[]> {
    const m = await manifest(signal)
    const urls: string[] = []
    for (const [layer, keys] of wanted) {
      const present = listed.get(layer)
      for (const key of keys) if (present?.has(key)) urls.push(`${root}/${m.version}/${layer}/${key}.json.gz`)
    }
    const tileSignal = withTimeout(TILE_TIMEOUT_MS, signal)
    const bodies = await Promise.all(urls.map(u => getJson(u, { signal: tileSignal })))
    return bodies.flatMap(b => recordsToPois(b as TileRecord[], filters))
  }

  return { manifest, fetchTilePois }
}
