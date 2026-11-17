import { describe, it, expect, vi, afterEach } from 'vitest'
import type { OsmPoi, fetchPoisAround } from '@/features/pois/OverpassClient.js'
import type { PoiTileSource, TileLayer, TileManifest } from '@/features/pois/poiTiles.js'
import { DEFAULT_FILTERS, type FilterDef } from '@/features/filters/filterModel.js'
import type { Track, TrackPoint } from '@/features/track/trackTypes.js'
import type { CorridorHit } from '@/features/track/corridor.js'
import {
  createTrackPoiLoader, MSG_CHUNKS_FAILED, MSG_LOADING, MSG_TOO_LONG, MSG_TOO_MANY,
} from './trackPoiLoader.js'

afterEach(() => { vi.useRealTimers() })

const flush = () => new Promise(r => setTimeout(r, 0))

// What main.ts hands over: visible OSM filters (the newer built-ins are hidden by default).
const ALL_BUILTINS = DEFAULT_FILTERS.filter(f => f.kind === 'osm')
const BUILTINS = ALL_BUILTINS.filter(f => !f.hidden)
const CUSTOM: FilterDef = {
  id: 'custom1', name: 'Eigener', iconId: 'parking', color: '#123456', enabled: true, kind: 'osm',
  builtin: false, order: 99, selectors: [{ elements: ['node'], tags: [{ key: 'a', value: 'b' }] }],
}

// ~22 km straight line along lat 48 (0.01° lat ≈ 1.1 km).
const SHORT: readonly TrackPoint[] = [[48, 11], [48, 11.3]]
// ~59 km → 3 Overpass chunks (25 km each at most).
const LONG: readonly TrackPoint[] = [[48, 11], [48, 11.8]]
const mkTrack = (over: Partial<Track> = {}): Track => ({
  name: 'T', source: 'gpx', points: SHORT, lengthM: 22_000, corridorM: 500, ...over,
})
const poi = (id: number, lat: number, lon: number, over: Partial<OsmPoi> = {}): OsmPoi =>
  ({ id, osmType: 'node', type: 'campsite', lat, lon, tags: {}, ...over })

const MANIFEST: TileManifest = {
  version: 'v1', date: '2026-10-02', cellDeg: 0.05, tiles: { parking: [], rest: [] }, attribution: '',
}

type TileCall = ReadonlyMap<TileLayer, readonly string[]>

function fakeTiles(opts: { pois?: (batch: number) => OsmPoi[]; failBatch?: number; failManifest?: boolean; manifest?: TileManifest } = {}) {
  const calls: TileCall[] = []
  let inflight = 0
  let maxInflight = 0
  const fetchTilePois = vi.fn(async (wanted: TileCall, _filters?: readonly FilterDef[]): Promise<readonly OsmPoi[]> => {
    const n = calls.push(wanted)
    inflight++
    maxInflight = Math.max(maxInflight, inflight)
    await Promise.resolve()
    inflight--
    if (opts.failBatch === n) throw new Error('tile down')
    return opts.pois ? opts.pois(n) : [poi(n, 48.0009, 11 + 0.01 * n)]
  })
  const manifest = vi.fn(async () => { if (opts.failManifest) throw new Error('no manifest'); return opts.manifest ?? MANIFEST })
  return { source: { manifest, fetchTilePois } satisfies PoiTileSource, calls, fetchTilePois, manifest, maxInflight: () => maxInflight }
}

type Around = typeof fetchPoisAround

function setup(opts: {
  filters?: readonly FilterDef[]
  tiles?: PoiTileSource | null
  fetchAround?: Around
} = {}) {
  const updates: Array<{ hits: readonly CorridorHit<OsmPoi>[]; done: boolean }> = []
  const setStatus = vi.fn<(t: string, e?: boolean) => void>()
  const wait = vi.fn(async (_ms: number) => {})
  const fetchAround = vi.fn<Around>(opts.fetchAround ?? (async () => []))
  let filters = opts.filters ?? BUILTINS
  const loader = createTrackPoiLoader({
    getOsmFilters: () => filters,
    ...(opts.tiles === null ? {} : opts.tiles ? { tiles: opts.tiles } : {}),
    fetchAround,
    onUpdate: (hits, done) => updates.push({ hits, done }),
    setStatus,
    wait,
  })
  return { loader, updates, setStatus, wait, fetchAround, setFilters: (f: readonly FilterDef[]) => { filters = f } }
}

const statuses = (s: ReturnType<typeof setup>['setStatus']) => s.mock.calls.map(c => c[0])

describe('tile path', () => {
  it('requests (layer, key) pairs in sequential batches of 12 and reports progress', async () => {
    const t = fakeTiles()
    const { loader, updates, setStatus } = setup({ tiles: t.source })
    await loader.load(mkTrack())
    // 16 keys × layer rest (parking is active by default? check below) → at least 2 batches
    const total = t.calls.reduce((n, c) => n + [...c.values()].reduce((m, k) => m + k.length, 0), 0)
    expect(t.calls.length).toBe(Math.ceil(total / 12))
    expect(t.calls.length).toBeGreaterThanOrEqual(2)
    for (const c of t.calls.slice(0, -1)) expect([...c.values()].flat().length).toBe(12)
    expect(t.maxInflight()).toBe(1)
    // progressive: one non-final update per batch, then the final one
    expect(updates.filter(u => !u.done)).toHaveLength(t.calls.length)
    expect(updates.at(-1)!.done).toBe(true)
    expect(updates.at(-1)!.hits.length).toBe(t.calls.length)
    expect(statuses(setStatus)).toContain(`${MSG_LOADING} (1 von ${t.calls.length})`)
    expect(statuses(setStatus)).toContain(`${MSG_LOADING} (${t.calls.length} von ${t.calls.length})`)
  })

  it('de-duplicates keys and only loads the rest layer when parking is inactive', async () => {
    const t = fakeTiles()
    const filters = BUILTINS.map(f => (f.id === 'parking' ? { ...f, enabled: false } : f))
    const { loader } = setup({ tiles: t.source, filters })
    await loader.load(mkTrack())
    const layers = new Set(t.calls.flatMap(c => [...c.keys()]))
    expect([...layers]).toEqual(['rest'])
    const keys = t.calls.flatMap(c => c.get('rest') ?? [])
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.length).toBe(16)
  })

  it('adds the parking layer while the parking filter is active', async () => {
    const t = fakeTiles()
    const filters = BUILTINS.map(f => (f.id === 'parking' ? { ...f, enabled: true, hidden: false } : f))
    const { loader } = setup({ tiles: t.source, filters })
    await loader.load(mkTrack())
    const layers = new Set(t.calls.flatMap(c => [...c.keys()]))
    expect(layers.has('parking')).toBe(true)
    expect(layers.has('rest')).toBe(true)
  })

  it('built-ins from tiles never query Overpass', async () => {
    const t = fakeTiles()
    const { loader, fetchAround } = setup({ tiles: t.source })
    await loader.load(mkTrack())
    expect(fetchAround).not.toHaveBeenCalled()
  })

  it('slider change re-filters in memory without any request', async () => {
    const t = fakeTiles({ pois: n => (n === 1 ? [poi(1, 48.0009, 11.1), poi(2, 48.0072, 11.12)] : []) })
    const { loader, updates } = setup({ tiles: t.source })
    await loader.load(mkTrack({ corridorM: 500 }))
    expect(updates.at(-1)!.hits.map(h => h.item.id)).toEqual([1])
    const calls = t.fetchTilePois.mock.calls.length
    loader.setCorridor(1000)
    expect(updates.at(-1)!.hits.map(h => h.item.id).sort()).toEqual([1, 2])
    expect(updates.at(-1)!.done).toBe(true)
    loader.setCorridor(150)
    expect(updates.at(-1)!.hits.map(h => h.item.id)).toEqual([1])
    expect(t.fetchTilePois).toHaveBeenCalledTimes(calls)
  })

  it('a failing manifest falls back to Overpass for the built-ins', async () => {
    const t = fakeTiles({ failManifest: true })
    const { loader, fetchAround } = setup({ tiles: t.source, fetchAround: async () => [poi(9, 48.0009, 11.1)] })
    await loader.load(mkTrack())
    expect(t.fetchTilePois).not.toHaveBeenCalled()
    expect(fetchAround).toHaveBeenCalledTimes(1)
    expect(fetchAround.mock.calls[0]![2]).toEqual(BUILTINS)
  })

  it('a failing tile batch falls back to Overpass for the built-ins', async () => {
    const t = fakeTiles({ failBatch: 2 })
    const { loader, fetchAround, updates } = setup({ tiles: t.source, fetchAround: async () => [poi(9, 48.0009, 11.1)] })
    await loader.load(mkTrack())
    expect(fetchAround).toHaveBeenCalled()
    expect(fetchAround.mock.calls[0]![2]).toEqual(BUILTINS)
    expect(updates.at(-1)!.hits.map(h => h.item.id)).toContain(9)
  })

  it('a tile failure caused by an abort is not a fallback', async () => {
    let rejectTile!: (e: Error) => void
    const tiles: PoiTileSource = {
      manifest: async () => MANIFEST,
      fetchTilePois: () => new Promise((_, rej) => { rejectTile = rej }),
    }
    const { loader, fetchAround, setStatus } = setup({ tiles })
    const first = loader.load(mkTrack())
    await flush()
    loader.cancel()
    rejectTile(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    await first
    expect(fetchAround).not.toHaveBeenCalled()
    expect(setStatus.mock.calls.some(c => c[1] === true)).toBe(false)
  })
})

describe('new built-in categories', () => {
  const unhide = (ids: readonly string[]) =>
    ALL_BUILTINS.filter(f => !f.hidden || ids.includes(f.id)).map(f => (ids.includes(f.id) ? { ...f, hidden: false, enabled: true } : f))
  const NEW_MANIFEST: TileManifest = {
    ...MANIFEST,
    tiles: { parking: [], rest: [], food: [] },
    filters: { parking: ['parking'], rest: ['camper', 'campsite', 'dump', 'water', 'climbing', 'hut', 'shelter'], food: ['restaurant', 'cafe'] },
  }
  const ids = (fs: readonly FilterDef[]) => fs.map(f => f.id)
  const layersOf = (t: ReturnType<typeof fakeTiles>) => [...new Set(t.calls.flatMap(c => [...c.keys()]))]

  it('legacy manifest: an untiled built-in joins the Overpass path with the user filters', async () => {
    const t = fakeTiles()
    const { loader, fetchAround } = setup({ tiles: t.source, filters: [...unhide(['restaurant']), CUSTOM] })
    await loader.load(mkTrack())
    expect(layersOf(t)).toEqual(['parking', 'rest'])
    expect(fetchAround).toHaveBeenCalled()
    for (const call of fetchAround.mock.calls) expect(ids(call[2])).toEqual(['restaurant', 'custom1'])
    for (const call of t.fetchTilePois.mock.calls) expect(ids(call[1]!)).not.toContain('restaurant')
  })

  it('legacy manifest: the nine existing filters never query Overpass (unchanged)', async () => {
    const t = fakeTiles()
    const { loader, fetchAround } = setup({ tiles: t.source })
    await loader.load(mkTrack())
    expect(fetchAround).not.toHaveBeenCalled()
  })

  it('new manifest: the new layer is loaded while its filter is active, not otherwise', async () => {
    const on = fakeTiles({ manifest: NEW_MANIFEST })
    const a = setup({ tiles: on.source, filters: unhide(['restaurant']) })
    await a.loader.load(mkTrack())
    expect(layersOf(on)).toEqual(['parking', 'rest', 'food'])
    expect(a.fetchAround).not.toHaveBeenCalled()
    for (const call of on.fetchTilePois.mock.calls) expect(ids(call[1]!)).toContain('restaurant')

    const off = fakeTiles({ manifest: NEW_MANIFEST })
    const filters = unhide(['restaurant']).map(f => (f.id === 'restaurant' ? { ...f, enabled: false } : f))
    await setup({ tiles: off.source, filters }).loader.load(mkTrack())
    expect(layersOf(off)).toEqual(['parking', 'rest'])
  })

  it('new manifest: a built-in it does not list is chunked like a user filter', async () => {
    const t = fakeTiles({ manifest: NEW_MANIFEST })
    const { loader, fetchAround } = setup({ tiles: t.source, filters: unhide(['hotel']) })
    await loader.load(mkTrack({ points: LONG, lengthM: 59_000 }))
    expect(fetchAround).toHaveBeenCalledTimes(3) // same chunking as custom filters
    for (const call of fetchAround.mock.calls) {
      expect(ids(call[2])).toEqual(['hotel'])
      expect(call[1]).toBe(530) // bucket 500 + 30 slack
    }
  })

  it('a corridor slider growth re-queries the untiled built-in (live set, not just user filters)', async () => {
    const t = fakeTiles()
    const { loader, fetchAround } = setup({ tiles: t.source, filters: unhide(['restaurant']) })
    await loader.load(mkTrack({ corridorM: 500 }))
    fetchAround.mockClear()
    loader.setCorridor(5000)
    await flush()
    expect(fetchAround).toHaveBeenCalled()
  })
})

describe('Overpass path', () => {
  it('sends custom filters in chunks, one request at a time, radius = bucket + 30', async () => {
    let inflight = 0
    let max = 0
    const fetchAround: Around = async () => {
      inflight++; max = Math.max(max, inflight)
      await flush()
      inflight--
      return []
    }
    const t = fakeTiles()
    const { loader, fetchAround: spy } = setup({ tiles: t.source, filters: [...BUILTINS, CUSTOM], fetchAround })
    await loader.load(mkTrack({ points: LONG, lengthM: 59_000, corridorM: 500 }))
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(3)
    expect(max).toBe(1)
    for (const c of spy.mock.calls) {
      expect(c[1]).toBe(530)
      expect(c[2]).toEqual([CUSTOM]) // built-ins stay on the tiles
    }
  })

  it('without a tile source everything goes through Overpass', async () => {
    const { loader, fetchAround } = setup({ tiles: null, filters: BUILTINS })
    await loader.load(mkTrack())
    expect(fetchAround).toHaveBeenCalledTimes(1)
    expect(fetchAround.mock.calls[0]![2]).toEqual(BUILTINS)
  })

  it('retries a failed chunk once after 2 s, then marks it failed and continues', async () => {
    const fetchAround: Around = async line => {
      if (line[0]![1] === 11) throw new Error('boom') // first chunk always fails
      return []
    }
    const { loader, wait, setStatus, fetchAround: spy } = setup({ tiles: null, filters: [CUSTOM], fetchAround })
    await loader.load(mkTrack({ points: LONG, lengthM: 59_000 }))
    const firstChunkCalls = spy.mock.calls.filter(c => c[0][0]![1] === 11).length
    expect(firstChunkCalls).toBe(2)
    expect(wait).toHaveBeenCalledWith(2000)
    expect(spy.mock.calls.length).toBeGreaterThan(2) // continued with the next chunks
    expect(setStatus).toHaveBeenLastCalledWith(MSG_CHUNKS_FAILED, true)
  })

  it('a chunk that succeeds on the retry is not reported', async () => {
    let n = 0
    const fetchAround: Around = async () => { if (n++ === 0) throw new Error('once'); return [] }
    const { loader, setStatus } = setup({ tiles: null, filters: [CUSTOM], fetchAround })
    await loader.load(mkTrack())
    expect(setStatus.mock.calls.some(c => c[1] === true)).toBe(false)
  })

  it('retryFailed re-requests only the failed chunks', async () => {
    let healthy = false
    const fetchAround: Around = async line => {
      if (!healthy && line[0]![1] === 11) throw new Error('boom')
      return [poi(5, 48.0009, 11.05)]
    }
    const { loader, setStatus, fetchAround: spy, updates } = setup({ tiles: null, filters: [CUSTOM], fetchAround })
    await loader.load(mkTrack({ points: LONG, lengthM: 59_000 }))
    const before = spy.mock.calls.length
    healthy = true
    setStatus.mockClear()
    await loader.retryFailed()
    expect(spy.mock.calls.length - before).toBe(1)
    expect(spy.mock.calls.at(-1)![0][0]![1]).toBe(11)
    expect(statuses(setStatus).some(s => s === MSG_CHUNKS_FAILED)).toBe(false)
    expect(updates.at(-1)!.done).toBe(true)
    // nothing failed any more → no-op
    const n = spy.mock.calls.length
    await loader.retryFailed()
    expect(spy.mock.calls.length).toBe(n)
  })

  it('a larger bucket refetches with the new radius; smaller or equal does not', async () => {
    const { loader, fetchAround } = setup({ tiles: null, filters: [CUSTOM] })
    await loader.load(mkTrack({ corridorM: 500 }))
    expect(fetchAround).toHaveBeenCalledTimes(1)
    loader.setCorridor(300)
    loader.setCorridor(500)
    await flush()
    expect(fetchAround).toHaveBeenCalledTimes(1)
    loader.setCorridor(1200)
    await flush(); await flush()
    expect(fetchAround).toHaveBeenCalledTimes(2)
    expect(fetchAround.mock.calls[1]![1]).toBe(2030)
    loader.setCorridor(800) // bucket 1000 < loaded 2000
    await flush()
    expect(fetchAround).toHaveBeenCalledTimes(2)
  })

  it('bucket growth on the tile path never touches the network', async () => {
    const t = fakeTiles()
    const { loader, fetchAround } = setup({ tiles: t.source })
    await loader.load(mkTrack({ corridorM: 500 }))
    const n = t.fetchTilePois.mock.calls.length
    loader.setCorridor(2000)
    await flush()
    expect(t.fetchTilePois).toHaveBeenCalledTimes(n)
    expect(fetchAround).not.toHaveBeenCalled()
  })

  it('skips the Overpass path over 300 km with a hint, built-ins still load', async () => {
    const t = fakeTiles()
    const { loader, fetchAround, setStatus, updates } = setup({ tiles: t.source, filters: [...BUILTINS, CUSTOM] })
    await loader.load(mkTrack({ lengthM: 350_000 }))
    expect(fetchAround).not.toHaveBeenCalled()
    expect(updates.at(-1)!.hits.length).toBeGreaterThan(0)
    expect(setStatus).toHaveBeenLastCalledWith(MSG_TOO_LONG)
  })
})

describe('status and limits', () => {
  it('reports the count when done and clears it after 3 s', async () => {
    vi.useFakeTimers()
    const t = fakeTiles({ pois: n => (n === 1 ? [poi(1, 48.0009, 11.1)] : []) })
    const { loader, setStatus } = setup({ tiles: t.source })
    await loader.load(mkTrack())
    expect(setStatus).toHaveBeenLastCalledWith('1 Ort entlang der Route')
    vi.advanceTimersByTime(3000)
    expect(setStatus).toHaveBeenLastCalledWith('')
  })

  it('delivers more than 5000 hits but warns', async () => {
    const many = Array.from({ length: 5001 }, (_, i) => poi(i + 1, 48.0005, 11 + (i % 3000) * 0.0001, { id: i + 1 }))
    const t = fakeTiles({ pois: n => (n === 1 ? many : []) })
    const { loader, updates, setStatus } = setup({ tiles: t.source })
    await loader.load(mkTrack())
    expect(updates.at(-1)!.hits.length).toBe(5001)
    expect(setStatus).toHaveBeenLastCalledWith(MSG_TOO_MANY)
  })
})

describe('concurrency', () => {
  function deferredTiles(id: number) {
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const source: PoiTileSource = {
      manifest: async () => MANIFEST,
      fetchTilePois: async () => { await gate; return [poi(id, 48.0009, 11.1)] },
    }
    return { source, release }
  }

  it('a second load drops everything of the first', async () => {
    const first = deferredTiles(1)
    const filters = BUILTINS
    const updates: Array<readonly CorridorHit<OsmPoi>[]> = []
    const setStatus = vi.fn()
    let tiles = first.source
    const loader = createTrackPoiLoader({
      getOsmFilters: () => filters, get tiles() { return tiles },
      onUpdate: hits => updates.push(hits), setStatus, wait: async () => {},
    })
    const p1 = loader.load(mkTrack())
    await flush()
    tiles = fakeTiles({ pois: () => [poi(2, 48.0009, 11.2)] }).source
    const p2 = loader.load(mkTrack())
    first.release()
    await Promise.all([p1, p2])
    const ids = updates.flatMap(h => h.map(x => x.item.id))
    expect(ids).not.toContain(1)
    expect(ids).toContain(2)
  })

  it('cancel silences every callback, including pending status clears', async () => {
    vi.useFakeTimers()
    const d = deferredTiles(1)
    const { loader, updates, setStatus } = setup({ tiles: d.source })
    const p = loader.load(mkTrack())
    await vi.advanceTimersByTimeAsync(0)
    loader.cancel()
    updates.length = 0
    setStatus.mockClear()
    d.release()
    await p
    await vi.advanceTimersByTimeAsync(10_000)
    expect(updates).toHaveLength(0)
    expect(setStatus).not.toHaveBeenCalled()
    loader.setCorridor(800) // no track → no callback
    expect(updates).toHaveLength(0)
  })

  it('cancel during the retry wait stops the retry', async () => {
    let release!: () => void
    const wait = vi.fn(() => new Promise<void>(r => { release = r }))
    const fetchAround = vi.fn<Around>(async () => { throw new Error('boom') })
    const setStatus = vi.fn()
    const loader = createTrackPoiLoader({
      getOsmFilters: () => [CUSTOM], fetchAround, onUpdate: () => {}, setStatus, wait,
    })
    const p = loader.load(mkTrack())
    await flush()
    loader.cancel()
    release()
    await p
    expect(fetchAround).toHaveBeenCalledTimes(1)
    expect(setStatus.mock.calls.some(c => c[1] === true)).toBe(false)
  })

  it('an aborted Overpass request is never reported as a failure', async () => {
    const fetchAround: Around = (_l, _r, _f, signal) => new Promise((_, rej) => {
      signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    })
    const { loader, setStatus, wait } = setup({ tiles: null, filters: [CUSTOM], fetchAround })
    const p = loader.load(mkTrack())
    await flush()
    loader.cancel()
    await p
    expect(wait).not.toHaveBeenCalled()
    expect(setStatus.mock.calls.some(c => c[1] === true)).toBe(false)
  })

  it('reload loads again for the current track with the new filters', async () => {
    const t = fakeTiles()
    const { loader, setFilters, fetchAround } = setup({ tiles: t.source })
    await loader.load(mkTrack())
    const n = t.fetchTilePois.mock.calls.length
    setFilters([...BUILTINS, CUSTOM])
    await loader.reload()
    expect(t.fetchTilePois.mock.calls.length).toBe(n * 2)
    expect(fetchAround).toHaveBeenCalledTimes(1)
  })

  it('reload without a track does nothing', async () => {
    const { loader, updates } = setup({ tiles: fakeTiles().source })
    await loader.reload()
    expect(updates).toHaveLength(0)
  })
})

describe('positionOf', () => {
  it('is null without a track', () => {
    expect(setup().loader.positionOf(poi(1, 48, 11.1))).toBeNull()
  })

  it('gives km along, km to end and offset for a POI near the track', async () => {
    const { loader } = setup({ tiles: fakeTiles().source })
    await loader.load(mkTrack({ lengthM: 22_000 }))
    const pos = loader.positionOf(poi(1, 48.0009, 11.15))!
    expect(pos.kmAlong).toBeGreaterThan(10)
    expect(pos.kmAlong).toBeLessThan(12)
    expect(pos.kmToEnd).toBeCloseTo(22 - pos.kmAlong, 5)
    expect(pos.offsetM).toBeGreaterThan(90)
    expect(pos.offsetM).toBeLessThan(110)
  })

  it('is null beyond the maximum corridor and after cancel', async () => {
    const { loader } = setup({ tiles: fakeTiles().source })
    await loader.load(mkTrack())
    expect(loader.positionOf(poi(1, 48.05, 11.15))).toBeNull() // ~5.5 km off
    loader.cancel()
    expect(loader.positionOf(poi(1, 48.0009, 11.15))).toBeNull()
  })
})

describe('reclassify (chip toggles re-assign the loaded POIs)', () => {
  const vis = (on: string[], off: string[]): FilterDef[] => DEFAULT_FILTERS
    .filter(f => on.includes(f.id) || off.includes(f.id))
    .map(f => ({ ...f, hidden: false, enabled: on.includes(f.id) }))
  const bakeryCafe = (): OsmPoi =>
    poi(9, 48.0009, 11.1, { type: 'bakery', tags: { shop: 'bakery', amenity: 'cafe' } })
  const types = (u: { hits: readonly CorridorHit<OsmPoi>[] }) => u.hits.map(h => h.item.type)

  it('assigns a bakery-café to the active café, re-assigns on reclassify() via onUpdate, no request', async () => {
    const { loader, updates, fetchAround, setFilters, setStatus } = setup({
      tiles: null, filters: vis(['cafe'], ['bakery']), fetchAround: async () => [bakeryCafe()],
    })
    await loader.load(mkTrack())
    expect(types(updates.at(-1)!)).toEqual(['cafe'])
    const n = updates.length
    const calls = fetchAround.mock.calls.length
    const statusCalls = setStatus.mock.calls.length
    setFilters(vis(['bakery', 'cafe'], []))
    loader.reclassify()
    expect(updates.length).toBe(n + 1)
    expect(updates.at(-1)!.done).toBe(true)
    expect(types(updates.at(-1)!)).toEqual(['bakery'])
    expect(fetchAround.mock.calls.length).toBe(calls)
    expect(setStatus.mock.calls.length).toBe(statusCalls)
  })

  it('is a no-op without a track', () => {
    const { loader, updates } = setup({ tiles: null })
    loader.reclassify()
    expect(updates).toHaveLength(0)
  })
})
