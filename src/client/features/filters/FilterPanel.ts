import './filters.css'
import { filterIconSvg, type FilterDef } from './filterModel.js'
import type { IFilterStore } from './FilterStore.js'
import { createEventScope } from '@/core/events.js'

const SVG_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v8"/><path d="M8 12h8"/></svg>'

const SVG_GEAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>'

const SVG_UNDO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/></svg>'

const SVG_MORE = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>'

/**
 * Given the pixel widths of each chip, decide how many fit on a single row.
 *
 * Returns the count of leading chips that fit. If everything fits, the "more"
 * button is not needed and its width is not reserved. Otherwise space for the
 * more button (plus one gap) is held back so the visible chips never collide
 * with it. Pure + side-effect free so the overflow boundary stays testable
 * without a real layout engine.
 */
export function computeVisibleCount(
  chipWidths: readonly number[],
  available: number,
  gap: number,
  moreWidth: number,
): number {
  const n = chipWidths.length
  if (n === 0 || available <= 0) return n

  const totalNoMore = chipWidths.reduce((s, w) => s + w, 0) + gap * (n - 1)
  if (totalNoMore <= available + 0.5) return n

  const budget = available - moreWidth - gap
  let used = 0
  let count = 0
  for (const w of chipWidths) {
    const add = count === 0 ? w : gap + w
    if (used + add <= budget + 0.5) {
      used += add
      count++
    } else break
  }
  return count
}

export interface FilterPanelDeps {
  /** Open the custom-POI placement flow ("+" button). */
  onAdd: () => void
  /** Open the filter configuration page (gear button). */
  onOpenConfig: () => void
}

/** Horizontal gap between chips — must mirror the `gap` of `.filter-chips` in CSS. */
const CHIP_GAP = 7

/**
 * The on-map filter bar. Renders one chip per configured filter (driven by the
 * FilterStore); toggling a chip flips that filter's `enabled` flag in the store.
 *
 * Chips that don't fit on a single row collapse behind a "…" overflow button
 * that opens a menu listing the remaining filters — so the bar stays one line
 * no matter how many filters exist. The "+" / "⚙️" controls are always pinned.
 */
export class FilterPanel {
  private readonly events = createEventScope()
  private chipsWrap!: HTMLElement
  private moreBtn!: HTMLButtonElement
  private menu!: HTMLElement
  private defsById = new Map<string, FilterDef>()
  private menuOpen = false
  private onRestore: (() => void) | null = null

  constructor(
    private readonly container: HTMLElement,
    private readonly store: IFilterStore,
    private readonly deps: FilterPanelDeps,
  ) {
    this.container.style.position = 'relative'
    this.render()
    this.store.onChange(() => this.render())

    // Recompute the overflow boundary when the bar's width changes (rotation,
    // window resize, side panels opening). ResizeObserver may be absent in test
    // environments — guard it.
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => this.relayout())
      ro.observe(this.container)
    }
    this.events.on(window, 'resize', () => this.relayout())

    // Close the overflow menu on any outside interaction.
    this.events.on(document, 'pointerdown', (e) => {
      if (!this.menuOpen) return
      const t = e.target as Node
      if (!this.menu.contains(t) && !this.moreBtn.contains(t)) this.closeMenu()
    })
  }

  private render(): void {
    const wasOpen = this.menuOpen
    this.container.innerHTML = ''
    this.defsById.clear()

    this.container.appendChild(this.iconButton({
      className: 'filter-btn filter-add',
      svg: SVG_PLUS,
      title: 'Eigenen Ort hinzufügen',
      onClick: () => this.deps.onAdd(),
    }))

    this.container.appendChild(this.separator())

    const restore = this.restoreButton()
    if (restore) this.container.appendChild(restore)

    this.chipsWrap = document.createElement('div')
    this.chipsWrap.className = 'filter-chips'
    for (const f of this.store.list()) {
      if (f.hidden) continue
      this.defsById.set(f.id, f)
      this.chipsWrap.appendChild(this.chipButton(f))
    }

    // The "…" button lives inside the chip row (as its last child) so its width
    // is reserved during layout; hidden until something actually overflows.
    this.moreBtn = this.iconButton({
      className: 'filter-btn filter-more',
      svg: SVG_MORE,
      title: 'Weitere Filter',
      onClick: () => this.toggleMenu(),
    })
    this.moreBtn.setAttribute('aria-haspopup', 'true')
    this.moreBtn.style.display = 'none'
    this.chipsWrap.appendChild(this.moreBtn)
    this.container.appendChild(this.chipsWrap)

    this.menu = document.createElement('div')
    this.menu.className = 'filter-more-menu hidden'
    this.menu.setAttribute('role', 'menu')
    this.container.appendChild(this.menu)

    this.container.appendChild(this.separator())

    this.container.appendChild(this.iconButton({
      className: 'filter-btn filter-config',
      svg: SVG_GEAR,
      title: 'Filter verwalten',
      onClick: () => this.deps.onOpenConfig(),
    }))

    this.menuOpen = false
    this.relayout()
    if (wasOpen && this.moreBtn.style.display !== 'none') this.openMenu()
  }

  /** Zeigt am Anfang der Filterleiste „↩ Filter vor KI-Suche“; null blendet den Chip aus. */
  setRestore(onRestore: (() => void) | null): void {
    this.onRestore = onRestore
    this.render()
  }

  private restoreButton(): HTMLButtonElement | null {
    const cb = this.onRestore
    if (!cb) return null
    const title = 'Filter vor der KI-Suche wiederherstellen'
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'filter-restore'
    btn.innerHTML = `${SVG_UNDO}<span>Filter vor KI-Suche</span>`
    btn.title = title
    btn.setAttribute('aria-label', title)
    btn.addEventListener('click', () => cb())
    return btn
  }

  /** Decide which chips stay on the row and which fall into the overflow menu. */
  private relayout(): void {
    if (!this.chipsWrap) return
    const chips = Array.from(this.chipsWrap.querySelectorAll<HTMLElement>('[data-filter-id]'))
    chips.forEach(c => { c.style.display = '' })
    this.moreBtn.style.display = ''

    const available = this.chipsWrap.clientWidth
    const widths = chips.map(c => c.getBoundingClientRect().width)
    const moreWidth = this.moreBtn.getBoundingClientRect().width
    const visible = computeVisibleCount(widths, available, CHIP_GAP, moreWidth)

    if (visible >= chips.length) {
      this.moreBtn.style.display = 'none'
      this.buildMenu([])
      this.closeMenu()
      return
    }

    const overflow: FilterDef[] = []
    chips.forEach((chip, i) => {
      if (i < visible) return
      chip.style.display = 'none'
      const def = this.defsById.get(chip.dataset['filterId'] ?? '')
      if (def) overflow.push(def)
    })
    this.buildMenu(overflow)
  }

  private buildMenu(overflow: readonly FilterDef[]): void {
    this.menu.innerHTML = ''
    for (const f of overflow) {
      const row = document.createElement('button')
      row.type = 'button'
      row.className = `filter-more-item ${f.enabled ? 'active' : ''}`
      row.dataset['filterId'] = f.id
      row.setAttribute('role', 'menuitemcheckbox')
      row.setAttribute('aria-checked', String(f.enabled))
      row.style.setProperty('--chip-color', f.color)
      row.innerHTML = `<span class="filter-more-icon">${filterIconSvg(f.iconId)}</span><span class="filter-more-label">${f.name}</span>`
      row.addEventListener('click', () => this.store.setEnabled(f.id, !f.enabled))
      this.menu.appendChild(row)
    }
  }

  private toggleMenu(): void {
    if (this.menuOpen) this.closeMenu()
    else this.openMenu()
  }

  private openMenu(): void {
    this.menu.classList.remove('hidden')
    this.moreBtn.classList.add('active')
    this.moreBtn.setAttribute('aria-expanded', 'true')
    this.menuOpen = true
  }

  private closeMenu(): void {
    this.menu.classList.add('hidden')
    this.moreBtn.classList.remove('active')
    this.moreBtn.setAttribute('aria-expanded', 'false')
    this.menuOpen = false
  }

  private chipButton(f: FilterDef): HTMLButtonElement {
    const btn = this.iconButton({
      className: `filter-btn ${f.enabled ? 'active' : ''}`,
      svg: filterIconSvg(f.iconId),
      title: f.name,
      onClick: () => this.store.setEnabled(f.id, !f.enabled),
    })
    btn.dataset['filterId'] = f.id
    btn.style.setProperty('--chip-color', f.color)
    btn.setAttribute('aria-pressed', String(f.enabled))
    return btn
  }

  private iconButton(opts: { className: string; svg: string; title: string; onClick: () => void }): HTMLButtonElement {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = opts.className
    btn.innerHTML = opts.svg
    btn.title = opts.title
    btn.setAttribute('aria-label', opts.title)
    btn.addEventListener('click', opts.onClick)
    return btn
  }

  private separator(): HTMLElement {
    const sep = document.createElement('span')
    sep.className = 'filter-sep'
    return sep
  }
}
