import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoutePlannerWiring, PLAN_FAILED_MESSAGE, MY_LOCATION_LABEL } from './routePlannerWiring.js'
import type { OsmPoi } from '@/features/pois/OverpassClient.js'
import type { TargetMarker } from '@/features/map/targetMarker.js'
import type { NominatimResult } from '@/core/nominatim.js'
import type { TravelMode } from '@/features/route-planner/plannerModel.js'
import type { Track } from '@/features/track/trackTypes.js'

const poi: OsmPoi = { id: 7, osmType: 'node', type: 'campsite', lat: 50.95, lon: 13.93, tags: { name: 'Camping Pirna' } }
const here = { lat: 51.05, lon: 13.74 }

function osrmBody() {
  return {
    code: 'Ok',
    routes: [{
      distance: 18_432.5,
      duration: 3000,
      geometry: {
        type: 'LineString',
        coordinates: [[13.74, 51.05], [13.85, 51.0], [13.93, 50.95]],
      },
    }],
    waypoints: [{ name: 'Start', distance: 10 }, { name: 'Ziel', distance: 20 }],
  }
}

const okFetch = () => vi.fn<typeof fetch>(async () => new Response(JSON.stringify(osrmBody()), { status: 200 }))

function fakeMarker() {
  const m = {
    pos: null as { lat: number; lon: number } | null,
    label: '',
    show: vi.fn<TargetMarker['show']>((pos, opts) => { m.pos = pos; m.label = opts.label }),
    clear: vi.fn(() => { m.pos = null; m.label = '' }),
  }
  return m
}

interface SetupOpts {
  readonly userPos?: { lat: number; lon: number } | null
  readonly requested?: { lat: number; lon: number } | null
  readonly mobile?: boolean
  readonly profiles?: readonly string[]
  readonly stored?: TravelMode | null
  readonly fetchFn?: typeof fetch
  readonly geocode?: (q: string) => Promise<NominatimResult[]>
}

function setup(o: SetupOpts = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const start = fakeMarker()
  const end = fakeMarker()
  const picks: Array<{ onPick: (lat: number, lng: number) => void; onCancel?: () => void; cancel: ReturnType<typeof vi.fn> }> = []
  const pickPoint = vi.fn((onPick: (lat: number, lng: number) => void, onCancel?: () => void) => {
    const cancel = vi.fn()
    picks.push({ onPick, ...(onCancel ? { onCancel } : {}), cancel })
    return cancel as () => void
  })
  let stored: TravelMode | null = o.stored ?? null
  const modeStore = { get: () => stored, set: vi.fn((m: TravelMode) => { stored = m }) }
  const importTrack = vi.fn<(t: Track) => void>()
  const collapseDetail = vi.fn()
  const userPos = { current: o.userPos ?? null }
  const requestUserPos = vi.fn(async () => o.requested ?? null)
  const geocode = vi.fn(o.geocode ?? (async () => []))
  const wiring = createRoutePlannerWiring({
    container,
    geocode,
    getUserPos: () => userPos.current,
    requestUserPos,
    pickPoint,
    markers: { start, end },
    getProfiles: () => o.profiles ?? [],
    modeStore,
    importTrack,
    fetchFn: o.fetchFn ?? okFetch(),
    isMobile: () => o.mobile ?? false,
    collapseDetail,
    poiLabel: p => p.tags.name ?? 'Ort',
  })
  const q = <T extends HTMLElement>(r: string) => container.querySelector<T>(`[data-ref="${r}"]`)!
  const val = (r: string) => q<HTMLInputElement>(r).value
  const modeBtn = (m: TravelMode) => container.querySelector<HTMLButtonElement>(`[data-mode="${m}"]`)!
  const panelHidden = () => (container.firstElementChild as HTMLElement).hidden
  return {
    wiring, container, start, end, picks, pickPoint, modeStore, importTrack, collapseDetail, userPos,
    requestUserPos, geocode, q, val, modeBtn, panelHidden,
  }
}

const flush = () => new Promise(r => setTimeout(r, 0))

afterEach(() => {
  document.body.innerHTML = ''
  document.body.className = ''
  localStorage.clear()
  vi.useRealTimers()
})

describe('createRoutePlannerWiring', () => {
  describe('open / close', () => {
    it('opens and closes the panel', () => {
      const { wiring, panelHidden } = setup()
      expect(wiring.isOpen()).toBe(false)
      wiring.open()
      expect(wiring.isOpen()).toBe(true)
      expect(panelHidden()).toBe(false)
      wiring.close()
      expect(wiring.isOpen()).toBe(false)
      expect(panelHidden()).toBe(true)
    })
  })

  describe('planning', () => {
    it('hands over a planned track, remembers the mode and removes the markers', async () => {
      const fetchFn = okFetch()
      const { wiring, importTrack, modeStore, start, end, q, modeBtn } = setup({ userPos: here, fetchFn })
      wiring.planFromPoi(poi, 'end')
      expect(start.show).toHaveBeenCalled()
      expect(end.show).toHaveBeenCalled()
      modeBtn('bike').click()
      q<HTMLButtonElement>('go').click()
      await flush()

      expect(fetchFn).toHaveBeenCalledTimes(1)
      expect(String(fetchFn.mock.calls[0]?.[0])).toContain('routed-bike')
      expect(importTrack).toHaveBeenCalledTimes(1)
      const track = importTrack.mock.calls[0]?.[0]
      expect(track?.source).toBe('planned')
      expect(track?.name).toContain('Camping Pirna')
      expect(modeStore.set).toHaveBeenCalledWith('bike')
      expect(start.pos).toBeNull()
      expect(end.pos).toBeNull()
      expect(wiring.isOpen()).toBe(false)
    })

    it('names map-picked points after the road OSRM snapped them to, not "Kartenpunkt"', async () => {
      // Regression: the panel's "Kartenpunkt" field text was passed on as the label, so
      // the waypoint-name fallback in fetchPlannedRoute never kicked in and every route
      // between two map taps was called "Kartenpunkt → Kartenpunkt (Auto)".
      const { wiring, q, picks, importTrack } = setup()
      wiring.open()
      q<HTMLButtonElement>('startPick').click()
      picks[0]?.onPick(51.05, 13.74)
      q<HTMLButtonElement>('endPick').click()
      picks[1]?.onPick(50.95, 13.93)
      q<HTMLButtonElement>('go').click()
      await flush()

      expect(importTrack).toHaveBeenCalledTimes(1)
      expect(importTrack.mock.calls[0]?.[0]?.name).toBe('Start → Ziel (Auto)')
    })

    it('uses the snapped road for a map-picked start but keeps the POI name for the destination', async () => {
      const { wiring, q, picks, importTrack } = setup()
      wiring.planFromPoi(poi, 'end')
      q<HTMLButtonElement>('startPick').click()
      picks[0]?.onPick(51.05, 13.74)
      q<HTMLButtonElement>('go').click()
      await flush()

      expect(importTrack.mock.calls[0]?.[0]?.name).toBe('Start → Camping Pirna (Auto)')
    })

    it('refreshes a held "Mein Standort" start to the current position when the planner opens again', () => {
      // A gps point is a snapshot; the panel keeps its points across close/open, so after a drive
      // "Mein Standort" would silently point at where the user was an hour ago.
      const { wiring, start, userPos } = setup({ userPos: here })
      wiring.planFromPoi(poi, 'end')
      expect(start.pos).toEqual(here)
      wiring.close()
      userPos.current = { lat: 50.0, lon: 14.0 }
      wiring.open()
      expect(start.pos).toEqual({ lat: 50.0, lon: 14.0 })
    })

    it('refreshes a held "Mein Standort" start on the next "Als Ziel" as well', () => {
      const { wiring, start, userPos } = setup({ userPos: here })
      wiring.planFromPoi(poi, 'end')
      wiring.close()
      userPos.current = { lat: 50.0, lon: 14.0 }
      wiring.planFromPoi({ ...poi, id: 8 }, 'end')
      expect(start.pos).toEqual({ lat: 50.0, lon: 14.0 })
    })

    it('leaves a start that was searched or picked alone when the position changes', () => {
      const { wiring, start, picks, q, userPos } = setup({ userPos: here })
      wiring.open()
      q<HTMLButtonElement>('startPick').click()
      picks[0]?.onPick(50.5, 13.5)
      wiring.close()
      userPos.current = { lat: 50.0, lon: 14.0 }
      wiring.open()
      expect(start.pos).toEqual({ lat: 50.5, lon: 13.5 })
    })

    it('does not remember the mode when planning fails', async () => {
      const fetchFn = vi.fn<typeof fetch>(async () => new Response('{}', { status: 500 }))
      const { wiring, importTrack, modeStore, q } = setup({ userPos: here, fetchFn })
      wiring.planFromPoi(poi, 'end')
      q<HTMLButtonElement>('go').click()
      await flush()
      expect(modeStore.set).not.toHaveBeenCalled()
      expect(importTrack).not.toHaveBeenCalled()
    })

    it('shows a German message in the panel and keeps it open on an OSRM error', async () => {
      const fetchFn = vi.fn<typeof fetch>(async () =>
        new Response(JSON.stringify({ code: 'NoRoute', message: 'x' }), { status: 400 }))
      const { wiring, q, start } = setup({ userPos: here, fetchFn })
      wiring.planFromPoi(poi, 'end')
      q<HTMLButtonElement>('go').click()
      await flush()
      expect(q('status').textContent).toBe('Keine Route zwischen Start und Ziel gefunden – anderes Verkehrsmittel oder andere Punkte versuchen.')
      expect(q('status').classList.contains('planner-status-error')).toBe(true)
      expect(wiring.isOpen()).toBe(true)
      expect(start.pos).not.toBeNull() // markers stay while the planner is open
    })

    it('shows the generic text when importTrack throws something that is not a track error', async () => {
      const { wiring, q, importTrack } = setup({ userPos: here })
      importTrack.mockImplementation(() => { throw new Error('boom') })
      wiring.planFromPoi(poi, 'end')
      q<HTMLButtonElement>('go').click()
      await flush()
      expect(q('status').textContent).toBe(PLAN_FAILED_MESSAGE)
    })

    it('does not report an aborted request as an error', async () => {
      const fetchFn = vi.fn<typeof fetch>((_url, init) => new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))
      }))
      const { wiring, q, importTrack } = setup({ userPos: here, fetchFn })
      wiring.planFromPoi(poi, 'end')
      q<HTMLButtonElement>('go').click()
      await flush()
      wiring.close()
      await flush()
      expect(importTrack).not.toHaveBeenCalled()
      expect(q('status').textContent).toBe('')
    })
  })

  describe('travel mode default', () => {
    it.each([
      [['hiker'], 'foot'],
      [['cyclist'], 'bike'],
      [['camper'], 'car'],
      [[], 'car'],
    ] as const)('profiles %j -> %s', (profiles, mode) => {
      const { wiring, modeBtn } = setup({ profiles })
      wiring.open()
      expect(modeBtn(mode).getAttribute('aria-checked')).toBe('true')
    })

    it('the remembered mode wins over the profiles', () => {
      const { wiring, modeBtn } = setup({ profiles: ['hiker'], stored: 'car' })
      wiring.open()
      expect(modeBtn('car').getAttribute('aria-checked')).toBe('true')
      expect(modeBtn('foot').getAttribute('aria-checked')).toBe('false')
    })
  })

  describe('place suggestions and own position', () => {
    it('geocodes with limit 5 and maps the strings to numbers', async () => {
      vi.useFakeTimers()
      const geocode = async (): Promise<NominatimResult[]> =>
        [{ lat: '50.94', lon: '6.96', display_name: 'Köln, Nordrhein-Westfalen, Deutschland' }]
      const { wiring, q, geocode: spy, val } = setup({ geocode })
      wiring.open()
      const input = q<HTMLInputElement>('startInput')
      input.value = 'Köln'
      input.dispatchEvent(new Event('input'))
      await vi.advanceTimersByTimeAsync(400)
      expect(spy).toHaveBeenCalledWith('Köln', { limit: 5 })
      q('startList').querySelector('li')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      expect(val('startInput')).toBe('Köln') // shortened by the panel
    })

    it('"Mein Standort" uses the known position without asking again', async () => {
      const { wiring, q, requestUserPos, val, start } = setup({ userPos: here })
      wiring.open()
      q<HTMLButtonElement>('startLocate').click()
      await flush()
      expect(requestUserPos).not.toHaveBeenCalled()
      expect(val('startInput')).toBe(MY_LOCATION_LABEL)
      expect(start.pos).toEqual(here)
    })

    it('asks for the position when it is not known yet', async () => {
      const { wiring, q, requestUserPos, val } = setup({ requested: here })
      wiring.open()
      q<HTMLButtonElement>('endLocate').click()
      await flush()
      expect(requestUserPos).toHaveBeenCalledTimes(1)
      expect(val('endInput')).toBe(MY_LOCATION_LABEL)
    })

    it('shows the panel message and leaves the field alone when there is no position', async () => {
      const { wiring, q, val } = setup()
      wiring.open()
      q<HTMLButtonElement>('startLocate').click()
      await flush()
      expect(q('status').textContent).toContain('Standort nicht verfügbar')
      expect(val('startInput')).toBe('')
    })
  })

  describe('planFromPoi', () => {
    it('opens the panel with the POI as destination and "Mein Standort" as start', () => {
      const { wiring, val, panelHidden } = setup({ userPos: here })
      wiring.planFromPoi(poi, 'end')
      expect(panelHidden()).toBe(false)
      expect(val('endInput')).toBe('Camping Pirna')
      expect(val('startInput')).toBe(MY_LOCATION_LABEL)
    })

    it('leaves the start empty when the position is unknown', () => {
      const { wiring, val } = setup()
      wiring.planFromPoi(poi, 'end')
      expect(val('endInput')).toBe('Camping Pirna')
      expect(val('startInput')).toBe('')
    })

    it('"Als Start" never fills the destination with the position', () => {
      const { wiring, val } = setup({ userPos: here })
      wiring.planFromPoi(poi, 'start')
      expect(val('startInput')).toBe('Camping Pirna')
      expect(val('endInput')).toBe('')
    })

    it('keeps an already chosen start', () => {
      const { wiring, val } = setup({ userPos: here })
      wiring.planFromPoi(poi, 'start')
      wiring.planFromPoi({ ...poi, id: 8, lat: 50.5, tags: { name: 'Anderer Platz' } }, 'end')
      expect(val('startInput')).toBe('Camping Pirna')
      expect(val('endInput')).toBe('Anderer Platz')
    })

    it('collapses the detail sheet on mobile', () => {
      const { wiring, collapseDetail } = setup({ mobile: true })
      wiring.planFromPoi(poi, 'end')
      expect(collapseDetail).toHaveBeenCalledTimes(1)
    })

    it('does not collapse the detail sheet on desktop', () => {
      const { wiring, collapseDetail } = setup({ mobile: false })
      wiring.planFromPoi(poi, 'end')
      expect(collapseDetail).not.toHaveBeenCalled()
    })
  })

  describe('map pick and offerPoi', () => {
    it('offerPoi is false when the panel is not picking', () => {
      const { wiring } = setup()
      expect(wiring.offerPoi(poi)).toBe(false)
      wiring.open()
      expect(wiring.offerPoi(poi)).toBe(false)
    })

    it('takes the POI as the point being picked, ends the pick and keeps it on a later done(null)', () => {
      const { wiring, q, picks, val, pickPoint } = setup()
      wiring.open()
      q<HTMLButtonElement>('endPick').click()
      expect(pickPoint).toHaveBeenCalledTimes(1)
      expect(document.body.classList.contains('planner-picking')).toBe(true)

      expect(wiring.offerPoi(poi)).toBe(true)
      expect(val('endInput')).toBe('Camping Pirna')
      expect(document.body.classList.contains('planner-picking')).toBe(false)
      expect(picks[0]?.cancel).toHaveBeenCalledTimes(1)

      // MapService reports the cancelled pick afterwards: the field must stay.
      picks[0]?.onCancel?.()
      expect(val('endInput')).toBe('Camping Pirna')
      // The pick is over, so a second tap is not taken.
      expect(wiring.offerPoi(poi)).toBe(false)
    })

    it('a map click sets "Kartenpunkt"', () => {
      const { wiring, q, picks, val, end } = setup()
      wiring.open()
      q<HTMLButtonElement>('endPick').click()
      picks[0]?.onPick(50.5, 13.5)
      expect(val('endInput')).toBe('Kartenpunkt')
      expect(end.pos).toEqual({ lat: 50.5, lon: 13.5 })
    })

    it('a cancelled pick leaves the field alone', () => {
      const { wiring, q, picks, val } = setup()
      wiring.open()
      q<HTMLButtonElement>('startPick').click()
      picks[0]?.onCancel?.()
      expect(val('startInput')).toBe('')
      expect(document.body.classList.contains('planner-picking')).toBe(false)
    })
  })

  describe('markers', () => {
    it('shows start and destination while the planner is open and clears both on close', () => {
      const { wiring, start, end } = setup({ userPos: here })
      wiring.planFromPoi(poi, 'end')
      expect(start.pos).toEqual(here)
      expect(start.label).toBe(`Start: ${MY_LOCATION_LABEL}`)
      expect(end.pos).toEqual({ lat: poi.lat, lon: poi.lon })
      expect(end.label).toBe('Ziel: Camping Pirna')
      wiring.close()
      expect(start.pos).toBeNull()
      expect(end.pos).toBeNull()
    })

    it('clears the markers when the panel is closed with its own button', () => {
      const { wiring, start, end, q } = setup({ userPos: here })
      wiring.planFromPoi(poi, 'end')
      q<HTMLButtonElement>('close').click()
      expect(wiring.isOpen()).toBe(false)
      expect(start.pos).toBeNull()
      expect(end.pos).toBeNull()
    })

    it('brings the markers back when the panel is opened again with its points', () => {
      const { wiring, end } = setup()
      wiring.planFromPoi(poi, 'end')
      wiring.close()
      expect(end.pos).toBeNull()
      wiring.open()
      expect(end.pos).toEqual({ lat: poi.lat, lon: poi.lon })
    })

    it('removes a marker when its field is emptied', () => {
      const { wiring, end, q } = setup()
      wiring.planFromPoi(poi, 'end')
      const input = q<HTMLInputElement>('endInput')
      input.value = 'x'
      input.dispatchEvent(new Event('input'))
      expect(end.pos).toBeNull()
    })
  })
})
