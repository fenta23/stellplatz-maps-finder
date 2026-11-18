import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FilterPanel, computeVisibleCount } from './FilterPanel.js'
import { LocalFilterStore } from './FilterStore.js'
import { DEFAULT_FILTERS, type FilterDef } from './filterModel.js'

const noop = () => {}
const makeContainer = (): HTMLElement => document.createElement('div')

const VISIBLE_DEFAULTS = DEFAULT_FILTERS.filter(f => !f.hidden).length

beforeEach(() => localStorage.clear())

const userFilter = (id = 'u1'): FilterDef => ({
  id, name: 'Tankstelle', iconId: 'fuel', color: '#C62828',
  enabled: true, kind: 'osm', builtin: false, order: 100,
  selectors: [{ elements: ['node'], tags: [{ key: 'amenity', value: 'fuel' }] }],
})

describe('FilterPanel', () => {
  it('renders a chip per configured filter plus add + config buttons', () => {
    const el = makeContainer()
    new FilterPanel(el, new LocalFilterStore(), { onAdd: noop, onOpenConfig: noop })
    expect(el.querySelectorAll('[data-filter-id]')).toHaveLength(VISIBLE_DEFAULTS)
    expect(el.querySelector('[data-filter-id="cafe"]')).toBeNull() // hidden built-ins get no chip
    expect(el.querySelector('[data-filter-id="climbing"]')).toBeTruthy()
    expect(el.querySelector('[data-filter-id="personal"]')).toBeTruthy()
    expect(el.querySelector('.filter-add')).toBeTruthy()
    expect(el.querySelector('.filter-config')).toBeTruthy()
  })

  it('marks enabled chips active and sets icon/title/colour', () => {
    const el = makeContainer()
    new FilterPanel(el, new LocalFilterStore(), { onAdd: noop, onOpenConfig: noop })
    const btn = el.querySelector<HTMLButtonElement>('[data-filter-id="parking"]')!
    expect(btn.querySelector('svg')).toBeTruthy()
    expect(btn.title).toBe('Parkplatz')
    expect(btn.classList.contains('active')).toBe(true)
    expect(btn.style.getPropertyValue('--chip-color')).toBe('#1565C0')
  })

  it('clicking a chip disables it in the store and shows as inactive', () => {
    const el = makeContainer()
    const store = new LocalFilterStore()
    new FilterPanel(el, store, { onAdd: noop, onOpenConfig: noop })
    expect(el.querySelector('[data-filter-id="parking"]')).toBeTruthy()
    el.querySelector<HTMLButtonElement>('[data-filter-id="parking"]')!.click()
    expect(store.get('parking')?.enabled).toBe(false)
    expect(el.querySelector('[data-filter-id="parking"]')!.classList.contains('active')).toBe(false)
  })

  it('shows newly added filters live (re-render on store change)', () => {
    const el = makeContainer()
    const store = new LocalFilterStore()
    new FilterPanel(el, store, { onAdd: noop, onOpenConfig: noop })
    store.put(userFilter())
    expect(el.querySelector('[data-filter-id="u1"]')).toBeTruthy()
    expect(el.querySelectorAll('[data-filter-id]')).toHaveLength(VISIBLE_DEFAULTS + 1)
  })

  it('fires onAdd and onOpenConfig', () => {
    const el = makeContainer()
    const onAdd = vi.fn()
    const onOpenConfig = vi.fn()
    new FilterPanel(el, new LocalFilterStore(), { onAdd, onOpenConfig })
    el.querySelector<HTMLButtonElement>('.filter-add')!.click()
    el.querySelector<HTMLButtonElement>('.filter-config')!.click()
    expect(onAdd).toHaveBeenCalledOnce()
    expect(onOpenConfig).toHaveBeenCalledOnce()
  })

  it('renders a hidden overflow button and menu, hidden when nothing overflows', () => {
    const el = makeContainer()
    new FilterPanel(el, new LocalFilterStore(), { onAdd: noop, onOpenConfig: noop })
    const more = el.querySelector<HTMLButtonElement>('.filter-more')!
    expect(more).toBeTruthy()
    // jsdom reports zero geometry → computeVisibleCount keeps everything visible.
    expect(more.style.display).toBe('none')
    expect(el.querySelector('.filter-more-menu')!.classList.contains('hidden')).toBe(true)
  })
})

describe('computeVisibleCount', () => {
  const gap = 7
  const more = 40

  it('shows every chip when they all fit (no "more" reserved)', () => {
    expect(computeVisibleCount([40, 40, 40], 200, gap, more)).toBe(3)
  })

  it('keeps everything when the total exactly fills the row', () => {
    // 3×40 + 2×7 = 134
    expect(computeVisibleCount([40, 40, 40], 134, gap, more)).toBe(3)
  })

  it('reserves room for the "more" button once anything overflows', () => {
    // 4×40 + 3×7 = 181 > 150 → must overflow. budget = 150 - 40 - 7 = 103.
    // fits 40, +47=87, +47=134 > 103 → 2 chips visible.
    expect(computeVisibleCount([40, 40, 40, 40], 150, gap, more)).toBe(2)
  })

  it('can collapse to zero visible chips on a very narrow row', () => {
    expect(computeVisibleCount([40, 40], 30, gap, more)).toBe(0)
  })

  it('returns all when width is unknown (no layout yet)', () => {
    expect(computeVisibleCount([40, 40, 40], 0, gap, more)).toBe(3)
  })

  it('handles an empty chip list', () => {
    expect(computeVisibleCount([], 100, gap, more)).toBe(0)
  })

  describe('restore chip', () => {
    it('is absent by default', () => {
      const el = makeContainer()
      new FilterPanel(el, new LocalFilterStore(), { onAdd: noop, onOpenConfig: noop })
      expect(el.querySelector('.filter-restore')).toBeNull()
    })

    it('appears after the add button and before the filter chips', () => {
      const el = makeContainer()
      const panel = new FilterPanel(el, new LocalFilterStore(), { onAdd: noop, onOpenConfig: noop })
      panel.setRestore(noop)
      const btn = el.querySelector<HTMLButtonElement>('.filter-restore')!
      expect(btn.type).toBe('button')
      expect(btn.textContent).toBe('Filter vor KI-Suche')
      expect(btn.title).toBe('Filter vor der KI-Suche wiederherstellen')
      expect(btn.getAttribute('aria-label')).toBe('Filter vor der KI-Suche wiederherstellen')
      expect(btn.querySelector('svg')).toBeTruthy()
      const kids = Array.from(el.children)
      expect(kids.indexOf(btn)).toBeGreaterThan(kids.indexOf(el.querySelector('.filter-add')!))
      expect(kids.indexOf(btn)).toBeLessThan(kids.indexOf(el.querySelector('.filter-chips')!))
    })

    it('survives a re-render caused by a store change', () => {
      const el = makeContainer()
      const store = new LocalFilterStore()
      const panel = new FilterPanel(el, store, { onAdd: noop, onOpenConfig: noop })
      panel.setRestore(noop)
      store.setEnabled('parking', false)
      expect(el.querySelectorAll('.filter-restore')).toHaveLength(1)
    })

    it('calls the callback on click', () => {
      const el = makeContainer()
      const fn = vi.fn()
      new FilterPanel(el, new LocalFilterStore(), { onAdd: noop, onOpenConfig: noop }).setRestore(fn)
      el.querySelector<HTMLButtonElement>('.filter-restore')!.click()
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('is removed by setRestore(null)', () => {
      const el = makeContainer()
      const panel = new FilterPanel(el, new LocalFilterStore(), { onAdd: noop, onOpenConfig: noop })
      panel.setRestore(noop)
      panel.setRestore(null)
      expect(el.querySelector('.filter-restore')).toBeNull()
    })
  })
})
