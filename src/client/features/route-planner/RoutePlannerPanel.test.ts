import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RoutePlannerPanel, type RoutePlannerDeps } from './RoutePlannerPanel.js'
import type { PlaceSuggestion } from '@/core/PlaceField.js'
import type { PlanPoint, PlanRequest } from './plannerModel.js'
import type { TravelMode } from '@/core/travelMode.js'

const koeln: PlaceSuggestion = { label: 'Köln, Nordrhein-Westfalen, Deutschland', lat: 50.94, lon: 6.96 }
const poi: PlanPoint = { lat: 50.1, lon: 7.2, label: 'Stellplatz am See', kind: 'poi' }

type PickDone = (pos: { lat: number; lon: number } | null) => void

function setup(over: Partial<RoutePlannerDeps> = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const picks: Array<{ done: PickDone; cancel: ReturnType<typeof vi.fn> }> = []
  const deps = {
    suggest: vi.fn(async (_q: string): Promise<readonly PlaceSuggestion[]> => [koeln]),
    locate: vi.fn(async (): Promise<{ lat: number; lon: number } | null> => ({ lat: 51, lon: 8 })),
    pickOnMap: vi.fn((done: PickDone) => {
      const cancel = vi.fn()
      picks.push({ done, cancel })
      return cancel as () => void
    }),
    plan: vi.fn(async (_req: PlanRequest, _signal: AbortSignal): Promise<void> => {}),
    describeError: vi.fn((e: unknown) => `Fehler: ${(e as Error).message}`),
    initialMode: vi.fn((): TravelMode => 'car'),
    onModeChange: vi.fn((_m: TravelMode) => {}),
    onPointsChange: vi.fn((_s: PlanPoint | null, _e: PlanPoint | null) => {}),
  }
  const panel = new RoutePlannerPanel(container, { ...deps, ...over })
  const q = <T extends HTMLElement>(r: string) => container.querySelector<T>(`[data-ref="${r}"]`)!
  const val = (r: string) => q<HTMLInputElement>(r).value
  const go = () => q<HTMLButtonElement>('go')
  const status = () => q('status')
  const modeBtn = (m: TravelMode) => container.querySelector<HTMLButtonElement>(`[data-mode="${m}"]`)!
  const flush = async () => { await vi.advanceTimersByTimeAsync(0) }
  const esc = (target: EventTarget = document) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  const typeInto = (r: string, value: string) => {
    const el = q<HTMLInputElement>(r)
    el.value = value
    el.dispatchEvent(new Event('input'))
  }
  /** Tippen + Debounce + Auswahl des ersten Vorschlags. */
  const pickSuggestion = async (r: 'startInput' | 'endInput', text = 'Köln') => {
    typeInto(r, text)
    await vi.advanceTimersByTimeAsync(400)
    const list = q(r === 'startInput' ? 'startList' : 'endList')
    list.querySelector('li')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  }
  return { container, deps, panel, q, val, go, status, modeBtn, flush, esc, typeInto, pickSuggestion, picks }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; document.body.className = '' })

describe('RoutePlannerPanel – structure', () => {
  it('is closed at first and renders fields, radiogroup and status', () => {
    const { panel, container, q, go, modeBtn } = setup()
    expect(panel.isOpen()).toBe(false)
    expect(container.querySelector<HTMLElement>('.planner-panel')!.hidden).toBe(true)
    expect(q('status').getAttribute('role')).toBe('status')
    expect(q('status').getAttribute('aria-live')).toBe('polite')
    expect(container.querySelector('[role="radiogroup"]')).not.toBeNull()
    expect(container.querySelectorAll('[role="radio"]')).toHaveLength(3)
    expect(modeBtn('car').getAttribute('aria-checked')).toBe('true')
    expect(go().disabled).toBe(true)
    for (const r of ['startLocate', 'startPick', 'endLocate', 'endPick', 'swap']) {
      expect(q(r).getAttribute('aria-label')).toBeTruthy()
    }
    expect(q('startInput').getAttribute('aria-label')).toBe('Start')
    expect(q('endInput').getAttribute('aria-label')).toBe('Ziel')
  })

  it('shows and hides the panel with open/close', () => {
    const { panel, container } = setup()
    const root = container.querySelector<HTMLElement>('.planner-panel')!
    panel.open()
    expect(panel.isOpen()).toBe(true)
    expect(root.hidden).toBe(false)
    panel.open() // idempotent
    expect(panel.isOpen()).toBe(true)
    panel.close()
    expect(panel.isOpen()).toBe(false)
    expect(root.hidden).toBe(true)
  })

  it('has no header, close button or dialog role of its own', () => {
    const { container } = setup()
    const root = container.querySelector<HTMLElement>('.planner-panel')!
    expect(root.hasAttribute('role')).toBe(false)
    expect(container.querySelector('[data-ref="close"]')).toBeNull()
  })

  it('calls onClose once per real close (Esc, close()), not when already closed', () => {
    const onClose = vi.fn()
    const { panel, esc } = setup({ onClose })
    panel.close()
    expect(onClose).not.toHaveBeenCalled()
    panel.open()
    esc()
    panel.open()
    panel.close()
    panel.close()
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

describe('RoutePlannerPanel – import link', () => {
  it('is hidden without onOpenImport', () => {
    const { q } = setup()
    expect(q('importLink').hidden).toBe(true)
  })

  it('is visible with onOpenImport; a click calls it and keeps the panel open', () => {
    const onOpenImport = vi.fn()
    const { panel, q } = setup({ onOpenImport })
    panel.open()
    expect(q('importLink').hidden).toBe(false)
    q('importLink').click()
    expect(onOpenImport).toHaveBeenCalledTimes(1)
    expect(panel.isOpen()).toBe(true)
  })
})

describe('RoutePlannerPanel – focusFirstEmpty', () => {
  it('focuses the start input when both are empty', () => {
    const { panel, q } = setup()
    panel.open()
    panel.focusFirstEmpty()
    expect(document.activeElement).toBe(q('startInput'))
  })

  it('focuses the destination when only the start is set', () => {
    const { panel, q } = setup()
    panel.open()
    panel.setPoint('start', poi)
    panel.focusFirstEmpty()
    expect(document.activeElement).toBe(q('endInput'))
  })

  it('focuses "Route berechnen" when both are set', () => {
    const { panel, go } = setup()
    panel.open()
    panel.setPoint('start', poi)
    panel.setPoint('end', { ...poi, label: 'Ziel' })
    panel.focusFirstEmpty()
    expect(document.activeElement).toBe(go())
  })
})

describe('RoutePlannerPanel – setting points', () => {
  it('sets a point from a suggestion with a short label and kind place', async () => {
    const { panel, val, pickSuggestion, deps } = setup()
    panel.open()
    await pickSuggestion('startInput')
    expect(val('startInput')).toBe('Köln')
    const [start, end] = deps.onPointsChange.mock.calls.at(-1)!
    expect(start).toEqual({ lat: 50.94, lon: 6.96, label: 'Köln', kind: 'place' })
    expect(end).toBeNull()
  })

  it('enables "Route berechnen" only with both points, disables again on typing', async () => {
    const { panel, go, pickSuggestion, typeInto, deps } = setup()
    panel.open()
    await pickSuggestion('startInput')
    expect(go().disabled).toBe(true)
    await pickSuggestion('endInput')
    expect(go().disabled).toBe(false)
    typeInto('endInput', 'Kö')
    expect(go().disabled).toBe(true)
    const [, end] = deps.onPointsChange.mock.calls.at(-1)!
    expect(end).toBeNull()
  })

  it('uses GPS: label "Mein Standort", kind gps', async () => {
    const { panel, q, val, flush, deps } = setup()
    panel.open()
    q('startLocate').click()
    await flush()
    expect(val('startInput')).toBe('Mein Standort')
    expect(deps.onPointsChange).toHaveBeenLastCalledWith(
      { lat: 51, lon: 8, label: 'Mein Standort', kind: 'gps' }, null)
  })

  it('GPS null: shows a status message and leaves the field unchanged', async () => {
    const { panel, q, val, flush, status, typeInto, deps } = setup({ locate: async () => null })
    panel.open()
    typeInto('startInput', 'Kö')
    q('startLocate').click()
    await flush()
    expect(status().textContent).toBe('Standort nicht verfügbar – Ort suchen oder Punkt auf der Karte wählen')
    expect(val('startInput')).toBe('Kö')
    expect(deps.onPointsChange).not.toHaveBeenCalled()
  })

  it('GPS rejection behaves like null', async () => {
    const { panel, q, flush, status } = setup({ locate: async () => { throw new Error('denied') } })
    panel.open()
    q('startLocate').click()
    await flush()
    expect(status().textContent).toContain('Standort nicht verfügbar')
  })

  it('drops a late GPS result when the point was set meanwhile', async () => {
    let resolve!: (p: { lat: number; lon: number } | null) => void
    const { panel, q, val, flush } = setup({ locate: () => new Promise(r => { resolve = r }) })
    panel.open()
    q('startLocate').click()
    panel.setPoint('start', poi)
    resolve({ lat: 1, lon: 2 })
    await flush()
    expect(val('startInput')).toBe('Stellplatz am See')
  })

  it('setPoint sets the field text (also for poi) and null clears', () => {
    const { panel, val, go, deps } = setup()
    panel.open()
    panel.setPoint('end', poi)
    expect(val('endInput')).toBe('Stellplatz am See')
    expect(deps.onPointsChange).toHaveBeenLastCalledWith(null, poi)
    panel.setPoint('end', null)
    expect(val('endInput')).toBe('')
    expect(deps.onPointsChange).toHaveBeenLastCalledWith(null, null)
    expect(go().disabled).toBe(true)
  })

  it('fires onPointsChange only on real changes', () => {
    const { panel, deps } = setup()
    panel.open()
    panel.setPoint('start', null)
    expect(deps.onPointsChange).not.toHaveBeenCalled()
    panel.setPoint('start', poi)
    expect(deps.onPointsChange).toHaveBeenCalledTimes(1)
  })

  it('prefills via open(prefill)', () => {
    const { panel, val, deps } = setup()
    panel.open({ role: 'start', point: poi })
    expect(panel.isOpen()).toBe(true)
    expect(val('startInput')).toBe('Stellplatz am See')
    expect(deps.onPointsChange).toHaveBeenCalledWith(poi, null)
    // auch bei bereits offenem Panel
    panel.open({ role: 'end', point: { ...poi, label: 'Ziel-POI' } })
    expect(val('endInput')).toBe('Ziel-POI')
  })

  it('swaps points and field texts', () => {
    const { panel, q, val, deps } = setup()
    panel.open()
    const a = poi
    const b: PlanPoint = { lat: 1, lon: 2, label: 'Kartenpunkt', kind: 'map' }
    panel.setPoint('start', a)
    panel.setPoint('end', b)
    q('swap').click()
    expect(val('startInput')).toBe('Kartenpunkt')
    expect(val('endInput')).toBe('Stellplatz am See')
    expect(deps.onPointsChange).toHaveBeenLastCalledWith(b, a)
  })

  it('swap carries unfinished text and a single point along', () => {
    const { panel, q, val, typeInto, go, deps } = setup()
    panel.open()
    panel.setPoint('start', poi)
    typeInto('endInput', 'Kö')
    q('swap').click()
    expect(val('startInput')).toBe('Kö')
    expect(val('endInput')).toBe('Stellplatz am See')
    expect(deps.onPointsChange).toHaveBeenLastCalledWith(null, poi)
    expect(go().disabled).toBe(true)
  })
})

describe('RoutePlannerPanel – map pick', () => {
  it('shrinks to a pick row; cancel restores', () => {
    const { panel, q, container, picks } = setup()
    panel.open()
    q('startPick').click()
    expect(panel.pickingRole()).toBe('start')
    expect(q('full').hidden).toBe(true)
    expect(q('pick').hidden).toBe(false)
    expect(container.textContent).toContain('Start auf der Karte antippen')
    q('pickCancel').click()
    expect(picks[0]!.cancel).toHaveBeenCalledTimes(1)
    expect(panel.pickingRole()).toBeNull()
    expect(q('full').hidden).toBe(false)
    expect(q('pick').hidden).toBe(true)
  })

  it('names the end role in the pick row', () => {
    const { panel, q, container } = setup()
    panel.open()
    q('endPick').click()
    expect(container.textContent).toContain('Ziel auf der Karte antippen')
  })

  it('done(pos) sets a map point and ends the pick without calling cancel', () => {
    const { panel, q, val, picks, deps } = setup()
    panel.open()
    q('endPick').click()
    picks[0]!.done({ lat: 50, lon: 7 })
    expect(val('endInput')).toBe('Kartenpunkt')
    expect(deps.onPointsChange).toHaveBeenLastCalledWith(null, { lat: 50, lon: 7, label: 'Kartenpunkt', kind: 'map' })
    expect(panel.pickingRole()).toBeNull()
    expect(q('pick').hidden).toBe(true)
    expect(picks[0]!.cancel).not.toHaveBeenCalled()
  })

  it('done(null) ends the pick mode but does NOT clear the field', () => {
    const { panel, val, picks, q, deps } = setup()
    panel.open()
    panel.setPoint('start', poi)
    q('startPick').click()
    // Auftraggeber bricht ab, setzt einen POI, dann trifft ein spätes done(null) ein
    const poi2: PlanPoint = { ...poi, label: 'Anderer Stellplatz' }
    panel.setPoint('start', poi2)
    deps.onPointsChange.mockClear()
    picks[0]!.done(null)
    expect(val('startInput')).toBe('Anderer Stellplatz')
    expect(deps.onPointsChange).not.toHaveBeenCalled()
    expect(q('full').hidden).toBe(false)
  })

  it('done(null) while the pick is still active ends it and leaves the field as is', () => {
    const { panel, val, picks, q } = setup()
    panel.open()
    panel.setPoint('start', poi)
    q('startPick').click()
    picks[0]!.done(null)
    expect(panel.pickingRole()).toBeNull()
    expect(val('startInput')).toBe('Stellplatz am See')
    expect(q('full').hidden).toBe(false)
  })

  it('a stale done(pos) sets nothing after setPoint for the same role', () => {
    const { panel, val, picks, q } = setup()
    panel.open()
    q('startPick').click()
    panel.setPoint('start', poi)
    expect(panel.pickingRole()).toBeNull()
    expect(picks[0]!.cancel).toHaveBeenCalledTimes(1)
    picks[0]!.done({ lat: 9, lon: 9 })
    expect(val('startInput')).toBe('Stellplatz am See')
  })

  it('a stale done(pos) sets nothing after a new pick replaced it', () => {
    const { panel, val, picks, q } = setup()
    panel.open()
    q('startPick').click()
    q('full').hidden = false // Test-Zugriff: Knopf des zweiten Picks erreichbar machen
    q('endPick').click()
    expect(picks).toHaveLength(2)
    expect(picks[0]!.cancel).toHaveBeenCalledTimes(1)
    expect(panel.pickingRole()).toBe('end')
    picks[0]!.done({ lat: 9, lon: 9 })
    expect(val('startInput')).toBe('')
    expect(panel.pickingRole()).toBe('end')
    picks[1]!.done({ lat: 1, lon: 2 })
    expect(val('endInput')).toBe('Kartenpunkt')
  })

  it('setPoint for the other role does not end the pick', () => {
    const { panel, picks, q } = setup()
    panel.open()
    q('startPick').click()
    panel.setPoint('end', poi)
    expect(panel.pickingRole()).toBe('start')
    expect(picks[0]!.cancel).not.toHaveBeenCalled()
  })

  it('handles a synchronous done', () => {
    const cancel = vi.fn()
    const { panel, q, val } = setup({
      pickOnMap: done => { done({ lat: 1, lon: 2 }); return cancel },
    })
    panel.open()
    q('startPick').click()
    expect(val('startInput')).toBe('Kartenpunkt')
    expect(panel.pickingRole()).toBeNull()
    panel.close()
    expect(cancel).not.toHaveBeenCalled()
  })

  it('close() during a pick cancels it and restores the form', () => {
    const { panel, q, picks } = setup()
    panel.open()
    q('startPick').click()
    panel.close()
    expect(picks[0]!.cancel).toHaveBeenCalledTimes(1)
    expect(q('pick').hidden).toBe(true)
    expect(q('full').hidden).toBe(false)
  })
})

describe('RoutePlannerPanel – Escape', () => {
  it('closes the suggestion list first, then the pick, then the panel', async () => {
    const { panel, q, typeInto, esc, picks } = setup()
    panel.open()
    typeInto('startInput', 'Köln')
    await vi.advanceTimersByTimeAsync(400)
    expect(q('startList').hidden).toBe(false)
    esc(q('startInput'))
    expect(q('startList').hidden).toBe(true)
    expect(panel.isOpen()).toBe(true)

    q('endPick').click()
    esc()
    expect(picks[0]!.cancel).toHaveBeenCalledTimes(1)
    expect(panel.pickingRole()).toBeNull()
    expect(panel.isOpen()).toBe(true)

    esc()
    expect(panel.isOpen()).toBe(false)
  })

  it('closes an open list on Escape from elsewhere before touching the panel', async () => {
    const { panel, q, typeInto, esc } = setup()
    panel.open()
    typeInto('startInput', 'Köln')
    await vi.advanceTimersByTimeAsync(400)
    esc(document.body)
    expect(q('startList').hidden).toBe(true)
    expect(panel.isOpen()).toBe(true)
  })

  it('ignores Escape while closed', () => {
    const { panel, esc } = setup()
    esc()
    expect(panel.isOpen()).toBe(false)
  })
})

describe('RoutePlannerPanel – modes', () => {
  it('uses initialMode on open and reports changes', () => {
    const { panel, modeBtn, deps } = setup({ initialMode: () => 'bike' })
    panel.open()
    expect(modeBtn('bike').getAttribute('aria-checked')).toBe('true')
    modeBtn('foot').click()
    expect(modeBtn('foot').getAttribute('aria-checked')).toBe('true')
    expect(modeBtn('bike').getAttribute('aria-checked')).toBe('false')
    expect(deps.onModeChange).toHaveBeenCalledWith('foot')
    modeBtn('foot').click()
    expect(deps.onModeChange).toHaveBeenCalledTimes(1)
  })

  it('supports arrow keys in the radiogroup', () => {
    const { panel, modeBtn, deps } = setup({ initialMode: () => 'foot' })
    panel.open()
    modeBtn('foot').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
    expect(modeBtn('bike').getAttribute('aria-checked')).toBe('true')
    expect(modeBtn('bike').tabIndex).toBe(0)
    expect(modeBtn('foot').tabIndex).toBe(-1)
    expect(deps.onModeChange).toHaveBeenCalledWith('bike')
  })
})

describe('RoutePlannerPanel – selectMode', () => {
  it('selects the mode like a click and reports only real changes', () => {
    const { panel, modeBtn, deps } = setup({ initialMode: () => 'car' })
    panel.open()
    panel.selectMode('bike')
    expect(modeBtn('bike').getAttribute('aria-checked')).toBe('true')
    expect(modeBtn('car').getAttribute('aria-checked')).toBe('false')
    expect(deps.onModeChange).toHaveBeenCalledWith('bike')
    panel.selectMode('bike')
    expect(deps.onModeChange).toHaveBeenCalledTimes(1)
  })
})

describe('RoutePlannerPanel – resolvePoint', () => {
  const found = (label: string, lat = 1): PlanPoint => ({ lat, lon: 2, label, kind: 'place' })
  const deferred = () => {
    let res!: (p: PlanPoint | null) => void
    let rej!: (e: unknown) => void
    const promise = new Promise<PlanPoint | null>((a, b) => { res = a; rej = b })
    return { promise, res, rej, fn: () => promise }
  }
  const SEARCHING = 'Orte werden gesucht…'

  it('shows the text at once, sets the point after resolving, and enables go only with both', async () => {
    const { panel, val, go, status, flush, deps } = setup()
    panel.open()
    const a = deferred()
    const b = deferred()
    void panel.resolvePoint('start', 'Konstanz', a.fn)
    void panel.resolvePoint('end', 'Hamburg', b.fn)
    expect(val('startInput')).toBe('Konstanz')
    expect(val('endInput')).toBe('Hamburg')
    expect(status().textContent).toBe(SEARCHING)
    expect(go().disabled).toBe(true)
    a.res(found('Konstanz'))
    await flush()
    expect(deps.onPointsChange).toHaveBeenLastCalledWith(found('Konstanz'), null)
    expect(go().disabled).toBe(true)
    expect(status().textContent).toBe(SEARCHING)
    b.res(found('Hamburg', 5))
    await flush()
    expect(go().disabled).toBe(false)
    expect(status().textContent).toBe('')
    expect(deps.onPointsChange).toHaveBeenLastCalledWith(found('Konstanz'), found('Hamburg', 5))
  })

  it('replaces the text with the label of the hit', async () => {
    const { panel, val, flush } = setup()
    panel.open()
    void panel.resolvePoint('end', 'hamburg', async () => found('Hamburg'))
    await flush()
    expect(val('endInput')).toBe('Hamburg')
  })

  it('no hit: keeps the text, no point, error status, go disabled', async () => {
    const { panel, val, go, status, flush, deps } = setup()
    panel.open()
    void panel.resolvePoint('start', 'Nirgendwo', async () => null)
    await flush()
    expect(val('startInput')).toBe('Nirgendwo')
    expect(status().textContent).toBe('„Nirgendwo“ nicht gefunden – bitte Start wählen')
    expect(status().classList.contains('planner-status-error')).toBe(true)
    expect(go().disabled).toBe(true)
    expect(deps.onPointsChange).not.toHaveBeenCalled()
  })

  it('a throwing resolve behaves like no hit', async () => {
    const { panel, val, status, flush } = setup()
    panel.open()
    void panel.resolvePoint('end', 'Kaputt', async () => { throw new Error('net') })
    await flush()
    expect(val('endInput')).toBe('Kaputt')
    expect(status().textContent).toBe('„Kaputt“ nicht gefunden – bitte Ziel wählen')
  })

  it('the error of one role survives the success of the other and goes with the next action on it', async () => {
    const { panel, status, flush, typeInto } = setup()
    panel.open()
    const a = deferred()
    const b = deferred()
    void panel.resolvePoint('start', 'Nirgendwo', a.fn)
    void panel.resolvePoint('end', 'Hamburg', b.fn)
    a.res(null)
    await flush()
    expect(status().textContent).toBe(SEARCHING)
    b.res(found('Hamburg'))
    await flush()
    expect(status().textContent).toBe('„Nirgendwo“ nicht gefunden – bitte Start wählen')
    expect(status().classList.contains('planner-status-error')).toBe(true)
    typeInto('startInput', 'Ber')
    expect(status().textContent).toBe('')
  })

  it('drops the result after typing into the field', async () => {
    const { panel, val, flush, typeInto, status, deps } = setup()
    panel.open()
    const a = deferred()
    void panel.resolvePoint('start', 'Konstanz', a.fn)
    typeInto('startInput', 'Ulm')
    expect(status().textContent).toBe('')
    a.res(found('Konstanz'))
    await flush()
    expect(val('startInput')).toBe('Ulm')
    expect(deps.onPointsChange).not.toHaveBeenCalled()
  })

  it('drops the result after setPoint', async () => {
    const { panel, val, flush } = setup()
    panel.open()
    const a = deferred()
    void panel.resolvePoint('start', 'Konstanz', a.fn)
    panel.setPoint('start', poi)
    a.res(found('Konstanz'))
    await flush()
    expect(val('startInput')).toBe('Stellplatz am See')
  })

  it('drops the result after swapping', async () => {
    const { panel, val, q, flush } = setup()
    panel.open()
    const a = deferred()
    void panel.resolvePoint('start', 'Konstanz', a.fn)
    q('swap').click()
    expect(val('endInput')).toBe('Konstanz')
    a.res(found('Konstanz'))
    await flush()
    expect(val('endInput')).toBe('Konstanz')
    expect(val('startInput')).toBe('')
  })

  it('drops the result after a pick started for that role', async () => {
    const { panel, flush, picks, q, deps } = setup()
    panel.open()
    const a = deferred()
    void panel.resolvePoint('start', 'Konstanz', a.fn)
    q('startPick').click()
    a.res(found('Konstanz'))
    await flush()
    expect(deps.onPointsChange).not.toHaveBeenCalled()
    expect(panel.pickingRole()).toBe('start')
    expect(picks).toHaveLength(1)
  })

  it('ends a running pick of that role', () => {
    const { panel, q, picks } = setup()
    panel.open()
    q('startPick').click()
    void panel.resolvePoint('start', 'Konstanz', () => new Promise(() => {}))
    expect(panel.pickingRole()).toBeNull()
    expect(picks[0]!.cancel).toHaveBeenCalledTimes(1)
  })

  it('drops the result after close() and open()', async () => {
    const { panel, val, flush, status, deps } = setup()
    panel.open()
    const a = deferred()
    void panel.resolvePoint('start', 'Konstanz', a.fn)
    panel.close()
    panel.open()
    a.res(found('Konstanz'))
    await flush()
    expect(val('startInput')).toBe('Konstanz')
    expect(deps.onPointsChange).not.toHaveBeenCalled()
    expect(status().textContent).toBe('')
  })

  it('drops a late GPS result after close() and open()', async () => {
    let resolve!: (p: { lat: number; lon: number } | null) => void
    const { panel, q, val, flush, deps } = setup({ locate: () => new Promise(r => { resolve = r }) })
    panel.open()
    q('startLocate').click()
    panel.close()
    panel.open()
    resolve({ lat: 1, lon: 2 })
    await flush()
    expect(val('startInput')).toBe('')
    expect(deps.onPointsChange).not.toHaveBeenCalled()
  })
})

describe('RoutePlannerPanel – run', () => {
  async function ready(over: Partial<RoutePlannerDeps> = {}) {
    const s = setup(over)
    s.panel.open()
    s.panel.setPoint('start', poi)
    s.panel.setPoint('end', { lat: 2, lon: 3, label: 'Köln', kind: 'place' })
    return s
  }

  it('sends the request with the chosen mode and closes on success', async () => {
    const { go, deps, panel, modeBtn, flush } = await ready()
    modeBtn('bike').click()
    go().click()
    await flush()
    const [req, signal] = deps.plan.mock.calls[0]!
    expect(req.mode).toBe('bike')
    expect(req.start).toEqual(poi)
    expect(req.end.label).toBe('Köln')
    expect(signal.aborted).toBe(false)
    expect(panel.isOpen()).toBe(false)
  })

  it('is busy while running: inputs and buttons disabled, status shown', async () => {
    let resolve!: () => void
    const { go, q, status, modeBtn, panel } = await ready({ plan: () => new Promise<void>(r => { resolve = r }) })
    go().click()
    expect(status().textContent).toBe('Route wird berechnet…')
    expect(go().disabled).toBe(true)
    for (const r of ['startInput', 'endInput', 'startLocate', 'startPick', 'endLocate', 'endPick', 'swap']) {
      expect((q(r) as HTMLButtonElement | HTMLInputElement).disabled).toBe(true)
    }
    expect(modeBtn('car').disabled).toBe(true)
    resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(panel.isOpen()).toBe(false)
  })

  it('does not start a second run while busy', async () => {
    const plan = vi.fn(() => new Promise<void>(() => {}))
    const { go } = await ready({ plan })
    go().click()
    go().click()
    expect(plan).toHaveBeenCalledTimes(1)
  })

  it('shows describeError in an error-classed status and re-enables', async () => {
    const { go, status, flush, panel, q } = await ready({ plan: async () => { throw new Error('kaputt') } })
    go().click()
    await flush()
    expect(status().textContent).toBe('Fehler: kaputt')
    expect(status().classList.contains('planner-status-error')).toBe(true)
    expect(panel.isOpen()).toBe(true)
    expect(go().disabled).toBe(false)
    expect((q('startInput') as HTMLInputElement).disabled).toBe(false)
  })

  it('shows no error for an AbortError', async () => {
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' })
    const { go, status, flush, deps } = await ready({ plan: async () => { throw abortErr } })
    go().click()
    await flush()
    expect(status().textContent).toBe('')
    expect(deps.describeError).not.toHaveBeenCalled()
  })

  it('close() during a run aborts it without an error message and discards the result', async () => {
    let signal!: AbortSignal
    let reject!: (e: unknown) => void
    const { go, panel, status, flush, deps } = await ready({
      plan: (_r, s) => { signal = s; return new Promise<void>((_res, rej) => { reject = rej }) },
    })
    go().click()
    panel.close()
    expect(signal.aborted).toBe(true)
    reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    await flush()
    expect(status().textContent).toBe('')
    expect(deps.describeError).not.toHaveBeenCalled()
    expect(panel.isOpen()).toBe(false)
  })

  it('a result arriving after close() does not reopen or close anything else', async () => {
    let resolve!: () => void
    const { go, panel, flush } = await ready({ plan: () => new Promise<void>(r => { resolve = r }) })
    go().click()
    panel.close()
    panel.open()
    resolve()
    await flush()
    expect(panel.isOpen()).toBe(true)
  })

  it('does nothing with a missing point', async () => {
    const { panel, go, deps } = setup()
    panel.open()
    panel.setPoint('start', poi)
    go().click()
    expect(deps.plan).not.toHaveBeenCalled()
  })
})

describe('RoutePlannerPanel – destroy', () => {
  it('removes DOM and listeners', () => {
    const { panel, container, q, esc, picks } = setup()
    panel.open()
    q('startPick').click()
    panel.destroy()
    expect(container.querySelector('.planner-panel')).toBeNull()
    expect(picks[0]!.cancel).toHaveBeenCalledTimes(1)
    expect(() => esc()).not.toThrow()
    expect(panel.isOpen()).toBe(false)
  })
})
