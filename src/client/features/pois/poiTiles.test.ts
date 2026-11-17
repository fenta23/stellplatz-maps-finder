import { describe, it, expect, vi } from 'vitest'
import { gzipSync } from 'node:zlib'
import { DEFAULT_FILTERS, type FilterDef } from '@/features/filters/filterModel.js'
import {
  createPoiTileSource, decodeTile, LEGACY_TILED_FILTER_IDS, planTileFilters, recordsToPois, tileKeysFor, tiledFilterIds,
  type TileManifest,
} from './poiTiles.js'

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

  it('a superseded refresh does not cancel downloads the next one needs (regression)', async () => {
    // Real fetch semantics: an aborted signal rejects the request.
    const inner = fakeServer(files)
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      await new Promise(r => setTimeout(r, 5))
      if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError')
      return inner(url, init)
    }) as unknown as typeof fetch & ReturnType<typeof vi.fn>
    const src = createPoiTileSource('https://tiles.test', fetchFn)
    const wanted = new Map([['rest', ['203_51']]] as const)

    const first = new AbortController()
    const p1 = src.fetchTilePois(wanted, builtins, first.signal)
    first.abort() // map moved again while manifest + tile were loading
    const p2 = src.fetchTilePois(wanted, builtins, new AbortController().signal)

    await expect(p1).rejects.toMatchObject({ name: 'AbortError' })
    expect(await p2).toHaveLength(3)
    const urls = fetchFn.mock.calls.map(c => String(c[0]))
    expect(urls.filter(u => u.endsWith('manifest.json'))).toHaveLength(1)
    expect(urls.filter(u => u.endsWith('203_51.json.gz'))).toHaveLength(1)
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

describe('tiledFilterIds', () => {
  it('is the union of the manifest filters', () => {
    const m: TileManifest = { ...MANIFEST, filters: { parking: ['parking'], food: ['restaurant', 'cafe'], rest: ['camper'] } }
    expect([...tiledFilterIds(m)].sort()).toEqual(['cafe', 'camper', 'parking', 'restaurant'])
  })

  it('falls back to the legacy set for a manifest without filters', () => {
    expect(tiledFilterIds(MANIFEST)).toBe(LEGACY_TILED_FILTER_IDS)
    expect([...LEGACY_TILED_FILTER_IDS].sort())
      .toEqual(['camper', 'campsite', 'climbing', 'dump', 'hut', 'parking', 'shelter', 'water'])
  })

  it.each([
    ['null', null], ['a string', 'parking'], ['an array', ['parking']], ['non-array values', { rest: 'camper' }],
  ])('treats a malformed filters (%s) like absent', (_n, filters) => {
    expect(tiledFilterIds({ ...MANIFEST, filters } as unknown as TileManifest)).toBe(LEGACY_TILED_FILTER_IDS)
  })

  it('an empty filters object means the tiles contain nothing', () => {
    expect(tiledFilterIds({ ...MANIFEST, filters: {} }).size).toBe(0)
  })
})

describe('planTileFilters', () => {
  const all = DEFAULT_FILTERS.filter(f => f.kind === 'osm')
  const vis = (ids: readonly string[]) => all.map(f => (ids.includes(f.id) ? { ...f, hidden: false, enabled: true } : f))
  const custom: FilterDef = { ...all[0]!, id: 'u-fuel', builtin: false }
  const LEGACY = LEGACY_TILED_FILTER_IDS
  const ids = (fs: readonly FilterDef[]) => fs.map(f => f.id)

  it('without tiles (null) everything is live and no layer is wanted', () => {
    const plan = planTileFilters([...all, custom], null)
    expect(plan.tileFilters).toEqual([])
    expect(ids(plan.liveFilters)).toEqual(ids([...all, custom]))
    expect(plan.layers).toEqual([])
  })

  it('legacy manifest: the nine existing filters are tiled, parking layer only while active', () => {
    const filters = all.filter(f => !f.hidden)
    const plan = planTileFilters(filters, LEGACY)
    expect(ids(plan.tileFilters)).toEqual(ids(filters))
    expect(plan.liveFilters).toEqual([])
    expect(plan.layers).toEqual(['parking', 'rest'])
    const off = filters.map(f => (f.id === 'parking' ? { ...f, enabled: false } : f))
    expect(planTileFilters(off, LEGACY).layers).toEqual(['rest'])
  })

  it('legacy manifest: a visible new built-in is live, its layer is not requested', () => {
    const filters = vis(['parking', 'camper', 'restaurant'])
    const plan = planTileFilters(filters, LEGACY)
    expect(ids(plan.liveFilters)).toContain('restaurant')
    expect(ids(plan.tileFilters)).not.toContain('restaurant')
    expect(plan.layers).not.toContain('food')
  })

  it('user filters are always live, in the original order next to untiled built-ins', () => {
    const restaurant = vis(['restaurant']).find(f => f.id === 'restaurant')!
    const plan = planTileFilters([custom, restaurant, ...all.filter(f => f.id === 'camper')], LEGACY)
    expect(ids(plan.liveFilters)).toEqual(['u-fuel', 'restaurant'])
    expect(ids(plan.tileFilters)).toEqual(['camper'])
  })

  it('new manifest: the new layer is wanted only while one of its filters is active', () => {
    const tiled = new Set([...LEGACY, 'restaurant', 'cafe'])
    const rest = vis(['restaurant']).find(f => f.id === 'restaurant')!
    const camper = all.find(f => f.id === 'camper')!
    expect(planTileFilters([camper, rest], tiled).layers).toEqual(['rest', 'food'])
    expect(planTileFilters([camper, { ...rest, enabled: false }], tiled).layers).toEqual(['rest'])
    expect(planTileFilters([camper, { ...rest, hidden: true }], tiled).layers).toEqual(['rest'])
  })

  it('rest is only requested when a rest-layer filter is tiled; order follows TILE_LAYER_IDS', () => {
    const tiled = new Set([...LEGACY, 'bakery', 'hotel', 'ebike_charging', 'cafe'])
    const f = vis(['bakery', 'hotel', 'ebike_charging', 'cafe']).filter(x => tiled.has(x.id) && ['bakery', 'hotel', 'ebike_charging', 'cafe'].includes(x.id))
    expect(planTileFilters(f, tiled).layers).toEqual(['supply', 'food', 'lodging', 'bike'])
  })

  it('a custom filter never pulls a layer even with a built-in-looking id', () => {
    const fake: FilterDef = { ...custom, id: 'parking' }
    expect(planTileFilters([fake], LEGACY)).toEqual({ tileFilters: [], liveFilters: [fake], layers: [] })
  })
})

describe('createPoiTileSource with additional layers', () => {
  it('lists whatever layers the manifest has and fetches them', async () => {
    const manifest: TileManifest = { ...MANIFEST, tiles: { rest: ['1_1'], food: ['1_1'] }, filters: { rest: ['camper'], food: ['restaurant'] } }
    const fetchFn = fakeServer({
      '/manifest.json': json(manifest),
      '/2026-10-02/food/1_1.json.gz': gz([['n', 7, 1, 1, { amenity: 'restaurant' }]]),
      '/2026-10-02/rest/1_1.json.gz': gz([]),
    })
    const src = createPoiTileSource('https://tiles.test', fetchFn)
    const restaurant = DEFAULT_FILTERS.find(f => f.id === 'restaurant')!
    const pois = await src.fetchTilePois(new Map([['food', ['1_1', '2_2']], ['rest', ['1_1']]]), [restaurant])
    expect(pois.map(p => p.id)).toEqual([7])
    expect(fetchFn.mock.calls.map(c => String(c[0])).sort()).toEqual([
      'https://tiles.test/2026-10-02/food/1_1.json.gz',
      'https://tiles.test/2026-10-02/rest/1_1.json.gz',
      'https://tiles.test/manifest.json',
    ])
  })

  it('accepts a legacy manifest with only parking and rest tiles', async () => {
    const src = createPoiTileSource('https://tiles.test', fakeServer({ '/manifest.json': json(MANIFEST) }))
    await expect(src.manifest()).resolves.toMatchObject({ version: '2026-10-02' })
  })
})
