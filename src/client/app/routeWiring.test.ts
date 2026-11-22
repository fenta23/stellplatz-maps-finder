import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRouteWiring, RETRY_SUFFIX, CONNECTOR_MIN_OFFSET_M, type RouteLoaderCallbacks } from './routeWiring.js'
import type { RoutePoiLoader } from './routePoiLoader.js'
import { MSG_CHUNKS_FAILED } from './routePoiLoader.js'
import type { OsmPoi } from '@/features/pois/OverpassClient.js'
import type { CorridorHit } from '@/features/route/corridor.js'
import { LocalRouteStore } from '@/features/route/RouteStore.js'
import type { RouteLayer } from '@/features/route/RouteLayer.js'
import type { Route, LinePoint, RoutePosition } from '@/features/route/routeTypes.js'

const route: Route = {
  name: 'Eifelrunde', source: 'gpx', points: [[50, 7], [50.1, 7.1]], lengthM: 86_432, corridorM: 500,
}

function realStore(initial: Route | null = null) {
  localStorage.clear()
  let n = 0
  const store = new LocalRouteStore(localStorage, { newId: () => `id${++n}` })
  if (initial) store.set(initial)
  return store
}

function fakeLayer() {
  const calls: string[] = []
  const layer: RouteLayer & {
    shown: readonly LinePoint[] | null; fitArgs: Array<unknown>; connector: readonly [LinePoint, LinePoint] | null
  } = {
    shown: null,
    connector: null,
    setEditing() { /* owned by routeEditWiring */ },
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

function setup(initial: Route | null = null, fetchFn?: typeof fetch, onOpenPlanner?: () => void) {
  const container = document.createElement('div')
  const panelBox = document.createElement('div')
  document.body.append(container, panelBox)
  const store = realStore(initial)
  const scheduled: Array<() => void> = []
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
    positionOf: vi.fn((): RoutePosition | null => ({ kmAlong: 1, kmToEnd: 2, offsetM: 3 })),
    footOf: vi.fn((): LinePoint | null => [50.05, 7.05]),
  } satisfies RoutePoiLoader
  let cb!: RouteLoaderCallbacks
  const refresher = {
    suspend: vi.fn(() => { order.push('suspend') }),
    resume: vi.fn(() => { order.push('resume') }),
    refresh: vi.fn(() => { order.push('refresh') }),
  }
  const setMarkers = vi.fn<(p: readonly OsmPoi[]) => void>()
  const selectPoi = vi.fn<(p: OsmPoi) => void>()
  const downloadFile = vi.fn<(filename: string, mime: string, text: string) => void>()
  const active = new Set(['campsite', 'parking', 'cemetery'])
  const wiring = createRouteWiring({
    store, layer, dialogContainer: container, flash, fetchFn,
    createLoader: c => { cb = c; return loader },
    refresher, setMarkers, selectPoi,
    rowFor: p => ({ title: p.tags.name ?? 'Ort', subtitle: p.type, color: '#2e7d32', iconSvg: '<svg data-i></svg>', ...(p.type === 'cemetery' ? { hint: 'Wasser im Winter oft abgestellt' } : {}) }),
    isTypeActive: t => active.has(t),
    panelContainer: panelBox,
    downloadFile,
    scheduleStartupFit: run => { scheduled.push(run) },
    onOpenPlanner,
  })
  const q = <T extends HTMLElement>(r: string) => container.querySelector<T>(`[data-ref="${r}"]`)!
  const pq = <T extends HTMLElement>(r: string) => panelBox.querySelector<T>(`[data-ref="${r}"]`)!
  const rows = () => [...panelBox.querySelectorAll<HTMLElement>('.track-row')]
  return {
    container, store, layer, calls, flash, wiring, q, pq, loader, refresher, order, setMarkers, selectPoi, active, rows, downloadFile, scheduled,
    runStartupFit: () => scheduled.splice(0).forEach(r => r()),
    emit: (hits: readonly CorridorHit<OsmPoi>[], done = true) => cb.onUpdate(hits, done),
    status: (t: string, e?: boolean) => cb.setStatus(t, e),
  }
}

function stubViewport(desktop: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: desktop && q.includes('min-width'), media: q }))
}
const flush = () => new Promise(r => setTimeout(r, 0))
afterEach(() => { localStorage.clear(); document.body.innerHTML = ''; document.body.className = ''; vi.unstubAllGlobals() })

describe('createRouteWiring', () => {
  it('draws a stored track on startup without fitting bounds', () => {
    const { layer, calls } = setup(route)
    expect(layer.shown).toEqual(route.points)
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
    const { wiring, layer, pq, store } = setup(route)
    pq('fit').click()
    expect(layer.fitArgs).toEqual([{ left: 0, bottom: 0 }])
    expect(store.get()).not.toBeNull()
    expect(wiring.isRouteActive()).toBe(true)
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

  describe('importRoute', () => {
    const planned: Route = {
      name: 'Dresden → Pirna (Rad)', source: 'planned', points: [[51.05, 13.74], [51.0, 13.85], [50.96, 13.94]], lengthM: 18_432, corridorM: 500,
    }

    it('acts like an import: stores, draws, fits bounds and flashes', () => {
      stubViewport(true)
      const { wiring, store, layer, calls, flash } = setup()
      calls.length = 0
      wiring.importRoute(planned)
      expect(store.get()?.name).toBe('Dresden → Pirna (Rad)')
      expect(store.get()?.source).toBe('planned')
      expect(layer.shown).toEqual(planned.points)
      expect(calls).toEqual(['show', 'fit'])
      expect(flash).toHaveBeenCalledWith('Route geladen: Dresden → Pirna (Rad) · 18,4 km')
    })

    it('mobile: folds the sheet first and fits with the collapsed inset', () => {
      stubViewport(false)
      const { wiring, layer } = setup()
      wiring.importRoute(planned)
      expect(document.body.classList.contains('track-collapsed')).toBe(true)
      expect(layer.fitArgs).toEqual([{ left: 0, bottom: 52 }])
    })

    it('importing the same planned route again re-activates it instead of duplicating', () => {
      stubViewport(true)
      const { wiring, store } = setup()
      wiring.importRoute(planned)
      wiring.importRoute({ ...planned, name: 'Anderes' })
      wiring.importRoute(planned)
      expect(store.list()).toHaveLength(2)
      expect(store.get()?.name).toBe('Dresden → Pirna (Rad)')
    })
  })

  describe('onOpenPlanner', () => {
    it('hides the plan section without the dep', () => {
      const { wiring, q } = setup()
      wiring.openImport()
      expect(q('planSection').hidden).toBe(true)
    })

    it('passes it to the dialog as "Route planen" without closing the dialog itself', () => {
      const onOpenPlanner = vi.fn()
      const { wiring, q } = setup(null, undefined, onOpenPlanner)
      wiring.openImport()
      expect(q('planSection').hidden).toBe(false)
      q<HTMLButtonElement>('planBtn').click()
      expect(onOpenPlanner).toHaveBeenCalledTimes(1)
      expect(wiring.isImportOpen()).toBe(true)
    })
  })

  it('"Auf Karte zeigen" fits bounds and closes the dialog', () => {
    const { wiring, calls, q } = setup(route)
    wiring.openImport()
    calls.length = 0
    q<HTMLButtonElement>('show').click()
    expect(calls).toEqual(['fit'])
    expect(wiring.isImportOpen()).toBe(false)
  })

  it('"Route schließen" deactivates, keeps the route saved, flashes and closes', () => {
    const { wiring, store, layer, flash, q } = setup(route)
    wiring.openImport()
    q<HTMLButtonElement>('remove').click()
    expect(store.get()).toBeNull()
    expect(store.list()).toHaveLength(1)
    expect(layer.shown).toBeNull()
    expect(flash).toHaveBeenCalledWith('Route geschlossen – sie bleibt gespeichert')
    expect(wiring.isImportOpen()).toBe(false)
  })

  it('"Löschen" of the active route removes it from the library', () => {
    const { wiring, store, layer, flash, q } = setup(route)
    wiring.openImport()
    q<HTMLButtonElement>('deleteActive').click()
    expect(store.get()).toBeNull()
    expect(store.list()).toEqual([])
    expect(layer.shown).toBeNull()
    expect(flash).toHaveBeenCalledWith('Route gelöscht')
    expect(wiring.isImportOpen()).toBe(false)
  })

  it('"Anzeigen" on a saved route behaves like an import: activate, load, fit, flash', () => {
    const { wiring, store, layer, loader, flash, calls, refresher, container } = setup(route)
    store.set({ ...route, name: 'Zweite', points: [[51, 8], [51.1, 8.1]], lengthM: 12_000 })
    const firstId = store.list()[1]!.id
    loader.load.mockClear()
    refresher.suspend.mockClear()
    calls.length = 0
    wiring.openImport()
    container.querySelector<HTMLButtonElement>('.track-saved-show')!.click()
    expect(store.get()?.id).toBe(firstId)
    expect(layer.shown).toEqual(route.points)
    expect(loader.load).toHaveBeenCalledWith(expect.objectContaining({ id: firstId }))
    expect(calls.filter(c => c === 'fit')).toHaveLength(1)
    expect(flash).toHaveBeenCalledWith('Route geladen: Eifelrunde · 86,4 km')
    expect(wiring.isImportOpen()).toBe(false)
  })

  it('deleting an inactive saved route does not reload or redraw the active one, nor reset its stretch', () => {
    const { wiring, store, layer, loader, flash, calls, container, setMarkers } = setup(route)
    const other = store.set({ ...route, name: 'Zweite', points: [[51, 8], [51.1, 8.1]] })
    store.activate(store.list()[1]!.id)
    loader.load.mockClear()
    loader.cancel.mockClear()
    loader.setCorridor.mockClear()
    calls.length = 0
    setMarkers.mockClear()
    wiring.openImport()
    container.querySelector<HTMLButtonElement>('.track-saved-delete')!.click()
    expect(store.list().some(t => t.id === other.id)).toBe(false)
    expect(flash).toHaveBeenCalledWith('Route gelöscht')
    expect(loader.load).not.toHaveBeenCalled()
    expect(loader.cancel).not.toHaveBeenCalled()
    expect(loader.setCorridor).not.toHaveBeenCalled()
    expect(calls).toEqual([])
    expect(setMarkers).not.toHaveBeenCalled()
    expect(wiring.isImportOpen()).toBe(true)
    expect(layer.shown).toEqual(route.points)
  })

  it('an external store change while the dialog is open refreshes the active block', () => {
    const { wiring, store, q } = setup(route)
    wiring.openImport()
    expect(q('active').hidden).toBe(false)
    store.clear()
    expect(q('active').hidden).toBe(true)
  })
})

describe('createRouteWiring: startup fit', () => {
  it('fits once, with the panel insets, when a route is active at startup', () => {
    const { layer, runStartupFit, scheduled } = setup(route)
    expect(scheduled).toHaveLength(1)
    expect(layer.fitArgs).toEqual([])
    runStartupFit()
    expect(layer.fitArgs).toHaveLength(1)
    expect(layer.fitArgs[0]).toEqual({ left: expect.any(Number), bottom: expect.any(Number) })
  })

  it('does nothing at startup without a route', () => {
    const { scheduled, layer } = setup()
    expect(scheduled).toHaveLength(0)
    expect(layer.fitArgs).toEqual([])
  })

  it('does not fit a second time when another route is activated before it runs', () => {
    const { store, layer, runStartupFit } = setup(route)
    store.set({ ...route, name: 'Zweite', points: [[51, 8], [51.1, 8.1]] })
    runStartupFit()
    expect(layer.fitArgs).toEqual([])
  })

  it('does not fit when the route was closed before it runs', () => {
    const { store, layer, runStartupFit } = setup(route)
    store.clear()
    runStartupFit()
    expect(layer.fitArgs).toEqual([])
  })

  it('a route that becomes active later schedules no startup fit', () => {
    const { store, scheduled, layer } = setup()
    store.set(route)
    expect(scheduled).toHaveLength(0)
    expect(layer.fitArgs).toEqual([])
  })
})

describe('createRouteWiring: POIs along the route', () => {
  it('a stored track suspends the refresher, shows the panel and loads — in that order, at startup', () => {
    const { order, refresher, loader, pq, wiring } = setup(route)
    expect(order).toEqual(['suspend', 'load'])
    expect(refresher.refresh).not.toHaveBeenCalled()
    expect(loader.load).toHaveBeenCalledWith(expect.objectContaining(route))
    expect(pq('name').textContent).toBe('Eifelrunde')
    expect(wiring.isRouteActive()).toBe(true)
  })

  it('without a stored track nothing is suspended or loaded', () => {
    const { refresher, loader, wiring } = setup()
    expect(refresher.suspend).not.toHaveBeenCalled()
    expect(loader.load).not.toHaveBeenCalled()
    expect(wiring.isRouteActive()).toBe(false)
  })

  it('an import activates: suspend, panel, load', async () => {
    const { store, order, loader } = setup()
    store.set(route)
    expect(order).toEqual(['suspend', 'load'])
    expect(loader.load).toHaveBeenCalledWith(expect.objectContaining(route))
  })

  it('replacing the track with a different one reloads', () => {
    const { store, loader } = setup(route)
    store.set({ ...route, name: 'Andere', points: [[51, 8], [51.1, 8.1]] })
    expect(loader.load).toHaveBeenCalledTimes(2)
    expect(loader.setCorridor).not.toHaveBeenCalled()
  })

  it('passes the row hint through to the panel rows', () => {
    const { emit, rows } = setup(route)
    emit([hit(poi(1, 'cemetery', 'Friedhof'), 3), hit(poi(2, 'campsite', 'Camp'), 5)])
    const hints = rows().map(r => r.querySelector<HTMLElement>('.track-row-hint')!)
    expect(hints[0]!.hidden).toBe(false)
    expect(hints[0]!.textContent).toBe('Wasser im Winter oft abgestellt')
    expect(hints[1]!.hidden).toBe(true)
  })

  it('a corridor change (same route, re-parsed points) only calls setCorridor — no reload, no panel reset', () => {
    const { store, loader, refresher, pq, emit, rows } = setup(route)
    emit([hit(poi(1), 3)])
    expect(rows()).toHaveLength(1)
    store.setCorridor(900)
    expect(loader.setCorridor).toHaveBeenCalledWith(900)
    expect(loader.load).toHaveBeenCalledTimes(1)
    expect(refresher.suspend).toHaveBeenCalledTimes(1)
    expect(rows()).toHaveLength(1) // rows stay until the loader delivers
    expect(pq('name').textContent).toBe('Eifelrunde')
  })

  describe('a route edited in place (store.replace: same id, new line)', () => {
    const edited: Route = { ...route, name: 'Eifelrunde', points: [[50, 7], [50.06, 7.02], [50.1, 7.1]], lengthM: 91_000 }

    it('redraws the line, updates the panel and reloads the POIs — without fitting the map', () => {
      const { store, layer, calls, loader, pq, emit, rows } = setup(route)
      emit([hit(poi(1), 3)])
      calls.length = 0
      store.replace(store.get()!.id, edited)
      expect(layer.shown).toEqual(edited.points)
      expect(calls).toEqual(['show'])
      expect(loader.load).toHaveBeenCalledTimes(2)
      expect(loader.load).toHaveBeenLastCalledWith(expect.objectContaining({ points: edited.points, lengthM: 91_000 }))
      expect(loader.setCorridor).not.toHaveBeenCalled()
      expect(pq('meta').textContent).toContain('91,0')
      // As with a route switch, the old rows stay until the loader delivers for the new line.
      emit([hit(poi(2), 4), hit(poi(3), 9)])
      expect(rows()).toHaveLength(2)
    })

    it('keeps the corridor POIs owner: no resume of the viewport refresher', () => {
      const { store, refresher } = setup(route)
      store.replace(store.get()!.id, edited)
      expect(refresher.resume).not.toHaveBeenCalled()
      expect(refresher.refresh).not.toHaveBeenCalled()
    })

    it('a new name alone (same line) updates the panel too', () => {
      const { store, pq, loader } = setup(route)
      store.replace(store.get()!.id, { ...route, name: 'Umbenannt' })
      expect(pq('name').textContent).toBe('Umbenannt')
      expect(loader.load).toHaveBeenCalledTimes(2)
    })

    it('replacing with an identical line and name does nothing (no reload)', () => {
      const { store, calls, loader } = setup(route)
      calls.length = 0
      store.replace(store.get()!.id, { ...route, points: route.points.map(p => [p[0], p[1]] as const) })
      expect(calls).toEqual([])
      expect(loader.load).toHaveBeenCalledTimes(1)
    })
  })

  it('removing the track cancels, hides the panel, resumes and refreshes the viewport', () => {
    const { store, loader, order, pq, wiring } = setup(route)
    order.length = 0
    store.clear()
    expect(loader.cancel).toHaveBeenCalled()
    expect(order).toEqual(['resume', 'refresh'])
    expect((pq('name').closest('.track-sheet') as HTMLElement).hidden).toBe(true)
    expect(wiring.isRouteActive()).toBe(false)
  })

  // Regression: removing a route while zoomed far out left its POIs on the map,
  // because the viewport refresher refuses over-wide viewports and never repainted.
  it('removing the track takes the corridor POIs off the map even if the refresher paints nothing', () => {
    const { store, emit, setMarkers } = setup(route)
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
    const { emit, setMarkers, rows } = setup(route)
    const a = poi(1, 'campsite', 'Camp A')
    const b = poi(2, 'parking')
    const c = poi(3, 'dump') // chip off
    emit([hit(a, 1), hit(b, 2), hit(c, 3)])
    expect(setMarkers).toHaveBeenLastCalledWith([a, b, c])
    const titles = rows().map(r => r.querySelector('.track-row-title')!.textContent)
    expect(titles).toEqual(['Camp A', 'Ort'])
  })

  it('POI names are set as text, never as markup', () => {
    const { emit, rows } = setup(route)
    emit([hit(poi(1, 'campsite', '<img src=x onerror=alert(1)>'), 1)])
    expect(rows()[0]!.querySelector('img[src="x"]')).toBeNull()
    expect(rows()[0]!.querySelector('.track-row-title')!.textContent).toBe('<img src=x onerror=alert(1)>')
  })

  it('clicking a row selects that POI (lookup by poiKey)', () => {
    const { emit, rows, selectPoi } = setup(route)
    const a = poi(1, 'campsite', 'A')
    const b = poi(2, 'campsite', 'B')
    emit([hit(a, 1), hit(b, 2)])
    ;(rows()[1]!.querySelector('button') ?? rows()[1]!).click()
    expect(selectPoi).toHaveBeenCalledWith(b)
  })

  it('onFiltersChanged rebuilds the rows for the active chips and reloads only when a refetch is needed', () => {
    const { emit, rows, active, wiring, loader } = setup(route)
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
    const { emit, rows, wiring, loader, active, setMarkers } = setup(route)
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
    const { pq, store, calls, flash } = setup(route)
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
    expect(flash).toHaveBeenCalledWith('Route geschlossen – sie bleibt gespeichert')
    expect(store.list()).toHaveLength(1)
  })

  it('failed chunks: the status gets the retry suffix and clicking it calls retryFailed', () => {
    const { status, pq, loader } = setup(route)
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
    const b = setup(route)
    b.wiring.collapsePanel()
    expect(document.body.classList.contains('track-collapsed')).toBe(true)
  })

  describe('stretch (Abschnitt)', () => {
    const ids = (els: readonly HTMLElement[]) => els.map(e => e.querySelector('.track-row-title')!.textContent)
    const hits = () => [
      hit(poi(1, 'campsite', 'A'), 5), hit(poi(2, 'parking', 'B'), 15),
      hit(poi(3, 'campsite', 'C'), 30), hit(poi(4, 'parking', 'D'), 60),
    ]
    const dragStretch = (pq: (r: string) => HTMLElement, from: number, to: number) => {
      const f = pq('stretchFrom') as HTMLInputElement
      const t = pq('stretchTo') as HTMLInputElement
      f.value = String(from); f.dispatchEvent(new Event('input'))
      t.value = String(to); t.dispatchEvent(new Event('input'))
      t.dispatchEvent(new Event('change'))
    }
    const markerNames = (m: ReturnType<typeof vi.fn<(p: readonly OsmPoi[]) => void>>) =>
      m.mock.calls.at(-1)![0].map(p => p.tags.name)

    it('restricts rows, markers and the count to the stretch', () => {
      const { emit, pq, rows, setMarkers } = setup(route)
      emit(hits())
      dragStretch(pq, 10, 40)
      expect(ids(rows())).toEqual(['B', 'C'])
      expect(markerNames(setMarkers)).toEqual(['B', 'C'])
      expect(pq('meta').textContent).toBe('86,4 km · 2 Orte')
    })

    it('"Ganze Route" brings everything back', () => {
      const { emit, pq, rows, setMarkers } = setup(route)
      emit(hits())
      dragStretch(pq, 10, 40)
      pq('stretchReset').click()
      expect(ids(rows())).toEqual(['A', 'B', 'C', 'D'])
      expect(markerNames(setMarkers)).toEqual(['A', 'B', 'C', 'D'])
    })

    it('is kept when new hits arrive (corridor change) and when the filters change', () => {
      const { emit, pq, rows, setMarkers, active, wiring } = setup(route)
      emit(hits())
      dragStretch(pq, 10, 40)
      emit([hit(poi(1, 'campsite', 'A'), 5), hit(poi(2, 'parking', 'B'), 15), hit(poi(5, 'campsite', 'E'), 20), hit(poi(3, 'campsite', 'C'), 30), hit(poi(4, 'parking', 'D'), 60)])
      expect(ids(rows())).toEqual(['B', 'E', 'C'])
      expect(markerNames(setMarkers)).toEqual(['B', 'E', 'C'])
      active.delete('parking')
      wiring.onFiltersChanged(false)
      expect(ids(rows())).toEqual(['E', 'C'])
      expect((pq('stretchTo') as HTMLInputElement).value).toBe('40')
    })

    it('a corridor change of the same route keeps the stretch', () => {
      const { emit, pq, rows, store } = setup(route)
      emit(hits())
      dragStretch(pq, 10, 40)
      store.setCorridor(1000)
      emit(hits())
      expect(ids(rows())).toEqual(['B', 'C'])
      expect((pq('stretchFrom') as HTMLInputElement).value).toBe('10')
    })

    it('a new track resets the stretch (panel control and filter)', () => {
      const { emit, pq, rows, store } = setup(route)
      emit(hits())
      dragStretch(pq, 10, 40)
      store.set({ ...route, name: 'Andere', lengthM: 50_000 })
      emit(hits())
      expect(ids(rows())).toEqual(['A', 'B', 'C', 'D'])
      expect((pq('stretchFrom') as HTMLInputElement).value).toBe('0')
      expect((pq('stretchTo') as HTMLInputElement).value).toBe('50')
    })
  })

  describe('GPX export', () => {
    const hits = () => [
      hit(poi(1, 'campsite', 'Camping <Eifel> & Co'), 5.25),
      hit(poi(2, 'parking'), 15),
      hit(poi(3, 'cemetery', 'Friedhof'), 30),
      hit(poi(4, 'campsite', 'Weit weg'), 70),
    ]
    const parsed = (text: string) => new DOMParser().parseFromString(text, 'application/xml')

    it('exports exactly the listed places with km/offset text and flashes the count', () => {
      const { emit, pq, downloadFile, flash } = setup(route)
      emit(hits())
      ;(pq('export') as HTMLButtonElement).click()
      expect(downloadFile).toHaveBeenCalledTimes(1)
      const [name, mime, text] = downloadFile.mock.calls[0]!
      expect(name).toBe('Eifelrunde-orte.gpx')
      expect(mime).toBe('application/gpx+xml')
      const doc = parsed(text)
      expect(doc.getElementsByTagName('parsererror')).toHaveLength(0)
      const wpts = [...doc.getElementsByTagName('wpt')]
      expect(wpts).toHaveLength(4)
      expect(wpts[0]!.querySelector('name')!.textContent).toBe('Camping <Eifel> & Co')
      expect(wpts[0]!.querySelector('type')!.textContent).toBe('campsite')
      expect(wpts[0]!.querySelector('desc')!.textContent).toBe('km 5,3 · 120 m abseits')
      // unnamed place: the row title (here the fake's 'Ort'); type = category label (the row's subtitle)
      expect(wpts[1]!.querySelector('name')!.textContent).toBe('Ort')
      expect(wpts[1]!.querySelector('type')!.textContent).toBe('parking')
      expect(doc.querySelectorAll('trkpt')).toHaveLength(2)
      expect(doc.querySelector('trk > name')!.textContent).toBe('Eifelrunde')
      expect(flash).toHaveBeenLastCalledWith('4 Orte als GPX exportiert')
    })

    it('respects the active chips and the stretch', () => {
      const { emit, pq, active, wiring, downloadFile, flash } = setup(route)
      emit(hits())
      active.delete('parking')
      wiring.onFiltersChanged(false)
      const f = pq('stretchFrom') as HTMLInputElement
      const t = pq('stretchTo') as HTMLInputElement
      f.value = '4'; f.dispatchEvent(new Event('input'))
      t.value = '40'; t.dispatchEvent(new Event('input')); t.dispatchEvent(new Event('change'))
      ;(pq('export') as HTMLButtonElement).click()
      const names = [...parsed(downloadFile.mock.calls[0]![2]).querySelectorAll('wpt > name')].map(n => n.textContent)
      expect(names).toEqual(['Camping <Eifel> & Co', 'Friedhof'])
      expect(flash).toHaveBeenLastCalledWith('2 Orte als GPX exportiert')
    })

    it('uses the singular for one place', () => {
      const { emit, pq, flash } = setup(route)
      emit([hit(poi(1, 'campsite', 'A'), 5)])
      ;(pq('export') as HTMLButtonElement).click()
      expect(flash).toHaveBeenLastCalledWith('1 Ort als GPX exportiert')
    })

    it('does not export when nothing is listed', () => {
      const { emit, pq, downloadFile, flash } = setup(route)
      flash.mockClear()
      emit([])
      const btn = pq('export') as HTMLButtonElement
      expect(btn.disabled).toBe(true)
      btn.click()
      expect(downloadFile).not.toHaveBeenCalled()
      expect(flash).not.toHaveBeenCalled()
    })
  })
})

describe('connector to the selected place', () => {
  const off = (offsetM: number): RoutePosition => ({ kmAlong: 44.1, kmToEnd: 42.3, offsetM })
  const far = poi(7, 'campsite', 'Jägerhütte')

  it('draws a line from the nearest route point to a place off the route', () => {
    const s = setup(route)
    s.loader.positionOf.mockReturnValue(off(620))
    s.wiring.onPoiSelected(far)
    expect(s.loader.footOf).toHaveBeenCalledWith(far)
    expect(s.layer.connector).toEqual([[50.05, 7.05], [far.lat, far.lon]])
  })

  it('draws none for a place on the route', () => {
    const s = setup(route)
    s.loader.positionOf.mockReturnValue(off(CONNECTOR_MIN_OFFSET_M - 1))
    s.wiring.onPoiSelected(far)
    expect(s.layer.connector).toBeNull()
  })

  it('draws none without a route, beyond the corridor limit, or without a foot point', () => {
    const none = setup(null)
    none.loader.positionOf.mockReturnValue(off(620))
    none.wiring.onPoiSelected(far)
    expect(none.layer.connector).toBeNull()

    const beyond = setup(route)
    beyond.loader.positionOf.mockReturnValue(null)
    beyond.wiring.onPoiSelected(far)
    expect(beyond.layer.connector).toBeNull()

    const noFoot = setup(route)
    noFoot.loader.positionOf.mockReturnValue(off(620))
    noFoot.loader.footOf.mockReturnValue(null)
    noFoot.wiring.onPoiSelected(far)
    expect(noFoot.layer.connector).toBeNull()
  })

  it('replaces the line on the next selection and removes it when the selection ends', () => {
    const s = setup(route)
    s.loader.positionOf.mockReturnValue(off(620))
    s.wiring.onPoiSelected(far)
    s.loader.footOf.mockReturnValue([50.08, 7.08])
    s.wiring.onPoiSelected(poi(8))
    expect(s.layer.connector![0]).toEqual([50.08, 7.08])
    s.wiring.onPoiSelected(null)
    expect(s.layer.connector).toBeNull()
  })

  it('keeps the line on a corridor change, drops it when the route is removed', () => {
    const s = setup(route)
    s.loader.positionOf.mockReturnValue(off(620))
    s.wiring.onPoiSelected(far)
    s.store.setCorridor(1000)
    expect(s.layer.connector).not.toBeNull()
    s.store.clear()
    expect(s.layer.connector).toBeNull()
  })

  it('re-evaluates the line for a newly imported route', () => {
    const s = setup(route)
    s.loader.positionOf.mockReturnValue(off(620))
    s.wiring.onPoiSelected(far)
    s.loader.positionOf.mockReturnValue(null) // the place is nowhere near the new route
    s.store.set({ ...route, name: 'Andere Runde', points: [[51, 8], [51.1, 8.1]] })
    expect(s.layer.connector).toBeNull()
  })
})

describe('mapInsets', () => {
  it('covers nothing without a route', () => {
    expect(setup(null).wiring.mapInsets()).toEqual({ left: 0, bottom: 0 })
  })
})
