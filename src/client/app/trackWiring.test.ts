import { describe, it, expect, vi, afterEach } from 'vitest'
import { createTrackWiring, RETRY_SUFFIX, CONNECTOR_MIN_OFFSET_M, type TrackLoaderCallbacks } from './trackWiring.js'
import type { TrackPoiLoader } from './trackPoiLoader.js'
import { MSG_CHUNKS_FAILED } from './trackPoiLoader.js'
import type { OsmPoi } from '@/features/pois/OverpassClient.js'
import type { CorridorHit } from '@/features/track/corridor.js'
import type { ITrackStore } from '@/features/track/TrackStore.js'
import type { TrackLayer } from '@/features/track/TrackLayer.js'
import type { Track, TrackPoint, TrackPosition } from '@/features/track/trackTypes.js'

const track: Track = {
  name: 'Eifelrunde', source: 'gpx', points: [[50, 7], [50.1, 7.1]], lengthM: 86_432, corridorM: 500,
}

function fakeStore(initial: Track | null = null) {
  let cur = initial
  const listeners: Array<(t: Track | null) => void> = []
  const store: ITrackStore = {
    get: () => cur,
    set: t => { cur = t; listeners.forEach(l => l(t)) },
    setCorridor: m => { if (cur) { cur = { ...cur, points: cur.points.map(p => [...p] as TrackPoint), corridorM: m }; listeners.forEach(l => l(cur)) } },
    clear: () => { cur = null; listeners.forEach(l => l(null)) },
    onChange: l => { listeners.push(l); return () => {} },
  }
  return store
}

function fakeLayer() {
  const calls: string[] = []
  const layer: TrackLayer & {
    shown: readonly TrackPoint[] | null; fitArgs: Array<unknown>; connector: readonly [TrackPoint, TrackPoint] | null
  } = {
    shown: null,
    connector: null,
    showConnector(from, to) { this.connector = [from, to] },
    clearConnector() { this.connector = null },
    show(p) { this.shown = p; calls.push('show') },
    fitBounds(insets) { calls.push('fit'); this.fitArgs.push(insets) },
    fitArgs: [],
    setSatellite(on) { calls.push(`sat:${on}`) },
    clear() { this.shown = null; this.connector = null; calls.push('clear') },
  }
  return { layer, calls }
}

const poi = (id: number, type = 'campsite', name?: string): OsmPoi =>
  ({ id, osmType: 'node', type, lat: 50, lon: 7, tags: name ? { name } : {} })
const hit = (p: OsmPoi, kmAlong: number): CorridorHit<OsmPoi> =>
  ({ item: p, kmAlong, kmToEnd: 80 - kmAlong, offsetM: 120 })

function setup(initial: Track | null = null, fetchFn?: typeof fetch) {
  const container = document.createElement('div')
  const panelBox = document.createElement('div')
  document.body.append(container, panelBox)
  const store = fakeStore(initial)
  const { layer, calls } = fakeLayer()
  const flash = vi.fn()
  const order: string[] = []
  const loader = {
    load: vi.fn(async () => { order.push('load') }),
    setCorridor: vi.fn(),
    reclassify: vi.fn(),
    reload: vi.fn(async () => {}),
    retryFailed: vi.fn(async () => {}),
    cancel: vi.fn(),
    positionOf: vi.fn((): TrackPosition | null => ({ kmAlong: 1, kmToEnd: 2, offsetM: 3 })),
    footOf: vi.fn((): TrackPoint | null => [50.05, 7.05]),
  } satisfies TrackPoiLoader
  let cb!: TrackLoaderCallbacks
  const refresher = {
    suspend: vi.fn(() => { order.push('suspend') }),
    resume: vi.fn(() => { order.push('resume') }),
    refresh: vi.fn(() => { order.push('refresh') }),
  }
  const setMarkers = vi.fn<(p: readonly OsmPoi[]) => void>()
  const selectPoi = vi.fn<(p: OsmPoi) => void>()
  const active = new Set(['campsite', 'parking', 'cemetery'])
  const wiring = createTrackWiring({
    store, layer, dialogContainer: container, flash, fetchFn,
    createLoader: c => { cb = c; return loader },
    refresher, setMarkers, selectPoi,
    rowFor: p => ({ title: p.tags.name ?? 'Ort', subtitle: p.type, color: '#2e7d32', iconSvg: '<svg data-i></svg>', ...(p.type === 'cemetery' ? { hint: 'Wasser im Winter oft abgestellt' } : {}) }),
    isTypeActive: t => active.has(t),
    panelContainer: panelBox,
  })
  const q = <T extends HTMLElement>(r: string) => container.querySelector<T>(`[data-ref="${r}"]`)!
  const pq = <T extends HTMLElement>(r: string) => panelBox.querySelector<T>(`[data-ref="${r}"]`)!
  const rows = () => [...panelBox.querySelectorAll<HTMLElement>('.track-row')]
  return {
    container, store, layer, calls, flash, wiring, q, pq, loader, refresher, order, setMarkers, selectPoi, active, rows,
    emit: (hits: readonly CorridorHit<OsmPoi>[], done = true) => cb.onUpdate(hits, done),
    status: (t: string, e?: boolean) => cb.setStatus(t, e),
  }
}

function stubViewport(desktop: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: desktop && q.includes('min-width'), media: q }))
}
const flush = () => new Promise(r => setTimeout(r, 0))
afterEach(() => { document.body.innerHTML = ''; document.body.className = ''; vi.unstubAllGlobals() })

describe('createTrackWiring', () => {
  it('draws a stored track on startup without fitting bounds', () => {
    const { layer, calls } = setup(track)
    expect(layer.shown).toEqual(track.points)
    expect(calls).toEqual(['show'])
  })

  it('draws nothing on startup without a stored track', () => {
    expect(setup().calls).toEqual(['clear'])
  })

  it('open/close/isImportOpen drive the dialog', () => {
    const { wiring } = setup()
    expect(wiring.isImportOpen()).toBe(false)
    wiring.openImport()
    expect(wiring.isImportOpen()).toBe(true)
    wiring.closeImport()
    expect(wiring.isImportOpen()).toBe(false)
  })

  it('setSatellite forwards to the layer', () => {
    const { wiring, calls } = setup()
    wiring.setSatellite(true)
    expect(calls).toContain('sat:true')
  })

  it('a GPX import stores the track, draws it, fits bounds and flashes', async () => {
    const { wiring, store, layer, calls, flash, q } = setup()
    calls.length = 0
    wiring.openImport()
    const gpx = '<gpx><trk><name>Testtour</name><trkseg><trkpt lat="50" lon="7"/><trkpt lat="50.05" lon="7.05"/><trkpt lat="50.1" lon="7.1"/></trkseg></trk></gpx>'
    const file = new File([gpx], 'x.gpx')
    Object.defineProperty(file, 'text', { value: async () => gpx })
    const input = q<HTMLInputElement>('fileInput')
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    input.dispatchEvent(new Event('change'))
    await flush()
    expect(store.get()?.name).toBe('Testtour')
    expect(layer.shown).not.toBeNull()
    expect(calls).toEqual(['show', 'fit'])
    expect(flash).toHaveBeenCalledWith(expect.stringMatching(/^Route geladen: Testtour · \d+,\d km$/))
    expect(wiring.isImportOpen()).toBe(false)
  })

  it('fits with the panel insets: import (mobile: collapsed first), Einpassen, Auf Karte zeigen', async () => {
    stubViewport(false)
    const { wiring, layer, pq, q, store } = setup()
    wiring.openImport()
    const gpx = '<gpx><trk><name>T</name><trkseg><trkpt lat="50" lon="7"/><trkpt lat="50.05" lon="7.05"/><trkpt lat="50.1" lon="7.1"/></trkseg></trk></gpx>'
    const file = new File([gpx], 'x.gpx')
    Object.defineProperty(file, 'text', { value: async () => gpx })
    const input = q<HTMLInputElement>('fileInput')
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    input.dispatchEvent(new Event('change'))
    await flush()
    expect(document.body.classList.contains('track-collapsed')).toBe(true)
    expect(layer.fitArgs).toEqual([{ left: 0, bottom: 52 }])
    pq('toggle').click() // expand
    pq('fit').click()
    expect(layer.fitArgs[1]).toEqual({ left: 0, bottom: 52 })
    wiring.openImport()
    q('show').click()
    expect(layer.fitArgs).toHaveLength(3)
    expect(layer.fitArgs[2]).toEqual({ left: 0, bottom: 52 })
  })

  it('desktop: import does not collapse and passes the left inset', async () => {
    stubViewport(true)
    const { wiring, layer, pq, store } = setup(track)
    pq('fit').click()
    expect(layer.fitArgs).toEqual([{ left: 0, bottom: 0 }])
    expect(store.get()).not.toBeNull()
    expect(wiring.isTrackActive()).toBe(true)
  })

  it('a Komoot link import goes through the injected fetch', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      name: 'Komoot-Tour',
      _embedded: { coordinates: { items: [{ lat: 50, lng: 7 }, { lat: 50.05, lng: 7.05 }, { lat: 50.1, lng: 7.1 }] } },
    }), { status: 200 })) as unknown as typeof fetch
    const { wiring, store, q } = setup(null, fetchFn)
    wiring.openImport()
    q<HTMLInputElement>('linkInput').value = 'https://www.komoot.com/de-de/tour/123456'
    q<HTMLButtonElement>('linkBtn').click()
    await flush()
    expect(fetchFn).toHaveBeenCalled()
    expect(store.get()?.source).toBe('komoot')
  })

  it('"Auf Karte zeigen" fits bounds and closes the dialog', () => {
    const { wiring, calls, q } = setup(track)
    wiring.openImport()
    calls.length = 0
    q<HTMLButtonElement>('show').click()
    expect(calls).toEqual(['fit'])
    expect(wiring.isImportOpen()).toBe(false)
  })

  it('"Route entfernen" clears store and layer, flashes and closes', () => {
    const { wiring, store, layer, flash, q } = setup(track)
    wiring.openImport()
    q<HTMLButtonElement>('remove').click()
    expect(store.get()).toBeNull()
    expect(layer.shown).toBeNull()
    expect(flash).toHaveBeenCalledWith('Route entfernt')
    expect(wiring.isImportOpen()).toBe(false)
  })

  it('an external store change while the dialog is open refreshes the active block', () => {
    const { wiring, store, q } = setup(track)
    wiring.openImport()
    expect(q('active').hidden).toBe(false)
    store.clear()
    expect(q('active').hidden).toBe(true)
  })
})

describe('createTrackWiring: POIs along the route', () => {
  it('a stored track suspends the refresher, shows the panel and loads — in that order, at startup', () => {
    const { order, refresher, loader, pq, wiring } = setup(track)
    expect(order).toEqual(['suspend', 'load'])
    expect(refresher.refresh).not.toHaveBeenCalled()
    expect(loader.load).toHaveBeenCalledWith(track)
    expect(pq('name').textContent).toBe('Eifelrunde')
    expect(wiring.isTrackActive()).toBe(true)
  })

  it('without a stored track nothing is suspended or loaded', () => {
    const { refresher, loader, wiring } = setup()
    expect(refresher.suspend).not.toHaveBeenCalled()
    expect(loader.load).not.toHaveBeenCalled()
    expect(wiring.isTrackActive()).toBe(false)
  })

  it('an import activates: suspend, panel, load', async () => {
    const { store, order, loader } = setup()
    store.set(track)
    expect(order).toEqual(['suspend', 'load'])
    expect(loader.load).toHaveBeenCalledWith(track)
  })

  it('replacing the track with a different one reloads', () => {
    const { store, loader } = setup(track)
    store.set({ ...track, name: 'Andere', points: [[51, 8], [51.1, 8.1]] })
    expect(loader.load).toHaveBeenCalledTimes(2)
    expect(loader.setCorridor).not.toHaveBeenCalled()
  })

  it('passes the row hint through to the panel rows', () => {
    const { emit, rows } = setup(track)
    emit([hit(poi(1, 'cemetery', 'Friedhof'), 3), hit(poi(2, 'campsite', 'Camp'), 5)])
    const hints = rows().map(r => r.querySelector<HTMLElement>('.track-row-hint')!)
    expect(hints[0]!.hidden).toBe(false)
    expect(hints[0]!.textContent).toBe('Wasser im Winter oft abgestellt')
    expect(hints[1]!.hidden).toBe(true)
  })

  it('a corridor change (same route, re-parsed points) only calls setCorridor — no reload, no panel reset', () => {
    const { store, loader, refresher, pq, emit, rows } = setup(track)
    emit([hit(poi(1), 3)])
    expect(rows()).toHaveLength(1)
    store.setCorridor(900)
    expect(loader.setCorridor).toHaveBeenCalledWith(900)
    expect(loader.load).toHaveBeenCalledTimes(1)
    expect(refresher.suspend).toHaveBeenCalledTimes(1)
    expect(rows()).toHaveLength(1) // rows stay until the loader delivers
    expect(pq('name').textContent).toBe('Eifelrunde')
  })

  it('removing the track cancels, hides the panel, resumes and refreshes the viewport', () => {
    const { store, loader, order, pq, wiring } = setup(track)
    order.length = 0
    store.clear()
    expect(loader.cancel).toHaveBeenCalled()
    expect(order).toEqual(['resume', 'refresh'])
    expect((pq('name').closest('.track-sheet') as HTMLElement).hidden).toBe(true)
    expect(wiring.isTrackActive()).toBe(false)
  })

  // Regression: removing a route while zoomed far out left its POIs on the map,
  // because the viewport refresher refuses over-wide viewports and never repainted.
  it('removing the track takes the corridor POIs off the map even if the refresher paints nothing', () => {
    const { store, emit, setMarkers } = setup(track)
    emit([hit(poi(1, 'parking'), 1)])
    expect(setMarkers).toHaveBeenLastCalledWith([expect.objectContaining({ id: 1 })])
    store.clear()
    expect(setMarkers).toHaveBeenLastCalledWith([])
  })

  it('clearing without an active track does not resume/refresh', () => {
    const { store, refresher } = setup()
    store.clear()
    expect(refresher.resume).not.toHaveBeenCalled()
    expect(refresher.refresh).not.toHaveBeenCalled()
  })

  it('loader updates set the markers to all hits and the rows to the active types, in delivered order', () => {
    const { emit, setMarkers, rows } = setup(track)
    const a = poi(1, 'campsite', 'Camp A')
    const b = poi(2, 'parking')
    const c = poi(3, 'dump') // chip off
    emit([hit(a, 1), hit(b, 2), hit(c, 3)])
    expect(setMarkers).toHaveBeenLastCalledWith([a, b, c])
    const titles = rows().map(r => r.querySelector('.track-row-title')!.textContent)
    expect(titles).toEqual(['Camp A', 'Ort'])
  })

  it('POI names are set as text, never as markup', () => {
    const { emit, rows } = setup(track)
    emit([hit(poi(1, 'campsite', '<img src=x onerror=alert(1)>'), 1)])
    expect(rows()[0]!.querySelector('img[src="x"]')).toBeNull()
    expect(rows()[0]!.querySelector('.track-row-title')!.textContent).toBe('<img src=x onerror=alert(1)>')
  })

  it('clicking a row selects that POI (lookup by poiKey)', () => {
    const { emit, rows, selectPoi } = setup(track)
    const a = poi(1, 'campsite', 'A')
    const b = poi(2, 'campsite', 'B')
    emit([hit(a, 1), hit(b, 2)])
    ;(rows()[1]!.querySelector('button') ?? rows()[1]!).click()
    expect(selectPoi).toHaveBeenCalledWith(b)
  })

  it('onFiltersChanged rebuilds the rows for the active chips and reloads only when a refetch is needed', () => {
    const { emit, rows, active, wiring, loader } = setup(track)
    emit([hit(poi(1, 'campsite'), 1), hit(poi(2, 'parking'), 2)])
    expect(rows()).toHaveLength(2)
    active.delete('parking')
    wiring.onFiltersChanged(false)
    expect(rows()).toHaveLength(1)
    expect(loader.reload).not.toHaveBeenCalled()
    wiring.onFiltersChanged(true)
    expect(loader.reload).toHaveBeenCalledTimes(1)
  })

  it('onFiltersChanged without refetch reclassifies the loader (no reload); the rows follow its onUpdate', () => {
    const { emit, rows, wiring, loader, active, setMarkers } = setup(track)
    emit([hit(poi(1, 'parking', 'Bäcker-Café'), 1)])
    expect(rows()[0]!.textContent).toContain('parking')
    loader.reclassify.mockImplementation(() => { active.add('campsite'); emit([hit(poi(1, 'campsite', 'Bäcker-Café'), 1)]) })
    wiring.onFiltersChanged(false)
    expect(loader.reclassify).toHaveBeenCalledTimes(1)
    expect(loader.reload).not.toHaveBeenCalled()
    expect(rows()).toHaveLength(1)
    expect(rows()[0]!.textContent).toContain('campsite')
    expect(setMarkers.mock.calls.at(-1)![0].map(p => p.type)).toEqual(['campsite'])
    wiring.onFiltersChanged(true) // refetch → reload instead
    expect(loader.reclassify).toHaveBeenCalledTimes(1)
    expect(loader.reload).toHaveBeenCalledTimes(1)
  })

  it('onFiltersChanged is a no-op without a track', () => {
    const { wiring, loader } = setup()
    wiring.onFiltersChanged(true)
    expect(loader.reload).not.toHaveBeenCalled()
  })

  it('panel callbacks: slider → store, fit → layer, remove → store.clear + flash', () => {
    const { pq, store, calls, flash } = setup(track)
    const setCorridor = vi.spyOn(store, 'setCorridor')
    const range = pq<HTMLInputElement>('corridor')
    range.value = '1000'
    range.dispatchEvent(new Event('change'))
    expect(setCorridor).toHaveBeenCalledWith(1000)
    calls.length = 0
    pq<HTMLButtonElement>('fit').click()
    expect(calls).toEqual(['fit'])
    pq<HTMLButtonElement>('remove').click()
    expect(store.get()).toBeNull()
    expect(flash).toHaveBeenCalledWith('Route entfernt')
  })

  it('failed chunks: the status gets the retry suffix and clicking it calls retryFailed', () => {
    const { status, pq, loader } = setup(track)
    status(MSG_CHUNKS_FAILED, true)
    const el = pq('status')
    expect(el.textContent).toBe(MSG_CHUNKS_FAILED + RETRY_SUFFIX)
    el.click()
    expect(loader.retryFailed).toHaveBeenCalledTimes(1)
    status('Lade Orte…')
    el.click()
    expect(loader.retryFailed).toHaveBeenCalledTimes(1)
  })

  it('positionOf delegates to the loader; collapsePanel only collapses with an active track', () => {
    const a = setup()
    a.wiring.collapsePanel()
    expect(document.body.classList.contains('track-collapsed')).toBe(false)
    expect(a.wiring.positionOf(poi(1))).toEqual({ kmAlong: 1, kmToEnd: 2, offsetM: 3 })
    document.body.innerHTML = ''
    const b = setup(track)
    b.wiring.collapsePanel()
    expect(document.body.classList.contains('track-collapsed')).toBe(true)
  })
})

describe('connector to the selected place', () => {
  const off = (offsetM: number): TrackPosition => ({ kmAlong: 44.1, kmToEnd: 42.3, offsetM })
  const far = poi(7, 'campsite', 'Jägerhütte')

  it('draws a line from the nearest route point to a place off the route', () => {
    const s = setup(track)
    s.loader.positionOf.mockReturnValue(off(620))
    s.wiring.onPoiSelected(far)
    expect(s.loader.footOf).toHaveBeenCalledWith(far)
    expect(s.layer.connector).toEqual([[50.05, 7.05], [far.lat, far.lon]])
  })

  it('draws none for a place on the route', () => {
    const s = setup(track)
    s.loader.positionOf.mockReturnValue(off(CONNECTOR_MIN_OFFSET_M - 1))
    s.wiring.onPoiSelected(far)
    expect(s.layer.connector).toBeNull()
  })

  it('draws none without a route, beyond the corridor limit, or without a foot point', () => {
    const none = setup(null)
    none.loader.positionOf.mockReturnValue(off(620))
    none.wiring.onPoiSelected(far)
    expect(none.layer.connector).toBeNull()

    const beyond = setup(track)
    beyond.loader.positionOf.mockReturnValue(null)
    beyond.wiring.onPoiSelected(far)
    expect(beyond.layer.connector).toBeNull()

    const noFoot = setup(track)
    noFoot.loader.positionOf.mockReturnValue(off(620))
    noFoot.loader.footOf.mockReturnValue(null)
    noFoot.wiring.onPoiSelected(far)
    expect(noFoot.layer.connector).toBeNull()
  })

  it('replaces the line on the next selection and removes it when the selection ends', () => {
    const s = setup(track)
    s.loader.positionOf.mockReturnValue(off(620))
    s.wiring.onPoiSelected(far)
    s.loader.footOf.mockReturnValue([50.08, 7.08])
    s.wiring.onPoiSelected(poi(8))
    expect(s.layer.connector![0]).toEqual([50.08, 7.08])
    s.wiring.onPoiSelected(null)
    expect(s.layer.connector).toBeNull()
  })

  it('keeps the line on a corridor change, drops it when the route is removed', () => {
    const s = setup(track)
    s.loader.positionOf.mockReturnValue(off(620))
    s.wiring.onPoiSelected(far)
    s.store.setCorridor(1000)
    expect(s.layer.connector).not.toBeNull()
    s.store.clear()
    expect(s.layer.connector).toBeNull()
  })

  it('re-evaluates the line for a newly imported route', () => {
    const s = setup(track)
    s.loader.positionOf.mockReturnValue(off(620))
    s.wiring.onPoiSelected(far)
    s.loader.positionOf.mockReturnValue(null) // the place is nowhere near the new route
    s.store.set({ ...track, name: 'Andere Runde', points: [[51, 8], [51.1, 8.1]] })
    expect(s.layer.connector).toBeNull()
  })
})

describe('mapInsets', () => {
  it('covers nothing without a route', () => {
    expect(setup(null).wiring.mapInsets()).toEqual({ left: 0, bottom: 0 })
  })
})
