import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HelpPanel, type HelpPanelDeps } from './HelpPanel.js'
import type { IFilterStore } from '@/features/filters/FilterStore.js'
import { DEFAULT_FILTERS } from '@/features/filters/filterModel.js'

const flush = () => new Promise(r => setTimeout(r, 0))

function makeFilterStore(overrides: Partial<IFilterStore> = {}): IFilterStore {
  return {
    list: () => DEFAULT_FILTERS,
    get: (id) => DEFAULT_FILTERS.find(f => f.id === id),
    osmFilters: () => DEFAULT_FILTERS.filter(f => f.kind === 'osm'),
    osmSignature: () => '',
    put: vi.fn(),
    remove: vi.fn(),
    setEnabled: vi.fn(),
    setHidden: vi.fn(),
    isBuiltin: () => true,
    onChange: () => () => {},
    ...overrides,
  }
}

function makeDeps(overrides: Partial<HelpPanelDeps> = {}): HelpPanelDeps {
  return {
    filterStore: makeFilterStore(),
    onDismiss: vi.fn(),
    onOpenAuth: vi.fn(),
    ...overrides,
  }
}

function makePanel(deps?: Partial<HelpPanelDeps>) {
  const c = document.createElement('div')
  const panel = new HelpPanel(c, makeDeps(deps))
  return { c, panel }
}

function clickNext(c: HTMLElement) {
  c.querySelector<HTMLButtonElement>('[data-ref="next"]')!.click()
}

describe('HelpPanel', () => {
  it('starts hidden', async () => {
    const { c } = makePanel()
    await flush()
    expect(c.querySelector('.help-panel')!.classList.contains('open')).toBe(false)
  })

  it('open() and close() toggle visibility', async () => {
    const { panel } = makePanel()
    await flush()
    expect(panel.isOpen()).toBe(false)
    panel.open()
    expect(panel.isOpen()).toBe(true)
    panel.close()
    expect(panel.isOpen()).toBe(false)
  })

  it('programmatic close() does NOT call onDismiss', async () => {
    const onDismiss = vi.fn()
    const { panel } = makePanel({ onDismiss })
    await flush()
    panel.open()
    panel.close()
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('skip button calls onDismiss and closes the panel', async () => {
    const onDismiss = vi.fn()
    const { c, panel } = makePanel({ onDismiss })
    await flush()
    panel.open()
    c.querySelector<HTMLButtonElement>('.help-skip')!.click()
    expect(onDismiss).toHaveBeenCalledOnce()
    expect(panel.isOpen()).toBe(false)
  })

  it('Escape key calls onDismiss and closes the panel', async () => {
    const onDismiss = vi.fn()
    const { panel } = makePanel({ onDismiss })
    await flush()
    panel.open()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(onDismiss).toHaveBeenCalledOnce()
    expect(panel.isOpen()).toBe(false)
  })

  it('Escape does nothing when panel is closed', async () => {
    const onDismiss = vi.fn()
    makePanel({ onDismiss })
    await flush()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('open() resets to step 1 and shows progress dots', async () => {
    const { c, panel } = makePanel()
    await flush()
    panel.open()
    const dots = c.querySelectorAll('.help-progress-dot')
    expect(dots).toHaveLength(4)
    expect(dots[0]!.classList.contains('active')).toBe(true)
    expect(dots[1]!.classList.contains('active')).toBe(false)
  })

  it('next button advances to step 2', async () => {
    const { c, panel } = makePanel()
    await flush()
    panel.open()
    clickNext(c)
    const dots = c.querySelectorAll('.help-progress-dot')
    expect(dots[1]!.classList.contains('active')).toBe(true)
    expect(c.querySelector('.help-filter-grid')).not.toBeNull()
  })

  it('back button returns to step 1', async () => {
    const { c, panel } = makePanel()
    await flush()
    panel.open()
    clickNext(c)
    c.querySelector<HTMLButtonElement>('.help-nav-btn--back')!.click()
    const dots = c.querySelectorAll('.help-progress-dot')
    expect(dots[0]!.classList.contains('active')).toBe(true)
  })

  it('filter cards toggle aria-pressed', async () => {
    const { c, panel } = makePanel()
    await flush()
    panel.open()
    clickNext(c) // go to step 2
    const card = c.querySelector<HTMLButtonElement>('.help-filter-card')!
    const initialState = card.getAttribute('aria-pressed')
    card.click()
    expect(card.getAttribute('aria-pressed')).toBe(initialState === 'true' ? 'false' : 'true')
  })

  it('advancing from step 2 hides deselected filters', async () => {
    const setHidden = vi.fn()
    const filterStore = makeFilterStore({ setHidden })
    const { c, panel } = makePanel({ filterStore })
    await flush()
    panel.open()
    clickNext(c) // to step 2

    // Deselect parking (visible by default → should become hidden)
    const card = c.querySelector<HTMLButtonElement>('.help-filter-card[data-filter-id="parking"]')!
    card.click()

    clickNext(c) // to step 3 — commits filter state
    expect(setHidden).toHaveBeenCalledWith('parking', true)
  })

  it('advancing from step 2 unhides re-selected filters', async () => {
    const setHidden = vi.fn()
    // Simulate parking being already hidden
    const filterStore = makeFilterStore({
      setHidden,
      get: (id) => {
        const f = DEFAULT_FILTERS.find(d => d.id === id)
        if (!f) return undefined
        return id === 'parking' ? { ...f, hidden: true } : f
      },
    })
    const { c, panel } = makePanel({ filterStore })
    await flush()
    panel.open()
    clickNext(c) // to step 2

    // Parking should be shown as deselected; select it again
    const card = c.querySelector<HTMLButtonElement>('.help-filter-card[data-filter-id="parking"]')!
    expect(card.classList.contains('selected')).toBe(false)
    card.click() // select → unhide

    clickNext(c)
    expect(setHidden).toHaveBeenCalledWith('parking', false)
  })

  // Regression: der Wizard rechnete "ausgewaehlt" nur aus !hidden. Opt-in-Filter
  // (enabled:false, nicht hidden) erschienen damit als ausgewaehlt, obwohl die
  // Karte nichts zeigte — und ein Klick darauf schaltete sie nie ein.
  it('shows opt-in filters (enabled:false) as deselected', async () => {
    const { c, panel } = makePanel()
    await flush()
    panel.open()
    clickNext(c) // to step 2

    for (const id of ['hut', 'shelter']) {
      const card = c.querySelector<HTMLButtonElement>(`.help-filter-card[data-filter-id="${id}"]`)!
      expect(card, `card for ${id} missing`).toBeTruthy()
      expect(card.classList.contains('selected'), `${id} should start deselected`).toBe(false)
      expect(card.getAttribute('aria-pressed')).toBe('false')
    }
  })

  it('renders a card per built-in OSM filter; hidden newcomers start deselected and unhide on select', async () => {
    const setHidden = vi.fn()
    const { c, panel } = makePanel({ filterStore: makeFilterStore({ setHidden }) })
    await flush()
    panel.open()
    clickNext(c) // to step 2
    const osm = DEFAULT_FILTERS.filter(f => f.kind === 'osm')
    expect(c.querySelectorAll('.help-filter-card')).toHaveLength(osm.length)
    for (const f of osm) {
      const card = c.querySelector<HTMLButtonElement>(`.help-filter-card[data-filter-id="${f.id}"]`)!
      expect(card.querySelector('.help-filter-card-name')!.textContent).toBe(f.name)
      expect(card.querySelector('svg')).toBeTruthy()
    }
    const cafe = c.querySelector<HTMLButtonElement>('.help-filter-card[data-filter-id="cafe"]')!
    expect(cafe.classList.contains('selected')).toBe(false)
    cafe.click()
    clickNext(c)
    expect(setHidden).toHaveBeenCalledWith('cafe', false)
  })

  it('enables an opt-in filter when it gets selected in the wizard', async () => {
    const setEnabled = vi.fn()
    const setHidden = vi.fn()
    const filterStore = makeFilterStore({ setEnabled, setHidden })
    const { c, panel } = makePanel({ filterStore })
    await flush()
    panel.open()
    clickNext(c) // to step 2

    c.querySelector<HTMLButtonElement>('.help-filter-card[data-filter-id="shelter"]')!.click()
    clickNext(c) // commits

    expect(setEnabled).toHaveBeenCalledWith('shelter', true)
    // war nie hidden — es gibt keinen Grund, hidden anzufassen
    expect(setHidden).not.toHaveBeenCalledWith('shelter', false)
  })

  // Der Wizard hebt `enabled` nur an, senkt es nie: Abwaehlen blendet via
  // `hidden` aus und laesst den Chip-Zustand unberuehrt.
  it('never disables a filter — deselecting only hides it', async () => {
    const setEnabled = vi.fn()
    const setHidden = vi.fn()
    const { c, panel } = makePanel({ filterStore: makeFilterStore({ setEnabled, setHidden }) })
    await flush()
    panel.open()
    clickNext(c) // to step 2

    c.querySelector<HTMLButtonElement>('.help-filter-card[data-filter-id="parking"]')!.click() // abwaehlen
    clickNext(c) // commits

    expect(setHidden).toHaveBeenCalledWith('parking', true)
    expect(setEnabled).not.toHaveBeenCalled()
  })

  it('does not re-enable already-enabled filters', async () => {
    const setEnabled = vi.fn()
    const { c, panel } = makePanel({ filterStore: makeFilterStore({ setEnabled }) })
    await flush()
    panel.open()
    clickNext(c) // to step 2 — parking is selected by default, touch nothing
    clickNext(c) // commits

    expect(setEnabled).not.toHaveBeenCalledWith('parking', true)
  })

  it('skip on step 2 does NOT apply filter changes', async () => {
    const setHidden = vi.fn()
    const filterStore = makeFilterStore({ setHidden })
    const { c, panel } = makePanel({ filterStore })
    await flush()
    panel.open()
    clickNext(c) // to step 2

    // Toggle a filter then skip
    c.querySelector<HTMLButtonElement>('.help-filter-card')!.click()
    c.querySelector<HTMLButtonElement>('.help-skip')!.click()

    expect(setHidden).not.toHaveBeenCalled()
  })

  it('"Lieber später" on step 4 calls onDismiss', async () => {
    const onDismiss = vi.fn()
    const { c, panel } = makePanel({ onDismiss })
    await flush()
    panel.open()
    clickNext(c) // step 2
    clickNext(c) // step 3
    clickNext(c) // step 4
    c.querySelector<HTMLButtonElement>('[data-ref="start"]')!.click()
    expect(onDismiss).toHaveBeenCalledOnce()
    expect(panel.isOpen()).toBe(false)
  })

  it('"Jetzt anmelden" on step 4 calls onDismiss and onOpenAuth', async () => {
    const onDismiss = vi.fn()
    const onOpenAuth = vi.fn()
    const { c, panel } = makePanel({ onDismiss, onOpenAuth })
    await flush()
    panel.open()
    clickNext(c)
    clickNext(c)
    clickNext(c)
    c.querySelector<HTMLButtonElement>('[data-ref="signin"]')!.click()
    expect(onDismiss).toHaveBeenCalledOnce()
    expect(onOpenAuth).toHaveBeenCalledOnce()
    expect(panel.isOpen()).toBe(false)
  })

  it('sign-in button is hidden when onOpenAuth is not provided', async () => {
    const { c, panel } = makePanel({ onOpenAuth: undefined })
    await flush()
    panel.open()
    clickNext(c)
    clickNext(c)
    clickNext(c)
    expect(c.querySelector('[data-ref="signin"]')).toBeNull()
  })
})
