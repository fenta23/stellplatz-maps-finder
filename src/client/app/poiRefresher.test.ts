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

// ── Static tiles for built-in filters ────────────────────────────────────────

const BUILTINS = DEFAULT_FILTERS.filter(f => f.kind === 'osm')
const withParkingOff = BUILTINS.map(f => (f.id === 'parking' ? { ...f, enabled: false } : f))
const FUEL: FilterDef = {
  id: 'u-fuel', name: 'Tankstelle', iconId: 'fuel', color: '#C62828', enabled: true, kind: 'osm',
  builtin: false, order: 100, selectors: [{ elements: ['node'], tags: [{ key: 'amenity', value: 'fuel' }] }],
}
const MANIFEST: TileManifest = {
  version: 'v1', date: '2026-10-02', cellDeg: 0.25, tiles: { parking: [], rest: [] }, attribution: '',
}

function fakeTiles(opts: { fail?: boolean } = {}) {
  const fetchTilePois = vi.fn(async (wanted: ReadonlyMap<TileLayer, readonly string[]>): Promise<readonly OsmPoi[]> => {
    if (opts.fail) throw new Error('tiles down')
    return [...wanted].flatMap(([layer, keys]) => keys.map((k, i): OsmPoi => ({
      id: i + 1, osmType: layer === 'parking' ? 'way' : 'node', type: layer === 'parking' ? 'parking' : 'campsite',
      lat: 48.12, lon: 11.57, tags: { k },
    })))
  })
  const manifest = vi.fn(async () => { if (opts.fail) throw new Error('tiles down'); return MANIFEST })
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
    expect([...tiles.fetchTilePois.mock.calls[0]![0].keys()]).toEqual(['rest', 'parking'])
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

describe('fetchSignature', () => {
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
