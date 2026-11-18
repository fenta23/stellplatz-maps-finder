import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSearchBoxWiring } from './searchBoxWiring.js'
import { MY_LOCATION_LABEL } from './routePlannerWiring.js'
import type { OsmPoi } from '@/features/pois/OverpassClient.js'
import type { TargetMarker } from '@/features/map/targetMarker.js'
import type { NominatimResult } from '@/core/nominatim.js'
import type { TravelMode } from '@/features/route-planner/plannerModel.js'
import type { Track } from '@/features/track/trackTypes.js'
import { KNOWN_FILTER_IDS, type AiChatResponse, type AiIntent } from '@/features/ai/intentSchema.js'

const poi: OsmPoi = { id: 7, osmType: 'node', type: 'campsite', lat: 50.95, lon: 13.93, tags: { name: 'Camping Pirna' } }
const here = { lat: 51.05, lon: 13.74 }
const koeln: NominatimResult = { lat: '50.94', lon: '6.96', display_name: 'Köln, Nordrhein-Westfalen, Deutschland' }
const intent: AiIntent = { place: 'Bodensee', enableFilters: [KNOWN_FILTER_IDS[0]!], adHocFilters: [], route: null }
const ready: AiChatResponse = { status: 'ready', reply: 'Hier ist deine Auswahl.', intent }

const okFetch = () => vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
  code: 'Ok',
  routes: [{
    distance: 18_432.5,
    duration: 3000,
    geometry: { type: 'LineString', coordinates: [[13.74, 51.05], [13.85, 51.0], [13.93, 50.95]] },
  }],
  waypoints: [{ name: 'Start', distance: 10 }, { name: 'Ziel', distance: 20 }],
}), { status: 200 }))

function fakeMarker() {
  const m = {
    pos: null as { lat: number; lon: number } | null,
    show: vi.fn<TargetMarker['show']>((pos) => { m.pos = pos }),
    clear: vi.fn(() => { m.pos = null }),
  }
  return m
}

interface SetupOpts {
  readonly userPos?: { lat: number; lon: number } | null
  readonly mobile?: boolean
  readonly viewbox?: [number, number, number, number]
  readonly sendResponse?: AiChatResponse
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
  let stored: TravelMode | null = null
  const modeStore = { get: () => stored, set: vi.fn((m: TravelMode) => { stored = m }) }
  const importTrack = vi.fn<(t: Track) => void>()
  const collapseDetail = vi.fn()
  const geocode = vi.fn(async (_q: string, _opts?: unknown): Promise<NominatimResult[]> => [koeln])
  const centerOn = vi.fn()
  const applyAiIntent = vi.fn()
  const sendAiChat = vi.fn(async (_m: readonly unknown[]): Promise<AiChatResponse> => o.sendResponse ?? ready)
  const expandUi = vi.fn()
  const openImport = vi.fn()
  const fetchFn = okFetch()
  const wiring = createSearchBoxWiring({
    container,
    planner: {
      geocode: geocode as never,
      getViewbox: () => o.viewbox as never,
      getUserPos: () => o.userPos ?? null,
      requestUserPos: async () => null,
      pickPoint,
      markers: { start, end },
      getProfiles: () => [],
      modeStore,
      importTrack,
      fetchFn,
      isMobile: () => o.mobile ?? false,
      collapseDetail,
      poiLabel: p => p.tags.name ?? 'Ort',
    },
    centerOn,
    applyAiIntent,
    sendAiChat: sendAiChat as never,
    expandUi,
    openImport,
  })
  const q = <T extends HTMLElement>(r: string) => container.querySelector<T>(`[data-ref="${r}"]`)!
  const root = () => container.querySelector<HTMLElement>('.sbx')!
  const mode = () => root().dataset.mode
  const plannerPanel = () => container.querySelector<HTMLElement>('.planner-panel')!
  const aiDialog = () => container.querySelector<HTMLElement>('.ai-dialog')!
  const options = () => [...container.querySelectorAll<HTMLElement>('.place-option')]
  const aiRow = () => options().find(x => x.classList.contains('place-option-action'))
  const mousedown = (el: HTMLElement) => el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  const type = (v: string) => { const i = q<HTMLInputElement>('input'); i.value = v; i.dispatchEvent(new Event('input')) }
  const esc = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  const pickPlace = async (text = 'Köln') => {
    type(text)
    await vi.advanceTimersByTimeAsync(400)
    mousedown(options().find(x => !x.classList.contains('place-option-action'))!)
  }
  return {
    wiring, container, start, end, picks, pickPoint, importTrack, collapseDetail, geocode, centerOn,
    applyAiIntent, sendAiChat, expandUi, openImport, fetchFn, q, root, mode, plannerPanel, aiDialog,
    options, aiRow, mousedown, type, esc, pickPlace,
  }
}

const flush = async () => { await vi.advanceTimersByTimeAsync(0) }

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => {
  document.body.innerHTML = ''
  document.body.className = ''
  localStorage.clear()
  vi.useRealTimers()
})

describe('createSearchBoxWiring', () => {
  describe('place search in the line', () => {
    it('queries the geocoder with limit 6 and the viewbox', async () => {
      const viewbox: [number, number, number, number] = [5, 55, 15, 47]
      const t = setup({ viewbox })
      t.type('Köln')
      await vi.advanceTimersByTimeAsync(400)
      expect(t.geocode).toHaveBeenCalledWith('Köln', { limit: 6, viewbox })
    })

    it('centers the map on the chosen place and stays in search mode', async () => {
      const t = setup()
      await t.pickPlace()
      expect(t.centerOn).toHaveBeenCalledWith(50.94, 6.96)
      expect(t.mode()).toBe('search')
      expect(t.wiring.isExpanded()).toBe(false)
    })
  })

  describe('route button', () => {
    it('without a place opens the planner with focus on the start field', () => {
      const t = setup()
      t.q<HTMLButtonElement>('routeBtn').click()
      expect(t.mode()).toBe('route')
      expect(document.body.classList.contains('searchbox-open')).toBe(true)
      expect(t.q('routeSlot').hidden).toBe(false)
      expect(t.plannerPanel().hidden).toBe(false)
      expect(document.activeElement).toBe(t.q('startInput'))
      expect(t.expandUi).toHaveBeenCalled()
    })

    it('after a place choice sets the destination (short label) and "Mein Standort" as start, focus on "Route berechnen"', async () => {
      const t = setup({ userPos: here })
      await t.pickPlace()
      t.q<HTMLButtonElement>('routeBtn').click()
      expect(t.mode()).toBe('route')
      expect(t.q<HTMLInputElement>('endInput').value).toBe('Köln')
      expect(t.q<HTMLInputElement>('startInput').value).toBe(MY_LOCATION_LABEL)
      expect(document.activeElement).toBe(t.q('go'))
    })

    it('after a place choice without known position leaves the start empty and focused', async () => {
      const t = setup()
      await t.pickPlace()
      t.q<HTMLButtonElement>('routeBtn').click()
      expect(t.q<HTMLInputElement>('endInput').value).toBe('Köln')
      expect(t.q<HTMLInputElement>('startInput').value).toBe('')
      expect(document.activeElement).toBe(t.q('startInput'))
    })
  })

  describe('closing the route mode', () => {
    it('header close button returns to search, hides the panel, clears markers and the body class', () => {
      const t = setup({ userPos: here })
      t.wiring.planFromPoi(poi, 'end')
      expect(t.end.pos).not.toBeNull()
      t.q<HTMLButtonElement>('close').click()
      expect(t.mode()).toBe('search')
      expect(t.plannerPanel().hidden).toBe(true)
      expect(t.start.pos).toBeNull()
      expect(t.end.pos).toBeNull()
      expect(document.body.classList.contains('searchbox-open')).toBe(false)
    })

    it('Escape closes the planner and the box follows', () => {
      const t = setup()
      t.wiring.openRoute()
      t.esc()
      expect(t.plannerPanel().hidden).toBe(true)
      expect(t.mode()).toBe('search')
      expect(t.wiring.isExpanded()).toBe(false)
    })

    it('a successful calculation imports the track and returns to search', async () => {
      const t = setup({ userPos: here })
      t.wiring.planFromPoi(poi, 'end')
      t.q<HTMLButtonElement>('go').click()
      await flush()
      expect(t.fetchFn).toHaveBeenCalledTimes(1)
      expect(t.importTrack).toHaveBeenCalledTimes(1)
      expect(t.mode()).toBe('search')
      expect(t.plannerPanel().hidden).toBe(true)
    })

    it('the import link closes the planner, returns to search and calls openImport once', () => {
      const t = setup()
      t.wiring.openRoute()
      t.q<HTMLButtonElement>('importLink').click()
      expect(t.openImport).toHaveBeenCalledTimes(1)
      expect(t.plannerPanel().hidden).toBe(true)
      expect(t.mode()).toBe('search')
    })
  })

  describe('public API: route', () => {
    it('openRoute() shows the planner in route mode and expands the UI', () => {
      const t = setup()
      t.wiring.openRoute()
      expect(t.mode()).toBe('route')
      expect(t.plannerPanel().hidden).toBe(false)
      expect(t.expandUi).toHaveBeenCalled()
    })

    it('planFromPoi() enters route mode with the POI as destination', () => {
      const t = setup()
      t.wiring.planFromPoi(poi, 'end')
      expect(t.mode()).toBe('route')
      expect(t.plannerPanel().hidden).toBe(false)
      expect(t.q<HTMLInputElement>('endInput').value).toBe('Camping Pirna')
    })

    it('planFromPoi() collapses the detail sheet on mobile', () => {
      const t = setup({ mobile: true })
      t.wiring.planFromPoi(poi, 'end')
      expect(t.collapseDetail).toHaveBeenCalledTimes(1)
    })

    it('offerPoi() is false without a map pick', () => {
      const t = setup()
      expect(t.wiring.offerPoi(poi)).toBe(false)
      t.wiring.openRoute()
      expect(t.wiring.offerPoi(poi)).toBe(false)
    })

    it('offerPoi() takes the POI while a map pick runs', () => {
      const t = setup()
      t.wiring.openRoute()
      t.q<HTMLButtonElement>('endPick').click()
      expect(t.wiring.offerPoi(poi)).toBe(true)
      expect(t.q<HTMLInputElement>('endInput').value).toBe('Camping Pirna')
    })
  })

  describe('AI', () => {
    it('setAiEnabled(true) adds the sparkle button and the AI row; false removes the button', async () => {
      const t = setup()
      expect(t.container.querySelector('[data-ref="aiBtn"]')).toBeNull()
      t.wiring.setAiEnabled(true)
      expect(t.container.querySelector('[data-ref="aiBtn"]')).not.toBeNull()
      t.type('Bodensee')
      await vi.advanceTimersByTimeAsync(400)
      expect(t.aiRow()?.textContent).toContain('Mit KI suchen: „Bodensee“')
      t.wiring.setAiEnabled(false)
      expect(t.container.querySelector('[data-ref="aiBtn"]')).toBeNull()
    })

    it('the AI row opens the dialog and sends the search text as first question', async () => {
      const t = setup()
      t.wiring.setAiEnabled(true)
      t.type('Bodensee')
      await vi.advanceTimersByTimeAsync(400)
      t.mousedown(t.aiRow()!)
      await flush()
      expect(t.mode()).toBe('ai')
      expect(t.aiDialog().hidden).toBe(false)
      expect(t.sendAiChat).toHaveBeenCalledTimes(1)
      expect(t.sendAiChat.mock.calls[0]![0]).toEqual([{ role: 'user', content: 'Bodensee' }])
      expect(t.expandUi).toHaveBeenCalled()
    })

    it('the sparkle button with an empty field opens the dialog without a request', async () => {
      const t = setup()
      t.wiring.setAiEnabled(true)
      t.q<HTMLButtonElement>('aiBtn').click()
      await vi.advanceTimersByTimeAsync(60)
      expect(t.mode()).toBe('ai')
      expect(t.aiDialog().hidden).toBe(false)
      expect(t.sendAiChat).not.toHaveBeenCalled()
    })

    it('"Auf Karte zeigen" applies the intent, closes the dialog and returns to search', async () => {
      const t = setup()
      t.wiring.setAiEnabled(true)
      t.type('Bodensee')
      t.q<HTMLButtonElement>('aiBtn').click()
      await flush()
      t.container.querySelector<HTMLButtonElement>('.ai-result-apply')!.click()
      expect(t.applyAiIntent).toHaveBeenCalledWith(intent)
      expect(t.aiDialog().hidden).toBe(true)
      expect(t.mode()).toBe('search')
    })

    it('a route wish switches to the route form and prefills it, without computing', async () => {
      const routeIntent: AiIntent = {
        place: 'Lindau', enableFilters: [KNOWN_FILTER_IDS[0]!], adHocFilters: [],
        route: { from: 'Konstanz', to: 'Lindau', mode: 'bike' },
      }
      const s = setup({ sendResponse: { status: 'ready', reply: 'Ich bereite die Route vor.', intent: routeIntent } })
      s.geocode.mockImplementation(async (name: string) => [
        { lat: name === 'Konstanz' ? '47.66' : '47.55', lon: name === 'Konstanz' ? '9.17' : '9.68', display_name: `${name}, Deutschland` },
      ])
      s.wiring.setAiEnabled(true)
      s.type('mit dem Rad von Konstanz nach Lindau')
      await vi.advanceTimersByTimeAsync(400)
      s.mousedown(s.aiRow()!)
      await flush()
      s.container.querySelector<HTMLButtonElement>('.ai-result-apply')!.click()
      await flush()

      expect(s.applyAiIntent).toHaveBeenCalledWith(routeIntent)
      expect(s.mode()).toBe('route')
      expect(s.aiDialog().hidden).toBe(true)
      expect(s.plannerPanel().hidden).toBe(false)
      expect(s.q<HTMLInputElement>('startInput').value).toBe('Konstanz')
      expect(s.q<HTMLInputElement>('endInput').value).toBe('Lindau')
      expect(s.container.querySelector('[data-mode="bike"]')!.getAttribute('aria-checked')).toBe('true')
      expect(s.q<HTMLButtonElement>('go').disabled).toBe(false)
      expect(document.activeElement).toBe(s.q('go'))
      // Prefilled only: the user presses "Route berechnen".
      expect(s.fetchFn).not.toHaveBeenCalled()
      expect(s.importTrack).not.toHaveBeenCalled()
    })

    it('a route wish whose destination is not found stays in the form with the name and a hint', async () => {
      const routeIntent: AiIntent = {
        place: 'Nirgendwo', enableFilters: [], adHocFilters: [],
        route: { from: null, to: 'Nirgendwo', mode: null },
      }
      const s = setup({ userPos: here, sendResponse: { status: 'ready', reply: 'Ich bereite die Route vor.', intent: routeIntent } })
      s.geocode.mockResolvedValue([])
      s.wiring.setAiEnabled(true)
      s.q<HTMLButtonElement>('aiBtn').click()
      const input = s.aiDialog().querySelector<HTMLInputElement>('.ai-input')!
      input.value = 'Route nach Nirgendwo'
      s.aiDialog().querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await flush()
      s.container.querySelector<HTMLButtonElement>('.ai-result-apply')!.click()
      await flush()

      expect(s.mode()).toBe('route')
      expect(s.q<HTMLInputElement>('startInput').value).toBe(MY_LOCATION_LABEL)
      expect(s.q<HTMLInputElement>('endInput').value).toBe('Nirgendwo')
      expect(s.q<HTMLButtonElement>('go').disabled).toBe(true)
      expect(s.container.querySelector('.planner-status')!.textContent).toContain('nicht gefunden')
    })

    it('Escape in AI mode closes the dialog and returns to search', async () => {
      const t = setup()
      t.wiring.setAiEnabled(true)
      t.q<HTMLButtonElement>('aiBtn').click()
      await vi.advanceTimersByTimeAsync(60)
      t.esc()
      expect(t.aiDialog().hidden).toBe(true)
      expect(t.mode()).toBe('search')
    })

    it('setAiEnabled(false) in AI mode closes the dialog, returns to search and removes the button', async () => {
      const t = setup()
      t.wiring.setAiEnabled(true)
      t.q<HTMLButtonElement>('aiBtn').click()
      await vi.advanceTimersByTimeAsync(60)
      t.wiring.setAiEnabled(false)
      expect(t.aiDialog().hidden).toBe(true)
      expect(t.mode()).toBe('search')
      expect(t.container.querySelector('[data-ref="aiBtn"]')).toBeNull()
    })
  })

  describe('mode switches', () => {
    it('planFromPoi() out of AI mode switches to route, closes the dialog and keeps the planner open', async () => {
      const t = setup()
      t.wiring.setAiEnabled(true)
      t.q<HTMLButtonElement>('aiBtn').click()
      await vi.advanceTimersByTimeAsync(60)
      t.wiring.planFromPoi(poi, 'end')
      expect(t.mode()).toBe('route')
      expect(t.aiDialog().hidden).toBe(true)
      expect(t.plannerPanel().hidden).toBe(false)
      expect(t.q<HTMLInputElement>('endInput').value).toBe('Camping Pirna')
    })

    it('close() from route mode returns to search and closes the planner', () => {
      const t = setup()
      t.wiring.openRoute()
      t.wiring.close()
      expect(t.mode()).toBe('search')
      expect(t.plannerPanel().hidden).toBe(true)
    })

    it('close() from AI mode returns to search and closes the dialog', async () => {
      const t = setup()
      t.wiring.setAiEnabled(true)
      t.q<HTMLButtonElement>('aiBtn').click()
      await vi.advanceTimersByTimeAsync(60)
      t.wiring.close()
      expect(t.mode()).toBe('search')
      expect(t.aiDialog().hidden).toBe(true)
    })

    it('close() in search mode does nothing and does not throw', () => {
      const t = setup()
      expect(() => t.wiring.close()).not.toThrow()
      expect(t.mode()).toBe('search')
      expect(t.expandUi).not.toHaveBeenCalled()
    })

    it('isExpanded() is true exactly in route and ai mode', async () => {
      const t = setup()
      t.wiring.setAiEnabled(true)
      expect(t.wiring.isExpanded()).toBe(false)
      t.wiring.openRoute()
      expect(t.wiring.isExpanded()).toBe(true)
      t.wiring.close()
      expect(t.wiring.isExpanded()).toBe(false)
      t.q<HTMLButtonElement>('aiBtn').click()
      await vi.advanceTimersByTimeAsync(60)
      expect(t.wiring.isExpanded()).toBe(true)
      t.wiring.close()
      expect(t.wiring.isExpanded()).toBe(false)
    })

    it('expandUi is called on every switch into route/ai, not when returning to search', async () => {
      const t = setup()
      t.wiring.setAiEnabled(true)
      t.wiring.openRoute()
      expect(t.expandUi).toHaveBeenCalledTimes(1)
      t.wiring.close()
      expect(t.expandUi).toHaveBeenCalledTimes(1)
      t.q<HTMLButtonElement>('aiBtn').click()
      await vi.advanceTimersByTimeAsync(60)
      expect(t.expandUi).toHaveBeenCalledTimes(2)
      t.wiring.close()
      expect(t.expandUi).toHaveBeenCalledTimes(2)
      t.wiring.planFromPoi(poi, 'end')
      expect(t.expandUi).toHaveBeenCalledTimes(3)
    })

    it('focusSearch() focuses the search field in search mode only', () => {
      const t = setup()
      t.wiring.focusSearch()
      expect(document.activeElement).toBe(t.q('input'))
      ;(document.activeElement as HTMLElement).blur()
      t.wiring.openRoute()
      t.wiring.focusSearch()
      expect(document.activeElement).not.toBe(t.q('input'))
    })
  })
})
