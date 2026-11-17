import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { OsmPoi } from '@/features/pois/OverpassClient.js'
import type { PoiTileSource, TileLayer, TileManifest } from '@/features/pois/poiTiles.js'
import { DEFAULT_FILTERS, type FilterDef } from '@/features/filters/filterModel.js'

// Shared mock fn referenced by both the module mock and the tests.
const { fetchPoisMock } = vi.hoisted(() => ({ fetchPoisMock: vi.fn() }))

vi.mock('@/features/pois/OverpassClient.js', async (orig) => ({
  ...(await orig<typeof import('@/features/pois/OverpassClient.js')>()),
  fetchPois: fetchPoisMock,
}))

import { createPoiRefresher, fetchSignature } from './poiRefresher.js'

// Each fetched area returns one POI placed at the SW corner of the queried
// region (so distinct areas → distinct ids).
function poiAt(b: { south: number; west: number }): OsmPoi[] {
  const id = Math.round(b.south * 100) * 100000 + Math.round(b.west * 100)
  return [{ id, type: 'parking', lat: b.south + 0.01, lon: b.west + 0.01, tags: {} }]
}

beforeEach(() => {
  fetchPoisMock.mockReset()
  fetchPoisMock.mockImplementation(async (b: { south: number; west: number }) => poiAt(b))
})

function makeDeps(bounds: { south: number; west: number; north: number; east: number } | null) {
  const setMarkers = vi.fn<(p: readonly OsmPoi[]) => void>()
  const setStatus = vi.fn()
  return { deps: { getBounds: () => bounds, setMarkers, setStatus, getOsmFilters: () => [] }, setMarkers, setStatus }
}

const flush = () => new Promise(r => setTimeout(r, 0))
const CITY = { south: 48.10, west: 11.55, north: 48.15, east: 11.60 }

describe('createPoiRefresher (single-query + accumulation)', () => {
  it('cold viewport → exactly one query, paints the result', async () => {
    const { deps, setMarkers } = makeDeps(CITY)
    await createPoiRefresher(deps).refresh(); await flush()
    expect(fetchPoisMock).toHaveBeenCalledTimes(1)
    expect(setMarkers.mock.calls.at(-1)![0].length).toBeGreaterThanOrEqual(1)
  })

  it('revisiting a fully-seen viewport makes no request', async () => {
    const { deps } = makeDeps(CITY)
    const r = createPoiRefresher(deps)
    await r.refresh(); await flush()
    expect(fetchPoisMock).toHaveBeenCalledTimes(1)
    fetchPoisMock.mockClear()
    await r.refresh(); await flush()
    expect(fetchPoisMock).not.toHaveBeenCalled() // served from the store
  })

  it('panning into new area queries only the uncovered strip (once)', async () => {
    let bounds = { ...CITY }
    const r = createPoiRefresher({ getBounds: () => bounds, setMarkers: vi.fn(), setStatus: vi.fn(), getOsmFilters: () => [] })
    await r.refresh(); await flush()
    expect(fetchPoisMock).toHaveBeenCalledTimes(1)
    fetchPoisMock.mockClear()
    // pan north: lower half already covered
    bounds = { south: 48.10, west: 11.55, north: 48.25, east: 11.60 }
    await r.refresh(); await flush()
    expect(fetchPoisMock).toHaveBeenCalledTimes(1)
    const queried = fetchPoisMock.mock.calls[0]![0] as { south: number; north: number }
    expect(queried.south).toBeGreaterThanOrEqual(48.15) // only the new northern strip
  })

  it('accumulates POIs across areas and clips render to the viewport', async () => {
    let bounds = { ...CITY }
    const setMarkers = vi.fn<(p: readonly OsmPoi[]) => void>()
    const r = createPoiRefresher({ getBounds: () => bounds, setMarkers, setStatus: vi.fn(), getOsmFilters: () => [] })
    await r.refresh(); await flush()
    bounds = { south: 48.20, west: 11.55, north: 48.25, east: 11.60 } // disjoint north area
    await r.refresh(); await flush()
    // viewport now only over the northern area → southern POI clipped out
    const lastMarkers = setMarkers.mock.calls.at(-1)![0]
    expect(lastMarkers.every(p => p.lat >= 48.20)).toBe(true)
  })

  it('shows an error when the fetch fails', async () => {
    fetchPoisMock.mockImplementation(async () => { throw new Error('Overpass proxy error: 503') })
    const { deps, setStatus } = makeDeps(CITY)
    await createPoiRefresher(deps).refresh(); await flush()
    expect(setStatus).toHaveBeenCalledWith(expect.any(String), true)
  })

  it('aborting (superseded refresh) does not surface an error', async () => {
    // first refresh hangs; second supersedes and aborts it
    let abortErr: Error | undefined
    fetchPoisMock.mockImplementationOnce((_b: unknown, _t: unknown, signal: AbortSignal) =>
      new Promise((_res, rej) => signal.addEventListener('abort', () => {
        abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' }); rej(abortErr)
      })))
    let bounds = { ...CITY }
    const { setStatus } = { setStatus: vi.fn() }
    const r = createPoiRefresher({ getBounds: () => bounds, setMarkers: vi.fn(), setStatus, getOsmFilters: () => [] })
    const p1 = r.refresh()
    bounds = { south: 48.20, west: 11.55, north: 48.25, east: 11.60 }
    await r.refresh(); await p1; await flush()
    expect(setStatus).not.toHaveBeenCalledWith(expect.any(String), true)
  })

  it('does not re-call setMarkers when the rendered set is unchanged', async () => {
    const { deps, setMarkers } = makeDeps(CITY)
    const r = createPoiRefresher(deps)
    await r.refresh(); await flush()
    const calls = setMarkers.mock.calls.length
    await r.refresh(); await flush() // fully covered → same set → should skip
    expect(setMarkers.mock.calls.length).toBe(calls)
  })

  it('refuses an over-wide viewport without fetching', async () => {
    const { deps, setStatus } = makeDeps({ south: 47, west: 10, north: 49, east: 12 })
    await createPoiRefresher(deps).refresh()
    expect(fetchPoisMock).not.toHaveBeenCalled()
    expect(setStatus).toHaveBeenCalledWith('Bitte weiter reinzoomen…')
  })

  it('does nothing without bounds', async () => {
    const { deps, setMarkers } = makeDeps(null)
    await createPoiRefresher(deps).refresh()
    expect(fetchPoisMock).not.toHaveBeenCalled()
    expect(setMarkers).not.toHaveBeenCalled()
  })
})

describe('createPoiRefresher suspend / resume', () => {
  it('refresh while suspended does nothing', async () => {
    const { deps, setMarkers, setStatus } = makeDeps(CITY)
    const r = createPoiRefresher(deps)
    r.suspend()
    expect(r.isSuspended()).toBe(true)
    await r.refresh(); await flush()
    expect(fetchPoisMock).not.toHaveBeenCalled()
    expect(setMarkers).not.toHaveBeenCalled()
    expect(setStatus).not.toHaveBeenCalled()
  })

  it('suspend during an in-flight refresh drops its result', async () => {
    let release!: () => void
    fetchPoisMock.mockImplementationOnce((b: { south: number; west: number }) =>
      new Promise(res => { release = () => res(poiAt(b)) })) // ignores the abort signal
    const { deps, setMarkers, setStatus } = makeDeps(CITY)
    const r = createPoiRefresher(deps)
    const p = r.refresh()
    await flush()
    setMarkers.mockClear(); setStatus.mockClear()
    r.suspend()
    release()
    await p; await flush()
    expect(setMarkers).not.toHaveBeenCalled()
    expect(setStatus).not.toHaveBeenCalled()
  })

  it('suspend cancels the pending status-clear timers of a finished refresh', async () => {
    vi.useFakeTimers()
    try {
      const { deps, setStatus } = makeDeps(CITY)
      const r = createPoiRefresher(deps)
      await r.refresh()
      setStatus.mockClear()
      r.suspend()
      vi.advanceTimersByTime(10000)
      expect(setStatus).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })

  it('after resume the same viewport is repainted without a new request (regression)', async () => {
    const { deps, setMarkers } = makeDeps(CITY)
    const r = createPoiRefresher(deps)
    await r.refresh(); await flush()
    const calls = setMarkers.mock.calls.length
    const fetches = fetchPoisMock.mock.calls.length
    r.suspend()
    r.resume()
    expect(setMarkers.mock.calls.length).toBe(calls) // resume itself does not paint
    await r.refresh(); await flush()
    expect(setMarkers.mock.calls.length).toBe(calls + 1) // same POI set, still repainted
    expect(fetchPoisMock.mock.calls.length).toBe(fetches) // caches survived
  })

  it('after resume an empty viewport is repainted too', async () => {
    fetchPoisMock.mockImplementation(async () => [])
    const { deps, setMarkers } = makeDeps(CITY)
    const r = createPoiRefresher(deps)
    await r.refresh(); await flush()
    const calls = setMarkers.mock.calls.length
    r.suspend(); r.resume()
    await r.refresh(); await flush()
    expect(setMarkers.mock.calls.length).toBe(calls + 1)
    expect(setMarkers.mock.calls.at(-1)![0]).toEqual([])
  })

  it('suspend/resume are idempotent', async () => {
    const { deps, setMarkers } = makeDeps(CITY)
    const r = createPoiRefresher(deps)
    r.resume() // not suspended → harmless
    expect(r.isSuspended()).toBe(false)
    r.suspend(); r.suspend()
    expect(r.isSuspended()).toBe(true)
    r.resume(); r.resume()
    expect(r.isSuspended()).toBe(false)
    await r.refresh(); await flush()
    expect(fetchPoisMock).toHaveBeenCalledTimes(1)
    expect(setMarkers).toHaveBeenCalled()
  })
})

// ── Static tiles for built-in filters ────────────────────────────────────────

// What main.ts hands over: visible OSM filters (the newer built-ins are hidden by default).
const ALL_BUILTINS = DEFAULT_FILTERS.filter(f => f.kind === 'osm')
const BUILTINS = ALL_BUILTINS.filter(f => !f.hidden)
const withParkingOff = BUILTINS.map(f => (f.id === 'parking' ? { ...f, enabled: false } : f))
const FUEL: FilterDef = {
  id: 'u-fuel', name: 'Tankstelle', iconId: 'fuel', color: '#C62828', enabled: true, kind: 'osm',
  builtin: false, order: 100, selectors: [{ elements: ['node'], tags: [{ key: 'amenity', value: 'fuel' }] }],
}
const MANIFEST: TileManifest = {
  version: 'v1', date: '2026-10-02', cellDeg: 0.25, tiles: { parking: [], rest: [] }, attribution: '',
}

function fakeTiles(opts: { fail?: boolean; manifest?: TileManifest } = {}) {
  const fetchTilePois = vi.fn(async (wanted: ReadonlyMap<TileLayer, readonly string[]>, _filters?: readonly FilterDef[]): Promise<readonly OsmPoi[]> => {
    if (opts.fail) throw new Error('tiles down')
    return [...wanted].flatMap(([layer, keys]) => keys.map((k, i): OsmPoi => ({
      id: i + 1, osmType: layer === 'parking' ? 'way' : 'node', type: layer === 'parking' ? 'parking' : 'campsite',
      lat: 48.12, lon: 11.57, tags: { k },
    })))
  })
  const manifest = vi.fn(async () => { if (opts.fail) throw new Error('tiles down'); return opts.manifest ?? MANIFEST })
  return { manifest, fetchTilePois } satisfies PoiTileSource
}

describe('createPoiRefresher with static tiles', () => {
  const setup = (filters: readonly FilterDef[], tiles: PoiTileSource, bounds = CITY) => {
    const setMarkers = vi.fn<(p: readonly OsmPoi[]) => void>()
    const setStatus = vi.fn()
    let current: readonly FilterDef[] = filters
    const r = createPoiRefresher({ getBounds: () => bounds, setMarkers, setStatus, getOsmFilters: () => current, tiles })
    return { r, setMarkers, setStatus, setFilters: (f: readonly FilterDef[]) => { current = f } }
  }

  it('built-ins come from tiles only — no Overpass query', async () => {
    const tiles = fakeTiles()
    const { r, setMarkers } = setup(BUILTINS, tiles)
    await r.refresh(); await flush()
    expect(fetchPoisMock).not.toHaveBeenCalled()
    expect(tiles.fetchTilePois).toHaveBeenCalledTimes(1)
    expect([...tiles.fetchTilePois.mock.calls[0]![0].keys()]).toEqual(['parking', 'rest'])
    expect(setMarkers.mock.calls.at(-1)![0].length).toBeGreaterThan(0)
  })

  it('loads no parking layer while the parking filter is off', async () => {
    const tiles = fakeTiles()
    const { r } = setup(withParkingOff, tiles)
    await r.refresh(); await flush()
    expect([...tiles.fetchTilePois.mock.calls[0]![0].keys()]).toEqual(['rest'])
  })

  it('switching parking on later loads just the parking layer', async () => {
    const tiles = fakeTiles()
    const { r, setFilters } = setup(withParkingOff, tiles)
    await r.refresh(); await flush()
    setFilters(BUILTINS)
    await r.refresh(); await flush()
    expect([...tiles.fetchTilePois.mock.calls[1]![0].keys()]).toEqual(['parking'])
  })

  it('already-loaded tiles are not fetched again', async () => {
    const tiles = fakeTiles()
    const { r } = setup(BUILTINS, tiles)
    await r.refresh(); await flush()
    await r.refresh(); await flush()
    expect(tiles.fetchTilePois).toHaveBeenCalledTimes(1)
  })

  it('a node and a way with the same id are both kept (regression)', async () => {
    const tiles = fakeTiles() // parking → way/1, rest → node/1 for the same tile
    const { r, setMarkers } = setup(BUILTINS, tiles)
    await r.refresh(); await flush()
    const keys = setMarkers.mock.calls.at(-1)![0].map(p => `${p.osmType}/${p.id}`)
    expect(keys).toContain('node/1')
    expect(keys).toContain('way/1')
  })

  it('un-hiding a built-in re-reads the loaded tiles (regression)', async () => {
    const tiles = fakeTiles()
    const { r, setFilters } = setup(BUILTINS.filter(f => f.id !== 'hut'), tiles)
    await r.refresh(); await flush()
    setFilters(BUILTINS)
    await r.refresh(); await flush()
    expect(tiles.fetchTilePois).toHaveBeenCalledTimes(2)
    expect(tiles.fetchTilePois.mock.calls[1]![1]).toEqual(BUILTINS) // classified with hut now
  })

  it('reordering built-ins re-reads the tiles (first match depends on order)', async () => {
    const tiles = fakeTiles()
    const { r, setFilters } = setup(BUILTINS, tiles)
    await r.refresh(); await flush()
    setFilters([...BUILTINS].reverse())
    await r.refresh(); await flush()
    expect(tiles.fetchTilePois).toHaveBeenCalledTimes(2)
  })

  it('user filters go to Overpass with only those filters', async () => {
    const tiles = fakeTiles()
    const { r } = setup([...BUILTINS, FUEL], tiles)
    await r.refresh(); await flush()
    expect(fetchPoisMock).toHaveBeenCalledTimes(1)
    expect(fetchPoisMock.mock.calls[0]![1]).toEqual([FUEL])
  })

  it('a new user filter loads in an already-seen area (regression)', async () => {
    const tiles = fakeTiles()
    const { r, setFilters } = setup(BUILTINS, tiles)
    await r.refresh(); await flush()
    expect(fetchPoisMock).not.toHaveBeenCalled()
    setFilters([...BUILTINS, FUEL])
    await r.refresh(); await flush()
    expect(fetchPoisMock).toHaveBeenCalledTimes(1)
    expect(fetchPoisMock.mock.calls[0]![1]).toEqual([FUEL])
  })

  it('falls back to Overpass for built-ins when the tiles fail, once per area', async () => {
    const tiles = fakeTiles({ fail: true })
    const { r, setStatus } = setup(BUILTINS, tiles)
    await r.refresh(); await flush()
    expect(fetchPoisMock).toHaveBeenCalledTimes(1)
    expect(fetchPoisMock.mock.calls[0]![1]).toEqual(BUILTINS)
    expect(setStatus).not.toHaveBeenCalledWith(expect.any(String), true)
    await r.refresh(); await flush()
    expect(fetchPoisMock).toHaveBeenCalledTimes(1) // fallback area is remembered
  })

  it('falls back when only the tile download fails (manifest ok)', async () => {
    const tiles = fakeTiles()
    tiles.fetchTilePois.mockRejectedValueOnce(new Error('tile 500'))
    const { r } = setup(BUILTINS, tiles)
    await r.refresh(); await flush()
    expect(fetchPoisMock).toHaveBeenCalledTimes(1)
    expect(fetchPoisMock.mock.calls[0]![1]).toEqual(BUILTINS)
  })
})

// ── Additional tile layers (supply/food/lodging/bike) ───────────────────────

const unhide = (ids: readonly string[]) =>
  ALL_BUILTINS.filter(f => !f.hidden || ids.includes(f.id)).map(f => (ids.includes(f.id) ? { ...f, hidden: false, enabled: true } : f))
const NEW_MANIFEST: TileManifest = {
  ...MANIFEST,
  tiles: { parking: [], rest: [], food: [], supply: [] },
  filters: {
    parking: ['parking'], rest: ['camper', 'campsite', 'dump', 'water', 'climbing', 'hut', 'shelter'],
    food: ['restaurant', 'cafe'], supply: ['toilets'],
  },
}

describe('createPoiRefresher with new built-in categories', () => {
  const setup = (filters: readonly FilterDef[], tiles: PoiTileSource) => {
    let current = filters
    const r = createPoiRefresher({
      getBounds: () => CITY, setMarkers: vi.fn(), setStatus: vi.fn(), getOsmFilters: () => current, tiles,
    })
    return { r, setFilters: (f: readonly FilterDef[]) => { current = f } }
  }
  const layersOf = (t: ReturnType<typeof fakeTiles>, call: number) => [...t.fetchTilePois.mock.calls[call]![0].keys()]

  it('legacy manifest (no filters): an un-hidden new built-in goes to Overpass with the user filters', async () => {
    const tiles = fakeTiles() // MANIFEST has no `filters`
    const filters = [...unhide(['restaurant']), FUEL]
    const { r } = setup(filters, tiles)
    await r.refresh(); await flush()
    expect(fetchPoisMock).toHaveBeenCalledTimes(1)
    expect(fetchPoisMock.mock.calls[0]![1].map((f: FilterDef) => f.id)).toEqual(['restaurant', 'u-fuel'])
    expect(layersOf(tiles, 0)).toEqual(['parking', 'rest'])
    expect(tiles.fetchTilePois.mock.calls[0]![1]!.map(f => f.id)).not.toContain('restaurant')
  })

  it('legacy manifest: only the nine existing filters visible → no Overpass (unchanged behaviour)', async () => {
    const tiles = fakeTiles()
    const { r } = setup(BUILTINS, tiles)
    await r.refresh(); await flush()
    expect(fetchPoisMock).not.toHaveBeenCalled()
  })

  it('new manifest: the layer is requested only while its filter is active, loaded once on toggle-on', async () => {
    const tiles = fakeTiles({ manifest: NEW_MANIFEST })
    const hiddenOff = unhide(['restaurant']).map(f => (f.id === 'restaurant' ? { ...f, enabled: false } : f))
    const { r, setFilters } = setup(hiddenOff, tiles)
    await r.refresh(); await flush()
    expect(layersOf(tiles, 0)).toEqual(['parking', 'rest']) // food not downloaded
    setFilters(unhide(['restaurant']))
    await r.refresh(); await flush()
    expect(tiles.fetchTilePois).toHaveBeenCalledTimes(2)
    expect(layersOf(tiles, 1)).toEqual(['food'])
    expect(fetchPoisMock).not.toHaveBeenCalled()
    await r.refresh(); await flush()
    setFilters(hiddenOff); await r.refresh(); await flush()
    setFilters(unhide(['restaurant'])); await r.refresh(); await flush()
    expect(tiles.fetchTilePois).toHaveBeenCalledTimes(2) // remembered, loaded once
  })

  it('new manifest: filters it does not list stay live', async () => {
    const tiles = fakeTiles({ manifest: NEW_MANIFEST })
    const { r } = setup(unhide(['restaurant', 'hotel']), tiles)
    await r.refresh(); await flush()
    expect(layersOf(tiles, 0)).toEqual(['parking', 'rest', 'food'])
    expect(fetchPoisMock).toHaveBeenCalledTimes(1)
    expect(fetchPoisMock.mock.calls[0]![1].map((f: FilterDef) => f.id)).toEqual(['hotel'])
  })

  it('hiding the live built-in again leaves the tiles and Overpass untouched', async () => {
    const tiles = fakeTiles()
    const { r, setFilters } = setup(unhide(['restaurant']), tiles)
    await r.refresh(); await flush()
    expect(fetchPoisMock).toHaveBeenCalledTimes(1)
    setFilters(BUILTINS)
    await r.refresh(); await flush()
    // restaurant no longer live; the remaining tile filters did not change → no new tile read, no query
    expect(fetchPoisMock).toHaveBeenCalledTimes(1)
    expect(tiles.fetchTilePois).toHaveBeenCalledTimes(1)
  })

  it('manifest down: all built-ins incl. new ones go to Overpass, tiles are not asked', async () => {
    const tiles = fakeTiles({ fail: true })
    const { r } = setup(unhide(['restaurant']), tiles)
    await r.refresh(); await flush()
    expect(tiles.fetchTilePois).not.toHaveBeenCalled()
    expect(fetchPoisMock).toHaveBeenCalledTimes(1)
    expect(fetchPoisMock.mock.calls[0]![1].map((f: FilterDef) => f.id)).toContain('restaurant')
  })

  it('a manifest that is superseded while loading does not touch the state of the newer refresh', async () => {
    let release!: () => void
    const tiles = fakeTiles()
    tiles.manifest.mockImplementationOnce(() => new Promise(res => { release = () => res(MANIFEST) }))
    const { r } = setup(BUILTINS, tiles)
    const p1 = r.refresh()
    await flush()
    const p2 = r.refresh()
    release()
    await p1; await p2; await flush()
    expect(tiles.fetchTilePois).toHaveBeenCalledTimes(1)
  })
})

describe('fetchSignature', () => {
  it('changes when a filter of any optional layer is switched on/off', () => {
    const on = unhide(['restaurant'])
    const off = on.map(f => (f.id === 'restaurant' ? { ...f, enabled: false } : f))
    expect(fetchSignature(on)).not.toBe(fetchSignature(off))
    const bike = unhide(['bike_service'])
    expect(fetchSignature(bike)).not.toBe(fetchSignature(bike.map(f => (f.id === 'bike_service' ? { ...f, enabled: false } : f))))
  })

  it('changes when parking is switched on/off or a filter is added', () => {
    const base = fetchSignature(BUILTINS)
    expect(fetchSignature(withParkingOff)).not.toBe(base)
    expect(fetchSignature([...BUILTINS, FUEL])).not.toBe(base)
  })

  it('ignores cosmetic edits and toggling non-parking filters', () => {
    const base = fetchSignature(BUILTINS)
    const cosmetic = BUILTINS.map(f => (f.id === 'camper' ? { ...f, color: '#000', name: 'X', enabled: false } : f))
    expect(fetchSignature(cosmetic)).toBe(base)
  })
})

describe('createPoiRefresher reclassify (chip toggles re-assign loaded POIs)', () => {
  const vis = (on: string[], off: string[]): FilterDef[] => DEFAULT_FILTERS
    .filter(f => on.includes(f.id) || off.includes(f.id))
    .map(f => ({ ...f, hidden: false, enabled: on.includes(f.id) }))
  const bakeryCafe = (type: string): OsmPoi =>
    ({ id: 9, osmType: 'node', type, lat: 48.12, lon: 11.57, tags: { shop: 'bakery', amenity: 'cafe' } })

  function setup() {
    let filters = vis(['cafe'], ['bakery'])
    fetchPoisMock.mockImplementation(async () => [bakeryCafe('bakery')])
    const setMarkers = vi.fn<(p: readonly OsmPoi[]) => void>()
    const r = createPoiRefresher({ getBounds: () => CITY, setMarkers, setStatus: vi.fn(), getOsmFilters: () => filters })
    return { r, setMarkers, setFilters: (f: FilterDef[]) => { filters = f } }
  }
  const last = (m: ReturnType<typeof setup>['setMarkers']) => m.mock.calls.at(-1)![0].map(p => p.type)

  it('paints a bakery-café as café while the bakery chip is off; switching it on re-assigns without a request', async () => {
    const { r, setMarkers, setFilters } = setup()
    await r.refresh(); await flush()
    expect(last(setMarkers)).toEqual(['cafe'])
    const calls = setMarkers.mock.calls.length
    fetchPoisMock.mockClear()
    setFilters(vis(['bakery', 'cafe'], []))
    r.reclassify()
    expect(setMarkers.mock.calls.length).toBe(calls + 1)
    expect(last(setMarkers)).toEqual(['bakery'])
    setFilters(vis(['cafe'], ['bakery']))
    r.reclassify()
    expect(last(setMarkers)).toEqual(['cafe'])
    expect(fetchPoisMock).not.toHaveBeenCalled()
  })

  it('does not abort an in-flight load and classifies its late result with the current chips', async () => {
    const { r, setMarkers, setFilters } = setup()
    let release!: () => void
    let sig: AbortSignal | undefined
    fetchPoisMock.mockImplementation(async (_b: unknown, _f: unknown, s?: AbortSignal) => {
      sig = s
      await new Promise<void>(res => { release = res })
      return [bakeryCafe('bakery')]
    })
    const p = r.refresh()
    await flush()
    setFilters(vis(['bakery', 'cafe'], []))
    r.reclassify()
    expect(sig?.aborted).toBe(false)
    release(); await p; await flush()
    expect(last(setMarkers)).toEqual(['bakery'])
  })

  it('while suspended it updates the store but does not paint; resume + refresh shows the new assignment', async () => {
    const { r, setMarkers, setFilters } = setup()
    await r.refresh(); await flush()
    r.suspend()
    const calls = setMarkers.mock.calls.length
    setFilters(vis(['bakery', 'cafe'], []))
    r.reclassify()
    expect(setMarkers.mock.calls.length).toBe(calls)
    r.resume()
    fetchPoisMock.mockClear()
    await r.refresh(); await flush()
    expect(last(setMarkers)).toEqual(['bakery'])
    expect(fetchPoisMock).not.toHaveBeenCalled()
  })
})
