import { describe, it, expect, vi } from 'vitest'
import { gzipSync } from 'node:zlib'
import { DEFAULT_FILTERS, type FilterDef } from '@/features/filters/filterModel.js'
import { createPoiTileSource, decodeTile, recordsToPois, tileKeysFor, type TileManifest } from './poiTiles.js'

const MANIFEST: TileManifest = {
  version: '2026-10-02', date: '2026-10-02', cellDeg: 0.25,
  tiles: { parking: ['203_51'], rest: ['203_51', '203_52'] },
  attribution: '© OpenStreetMap-Mitwirkende, ODbL',
}

const PARKING_TILE = [['w', 1, 50.8, 12.9, { amenity: 'parking' }]]
const REST_TILE = [
  ['n', 1, 50.81, 12.91, { tourism: 'camp_site', name: 'Camp' }],
  ['n', 2, 50.82, 12.92, { amenity: 'parking', motorhome: 'yes' }],
  ['n', 3, 50.83, 12.93, { tourism: 'alpine_hut' }],
]

const gz = (v: unknown) => gzipSync(JSON.stringify(v))
const toArrayBuffer = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer

function fakeServer(files: Record<string, Uint8Array | 404>) {
  return vi.fn(async (url: string | URL | Request) => {
    const path = String(url).replace('https://tiles.test', '')
    const body = files[path]
    if (body === undefined || body === 404) return new Response('not found', { status: 404 })
    return new Response(toArrayBuffer(body), { status: 200 })
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>
}

const json = (v: unknown) => new TextEncoder().encode(JSON.stringify(v))
const builtins = DEFAULT_FILTERS.filter(f => f.kind === 'osm')

describe('tileKeysFor', () => {
  it('lists every 0.25° cell a viewport touches', () => {
    expect(tileKeysFor({ south: 50.8, west: 12.9, north: 50.9, east: 13.1 }, 0.25)).toEqual(['203_51', '203_52'])
  })

  it('handles negative coordinates', () => {
    expect(tileKeysFor({ south: -0.1, west: -0.1, north: 0.1, east: 0.1 }, 0.25))
      .toEqual(['-1_-1', '-1_0', '0_-1', '0_0'])
  })
})

describe('recordsToPois', () => {
  it('classifies against the given filters in order and sets osmType', () => {
    const pois = recordsToPois(REST_TILE as never, builtins)
    expect(pois.map(p => [p.osmType, p.id, p.type])).toEqual([
      ['node', 1, 'campsite'], ['node', 2, 'camper'], ['node', 3, 'hut'],
    ])
  })

  it('drops records no current filter claims (e.g. a hidden filter)', () => {
    const noHut = builtins.filter(f => f.id !== 'hut')
    expect(recordsToPois(REST_TILE as never, noHut).map(p => p.id)).toEqual([1, 2])
  })
})

describe('decodeTile', () => {
  it('gunzips a gzip body', async () => {
    expect(await decodeTile(toArrayBuffer(gz([1, 2])))).toEqual([1, 2])
  })

  it('accepts an already-decoded body (server sent Content-Encoding: gzip)', async () => {
    expect(await decodeTile(toArrayBuffer(json([1, 2])))).toEqual([1, 2])
  })
})

describe('createPoiTileSource', () => {
  const files = {
    '/manifest.json': json(MANIFEST),
    '/2026-10-02/parking/203_51.json.gz': gz(PARKING_TILE),
    '/2026-10-02/rest/203_51.json.gz': gz(REST_TILE),
    '/2026-10-02/rest/203_52.json.gz': gz([]),
  }

  it('loads the requested layers and caches the manifest', async () => {
    const fetchFn = fakeServer(files)
    const src = createPoiTileSource('https://tiles.test/', fetchFn)
    const pois = await src.fetchTilePois(new Map([['parking', ['203_51']], ['rest', ['203_51']]]), builtins)
    expect(pois).toHaveLength(4)
    await src.fetchTilePois(new Map([['rest', ['203_52']]]), builtins)
    const manifestCalls = fetchFn.mock.calls.filter(c => String(c[0]).endsWith('manifest.json'))
    expect(manifestCalls).toHaveLength(1)
  })

  it('never requests tiles the manifest does not list', async () => {
    const fetchFn = fakeServer(files)
    const src = createPoiTileSource('https://tiles.test', fetchFn)
    expect(await src.fetchTilePois(new Map([['parking', ['999_999', '203_52']]]), builtins)).toEqual([])
    expect(fetchFn.mock.calls.map(c => String(c[0]))).toEqual(['https://tiles.test/manifest.json'])
  })

  it('after a failed manifest skips requests for a minute, then retries', async () => {
    let t = 0
    const live: Record<string, Uint8Array | 404> = { ...files, '/manifest.json': 404 }
    const fetchFn = fakeServer(live)
    const src = createPoiTileSource('https://tiles.test', fetchFn, () => t)
    await expect(src.manifest()).rejects.toThrow(/404/)
    t = 30_000
    await expect(src.manifest()).rejects.toThrow(/retry later/)
    expect(fetchFn).toHaveBeenCalledTimes(1) // no request while backing off
    live['/manifest.json'] = json(MANIFEST)
    t = 61_000
    await expect(src.manifest()).resolves.toMatchObject({ version: '2026-10-02' })
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('re-reads the manifest once when its version directory is gone (new weekly build)', async () => {
    const live: Record<string, Uint8Array | 404> = { ...files }
    const fetchFn = fakeServer(live)
    const src = createPoiTileSource('https://tiles.test', fetchFn)
    await src.manifest()
    // New build deployed: old version dir gone, new manifest points to the new one.
    live['/manifest.json'] = json({ ...MANIFEST, version: '2026-10-09' })
    live['/2026-10-02/rest/203_51.json.gz'] = 404
    live['/2026-10-09/rest/203_51.json.gz'] = gz(REST_TILE)
    const pois = await src.fetchTilePois(new Map([['rest', ['203_51']]]), builtins)
    expect(pois).toHaveLength(3)
  })

  it('rejects an invalid manifest', async () => {
    const src = createPoiTileSource('https://tiles.test', fakeServer({ '/manifest.json': json({ hello: 1 }) }))
    await expect(src.manifest()).rejects.toThrow(/invalid manifest/)
  })

  it('classifies with the caller filters (custom order respected)', async () => {
    const both = [['w', 4, 50.8, 12.9, { amenity: 'parking', tourism: 'camp_site' }]]
    const src = createPoiTileSource('https://tiles.test', fakeServer({ ...files, '/2026-10-02/rest/203_51.json.gz': gz(both) }))
    const wanted = new Map([['rest', ['203_51']]] as const)
    // Default order: parking (0) before campsite (2) — first match wins, as with Overpass.
    expect((await src.fetchTilePois(wanted, builtins))[0]?.type).toBe('parking')
    // User moved campsite to the front.
    const reordered: FilterDef[] = [...builtins].sort((a, b) => (a.id === 'campsite' ? -1 : b.id === 'campsite' ? 1 : 0))
    expect((await src.fetchTilePois(wanted, reordered))[0]?.type).toBe('campsite')
  })
})
