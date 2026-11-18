import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRouteEditWiring } from './routeEditWiring.js'
import { LocalTrackStore } from '@/features/track/TrackStore.js'
import type { TrackEditing } from '@/features/track/TrackLayer.js'
import { buildRouteUrl } from '@/features/track/osrmRoute.js'
import { trackImportErrorMessage, TrackImportError } from '@/features/track/trackErrors.js'
import type { RoutePlan, Track, TrackPoint } from '@/features/track/trackTypes.js'

// The planned places lie a little off the ends of the line, like a searched town does.
const PLAN: RoutePlan = {
  mode: 'bike',
  waypoints: [{ lat: 51.06, lon: 13.73, label: 'Dresden' }, { lat: 50.94, lon: 13.95, label: 'Pirna' }],
}
const LINE_START: TrackPoint = [51.05, 13.74]
const LINE_END: TrackPoint = [50.95, 13.93]
const planned: Track = {
  name: 'Dresden → Pirna (Rad)', source: 'planned',
  points: [LINE_START, [51.0, 13.85], LINE_END], lengthM: 18_432, corridorM: 800, plan: PLAN,
}
const gpx: Track = { name: 'Eifelrunde', source: 'gpx', points: [[50, 7], [50.1, 7.1]], lengthM: 13_000, corridorM: 500 }

const NEW_START: TrackPoint = [51.051, 13.741]
const NEW_END: TrackPoint = [50.951, 13.931]
const SNAPPED_VIA: TrackPoint = [51.03, 13.8]
/** OSRM answer for start + `vias` via points + end. */
function osrmBody(vias = 1) {
  return {
    code: 'Ok',
    routes: [{
      distance: 21_500,
      geometry: { type: 'LineString', coordinates: [[13.741, 51.051], [13.8, 51.03], [13.86, 51.0], [13.931, 50.951]] },
    }],
    waypoints: [
      { name: 'Elbufer', distance: 10 },
      ...Array.from({ length: vias }, () => ({ name: 'Radweg', distance: 15, location: [SNAPPED_VIA[1], SNAPPED_VIA[0]] })),
      { name: 'Am Markt', distance: 20 },
    ],
  }
}
const ok = (vias = 1) => new Response(JSON.stringify(osrmBody(vias)), { status: 200 })

/** A fetch that answers only when told to. */
function deferredFetch() {
  let settle!: { resolve: (r: Response) => void; reject: (e: unknown) => void }
  const fetchFn = vi.fn<typeof fetch>(() => new Promise<Response>((resolve, reject) => { settle = { resolve, reject } }))
  return { fetchFn, resolve: (r: Response) => settle.resolve(r), reject: (e: unknown) => settle.reject(e) }
}

function setup(initial: Track | null, opts: { fetchFn?: typeof fetch; enabled?: boolean } = {}) {
  localStorage.clear()
  let n = 0
  const store = new LocalTrackStore(localStorage, { newId: () => `id${++n}` })
  if (initial) store.set(initial)
  const states: Array<TrackEditing | null> = []
  const layer = { setEditing: (e: TrackEditing | null) => { states.push(e) } }
  const flash = vi.fn<(msg: string) => void>()
  const fetchFn = opts.fetchFn ?? vi.fn<typeof fetch>(async () => ok())
  createRouteEditWiring({ store, layer, flash, fetchFn, ...(opts.enabled === undefined ? {} : { enabled: opts.enabled }) })
  const editing = () => states[states.length - 1] ?? null
  return { store, states, editing, flash, fetchFn: fetchFn as ReturnType<typeof vi.fn<typeof fetch>> }
}

const flush = () => new Promise(r => setTimeout(r, 0))
const urlOf = (f: ReturnType<typeof vi.fn<typeof fetch>>, call = 0) => f.mock.calls[call]![0]

afterEach(() => localStorage.clear())

describe('createRouteEditWiring: which routes can be edited', () => {
  it('nothing to edit without a route', () => {
    expect(setup(null).states).toEqual([null])
  })

  it('an imported route stays read-only', () => {
    expect(setup(gpx).editing()).toBeNull()
  })

  it('a planned route saved without its plan stays read-only', () => {
    const { plan: _none, ...old } = planned
    expect(setup(old).editing()).toBeNull()
  })

  it('the kill switch turns editing off', () => {
    expect(setup(planned, { enabled: false }).editing()).toBeNull()
  })

  it('a planned route gets its handles at startup: on the ENDS OF THE LINE, not on the planned places', () => {
    const { editing } = setup(planned)
    expect(editing()?.waypoints).toEqual([LINE_START, LINE_END])
    expect(editing()?.busy).toBeUndefined()
  })

  it('follows the store: handles appear with a planned route and go with an imported one or none', () => {
    const { store, editing } = setup(null)
    store.set(planned)
    expect(editing()?.waypoints).toEqual([LINE_START, LINE_END])
    store.set(gpx)
    expect(editing()).toBeNull()
    store.set(planned)
    expect(editing()).not.toBeNull()
    store.clear()
    expect(editing()).toBeNull()
  })
})

describe('createRouteEditWiring: dragging the line', () => {
  const GRAB: TrackPoint = [51.0, 13.85]
  const DROP: TrackPoint = [51.04, 13.8]

  it('asks OSRM for the route via the drop point and replaces the SAME saved route', async () => {
    const { store, editing, flash, fetchFn } = setup(planned)
    const before = store.get()!
    editing()!.onInsert(GRAB, DROP)
    await flush()

    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(urlOf(fetchFn)).toBe(buildRouteUrl({
      start: PLAN.waypoints[0]!, end: PLAN.waypoints[1]!, mode: 'bike', via: [{ lat: DROP[0], lon: DROP[1] }],
    }))
    const now = store.get()!
    expect(store.list()).toHaveLength(1)
    expect(now.id).toBe(before.id)
    expect(now.addedAt).toBe(before.addedAt)
    expect(now.corridorM).toBe(800)
    expect(now.name).toBe('Dresden → Pirna (Rad)') // the labels of start and end are kept
    expect(now.points).toEqual([NEW_START, SNAPPED_VIA, [51.0, 13.86], NEW_END])
    expect(now.plan?.waypoints).toEqual([
      PLAN.waypoints[0], { lat: SNAPPED_VIA[0], lon: SNAPPED_VIA[1] }, PLAN.waypoints[1],
    ])
    // The length is measured on the line (like for every route), not taken from OSRM's `distance`.
    expect(flash).toHaveBeenCalledWith('Route angepasst · 17,5 km')
  })

  it('locks the handles while the request runs and shows the new one where it was dropped', async () => {
    const d = deferredFetch()
    const { editing } = setup(planned, { fetchFn: d.fetchFn })
    editing()!.onInsert(GRAB, DROP)
    expect(editing()).toMatchObject({ busy: true, waypoints: [LINE_START, DROP, LINE_END] })
    d.resolve(ok())
    await flush()
    expect(editing()?.busy).toBeUndefined()
    expect(editing()?.waypoints).toEqual([NEW_START, SNAPPED_VIA, NEW_END])
  })

  it('ignores further edits until the running request is done, then takes them again', async () => {
    const d = deferredFetch()
    const { editing, fetchFn } = setup(planned, { fetchFn: d.fetchFn })
    const first = editing()!
    first.onInsert(GRAB, DROP)
    first.onMove(0, [51.2, 13.7])
    editing()!.onRemove(1)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    d.resolve(ok())
    await flush()
    editing()!.onRemove(1)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('a long-press on the line (grab = drop) adds the via point right there', async () => {
    const { store, editing } = setup(planned)
    editing()!.onInsert(GRAB, GRAB)
    await flush()
    expect(store.get()?.plan?.waypoints).toHaveLength(3)
  })
})

describe('createRouteEditWiring: handles', () => {
  it('dragging the start: requested without its old label, shown where dropped, renamed after the road', async () => {
    const d = deferredFetch()
    const { store, editing, fetchFn } = setup(planned, { fetchFn: d.fetchFn })
    const to: TrackPoint = [51.07, 13.7]
    editing()!.onMove(0, to)
    expect(urlOf(fetchFn)).toBe(buildRouteUrl({ start: { lat: 51.07, lon: 13.7 }, end: PLAN.waypoints[1]!, mode: 'bike' }))
    expect(editing()).toMatchObject({ busy: true, waypoints: [to, LINE_END] })
    d.resolve(ok(0))
    await flush()
    expect(store.get()?.name).toBe('Elbufer → Pirna (Rad)')
    expect(store.get()?.plan?.waypoints[0]).toEqual({ lat: 51.07, lon: 13.7, label: 'Elbufer' })
  })

  it('dragging the end keeps the start on the line while the request runs', () => {
    const d = deferredFetch()
    const { editing } = setup(planned, { fetchFn: d.fetchFn })
    const to: TrackPoint = [50.9, 14.0]
    editing()!.onMove(1, to)
    expect(editing()?.waypoints).toEqual([LINE_START, to])
  })

  it('tapping a via point removes it and recalculates without it', async () => {
    const via = { lat: 51.03, lon: 13.8 }
    const withVia: Track = { ...planned, plan: { mode: 'bike', waypoints: [PLAN.waypoints[0]!, via, PLAN.waypoints[1]!] } }
    const { store, editing, fetchFn } = setup(withVia, { fetchFn: vi.fn<typeof fetch>(async () => ok(0)) })
    expect(editing()?.waypoints).toEqual([LINE_START, [51.03, 13.8], LINE_END])
    editing()!.onRemove(1)
    await flush()
    expect(urlOf(fetchFn)).toBe(buildRouteUrl({ start: PLAN.waypoints[0]!, end: PLAN.waypoints[1]!, mode: 'bike' }))
    expect(store.get()?.plan?.waypoints).toHaveLength(2)
  })

  it('start and end cannot be removed: no request, handles are put back', () => {
    const { editing, states, fetchFn } = setup(planned)
    const count = states.length
    editing()!.onRemove(0)
    editing()!.onRemove(1)
    expect(fetchFn).not.toHaveBeenCalled()
    expect(states.length).toBe(count + 2)
    expect(editing()).toMatchObject({ waypoints: [LINE_START, LINE_END] })
    expect(editing()?.busy).toBeUndefined()
  })
})

describe('createRouteEditWiring: failures and interruptions', () => {
  it('a failed calculation leaves the route alone, says why and unlocks the handles', async () => {
    const { store, editing, flash } = setup(planned, { fetchFn: vi.fn<typeof fetch>(async () => new Response('', { status: 429 })) })
    const before = store.get()
    editing()!.onInsert([51.0, 13.85], [51.04, 13.8])
    await flush()
    expect(store.get()).toBe(before)
    expect(flash).toHaveBeenCalledWith(trackImportErrorMessage(new TrackImportError('route-busy')))
    expect(editing()?.busy).toBeUndefined()
    expect(editing()?.waypoints).toEqual([LINE_START, LINE_END])
  })

  it('a point far off any road is reported and changes nothing', async () => {
    const body = osrmBody()
    body.waypoints[1]!.distance = 5000
    const { store, editing, flash } = setup(planned, { fetchFn: vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body))) })
    editing()!.onInsert([51.0, 13.85], [51.3, 13.8])
    await flush()
    expect(store.get()?.points).toEqual(planned.points)
    expect(flash).toHaveBeenCalledWith(trackImportErrorMessage(new TrackImportError('route-no-road')))
  })

  it('switching to another route while the request runs aborts it and drops the result', async () => {
    const d = deferredFetch()
    const { store, editing, flash, fetchFn } = setup(planned, { fetchFn: d.fetchFn })
    const plannedId = store.get()!.id
    editing()!.onInsert([51.0, 13.85], [51.04, 13.8])
    const signal = fetchFn.mock.calls[0]![1]!.signal!
    store.set(gpx)
    expect(signal.aborted).toBe(true)
    expect(editing()).toBeNull()
    d.resolve(ok())
    await flush()
    expect(store.list().find(t => t.id === plannedId)?.points).toEqual(planned.points)
    expect(store.get()?.name).toBe('Eifelrunde')
    expect(flash).not.toHaveBeenCalled()
    expect(editing()).toBeNull()
  })

  it('closing the route while the request runs aborts it without a message', async () => {
    const d = deferredFetch()
    const { store, editing, flash, fetchFn } = setup(planned, { fetchFn: d.fetchFn })
    editing()!.onInsert([51.0, 13.85], [51.04, 13.8])
    store.clear()
    expect(fetchFn.mock.calls[0]![1]!.signal!.aborted).toBe(true)
    d.reject(new DOMException('aborted', 'AbortError'))
    await flush()
    expect(flash).not.toHaveBeenCalled()
    expect(store.list()[0]?.points).toEqual(planned.points)
    // Opening it again gives unlocked handles: the aborted request holds no lock.
    store.activate(store.list()[0]!.id)
    expect(editing()?.busy).toBeUndefined()
    expect(editing()?.waypoints).toEqual([LINE_START, LINE_END])
  })

  it('a corridor change while the request runs keeps the lock, and the new corridor survives the result', async () => {
    const d = deferredFetch()
    const { store, editing } = setup(planned, { fetchFn: d.fetchFn })
    editing()!.onInsert([51.0, 13.85], [51.04, 13.8])
    store.setCorridor(1500)
    expect(editing()?.busy).toBe(true)
    d.resolve(ok())
    await flush()
    expect(store.get()?.corridorM).toBe(1500)
    expect(store.get()?.points).toHaveLength(4)
    expect(editing()?.busy).toBeUndefined()
  })
})
