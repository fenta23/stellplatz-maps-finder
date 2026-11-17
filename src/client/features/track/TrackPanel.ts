import './track.css'
import { clone, ref } from '@/core/template.js'
import { renderList } from '@/core/bind.js'
import { renderPagination } from '@/core/pagination.js'
import { createEventScope, type EventScope } from '@/core/events.js'
import { paginate } from '@shared/paginate.js'
import { formatKm } from './TrackImportDialog.js'
import { MAX_CORRIDOR_M, MIN_CORRIDOR_M, type Track } from './trackTypes.js'
import panelHtml from './trackPanel.html?raw'

export interface TrackPanelRow {
  /** Stable id, handed back on click. */
  readonly key: string
  readonly title: string
  readonly subtitle: string
  /** Category colour (CSS colour) for the row's dot/icon. */
  readonly color: string
  /** Optional trusted SVG markup from our own icon set (never user data). */
  readonly iconSvg?: string
  readonly kmAlong: number
  readonly offsetM: number
  /** Optional extra line, e.g. a seasonal warning. */
  readonly hint?: string
}

export interface TrackPanelDeps {
  readonly onSelectRow: (key: string) => void
  /** Fired when the slider is released (`change`), not on every `input`. */
  readonly onCorridorChange: (corridorM: number) => void
  readonly onFit: () => void
  readonly onRemove: () => void
  /** Click on a status line that was set with `actionable` (e.g. "erneut versuchen"). */
  readonly onStatusClick?: () => void
}

const PAGE_SIZE = 25
const CORRIDOR_STEP_M = 50
const BODY_OPEN = 'track-open'
const BODY_COLLAPSED = 'track-collapsed'

/** Breakpoint of the CSS: desktop column from this width up, bottom sheet below. */
const DESKTOP_MIN_WIDTH_PX = 601
/** Height of the collapsed bottom strip (matches `.leaflet-bottom` lift in track.css). */
export const COLLAPSED_STRIP_PX = 52

const isDesktop = (): boolean =>
  typeof window.matchMedia === 'function'
    ? window.matchMedia(`(min-width: ${DESKTOP_MIN_WIDTH_PX}px)`).matches
    : window.innerWidth >= DESKTOP_MIN_WIDTH_PX

const decimal = (n: number) => n.toFixed(1).replace('.', ',')

/** "180 m abseits" (10 m steps below 1 km) or "1,2 km abseits". */
export function formatOffset(offsetM: number): string {
  const rounded = Math.round(offsetM / 10) * 10
  return rounded < 1000 ? `${rounded} m abseits` : `${decimal(offsetM / 1000)} km abseits`
}

const countLabel = (n: number) => `${n} ${n === 1 ? 'Ort' : 'Orte'}`

/** Docked sheet for the active track: header, corridor slider and the paginated list of places along it. */
export class TrackPanel {
  private readonly root: HTMLElement
  private readonly nameEl: HTMLElement
  private readonly metaEl: HTMLElement
  private readonly stripEl: HTMLElement
  private readonly headingEl: HTMLElement
  private readonly toggleBtn: HTMLButtonElement
  private readonly removeSmall: HTMLElement
  private readonly bodyEl: HTMLElement
  private readonly slider: HTMLInputElement
  private readonly sliderLabel: HTMLElement
  private readonly statusEl: HTMLElement
  private readonly listEl: HTMLElement
  private readonly footer: HTMLElement
  private readonly events: EventScope = createEventScope()
  private track: Track | null = null
  private rows: readonly TrackPanelRow[] = []
  private page = 1
  private collapsed = false
  private statusActionable = false

  constructor(container: HTMLElement, private readonly deps: TrackPanelDeps) {
    this.root = clone(panelHtml)
    this.nameEl = ref(this.root, 'name')
    this.metaEl = ref(this.root, 'meta')
    this.stripEl = ref(this.root, 'strip')
    this.headingEl = ref(this.root, 'heading')
    this.toggleBtn = ref(this.root, 'toggle')
    this.removeSmall = ref(this.root, 'removeSmall')
    this.bodyEl = ref(this.root, 'body')
    this.slider = ref(this.root, 'corridor')
    this.sliderLabel = ref(this.root, 'corridorLabel')
    this.statusEl = ref(this.root, 'status')
    this.listEl = ref(this.root, 'list')
    this.footer = ref(this.root, 'footer')

    this.slider.min = String(MIN_CORRIDOR_M)
    this.slider.max = String(MAX_CORRIDOR_M)
    this.slider.step = String(CORRIDOR_STEP_M)

    this.toggleBtn.addEventListener('click', () => (this.collapsed ? this.expand() : this.collapse()))
    ref(this.root, 'fit').addEventListener('click', () => deps.onFit())
    ref(this.root, 'remove').addEventListener('click', () => deps.onRemove())
    this.removeSmall.addEventListener('click', () => deps.onRemove())
    const statusClick = () => { if (this.statusActionable) deps.onStatusClick?.() }
    this.statusEl.addEventListener('click', statusClick)
    this.statusEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); statusClick() }
    })
    this.slider.addEventListener('input', () => this.updateSliderLabel())
    this.slider.addEventListener('change', () => {
      this.updateSliderLabel()
      deps.onCorridorChange(Number(this.slider.value))
    })
    container.appendChild(this.root)
  }

  isVisible(): boolean { return !this.root.hidden }
  isCollapsed(): boolean { return this.collapsed }

  /**
   * Map area covered by the panel, for fitting the route into the visible part.
   * Desktop: the left column (incl. its offset). Mobile: only the collapsed strip,
   * as the sheet folds away once the map moves.
   */
  mapInsets(): { left: number; bottom: number } {
    if (!this.isVisible()) return { left: 0, bottom: 0 }
    if (isDesktop()) {
      return { left: Math.ceil(this.root.getBoundingClientRect().right), bottom: 0 }
    }
    // Only a collapsed bar is the strip; the expanded bar has a taller two-line header.
    const bar = this.collapsed ? this.root.querySelector<HTMLElement>('.track-sheet-bar') : null
    const h = bar?.getBoundingClientRect().height ?? 0
    return { left: 0, bottom: h > 0 ? Math.ceil(h) : COLLAPSED_STRIP_PX }
  }

  setTrack(track: Track | null): void {
    this.track = track
    if (!track) {
      this.root.hidden = true
      this.rows = []
      this.page = 1
      this.setStatus('')
      this.renderRows()
      this.syncBodyClasses()
      return
    }
    this.root.hidden = false
    this.nameEl.textContent = track.name
    this.slider.value = String(track.corridorM)
    this.updateSliderLabel()
    this.renderSummary()
    this.syncBodyClasses()
  }

  setRows(rows: readonly TrackPanelRow[]): void {
    this.rows = rows
    this.renderSummary()
    this.renderRows()
  }

  /** `actionable`: the line is a button that fires `onStatusClick` (retry). */
  setStatus(text: string, isError = false, actionable = false): void {
    this.statusEl.textContent = text
    this.statusEl.classList.toggle('track-status-error', isError)
    this.statusActionable = actionable && text !== ''
    this.statusEl.classList.toggle('track-status-action', this.statusActionable)
    if (this.statusActionable) {
      this.statusEl.setAttribute('role', 'button')
      this.statusEl.tabIndex = 0
    } else {
      this.statusEl.setAttribute('role', 'status')
      this.statusEl.removeAttribute('tabindex')
    }
  }

  /** Mobile only (bottom sheet): fold to the strip; no-op in the desktop column. */
  collapseOnMobile(): void {
    if (!isDesktop()) this.collapse()
  }

  collapse(): void { this.setCollapsed(true) }
  expand(): void { this.setCollapsed(false) }

  destroy(): void {
    this.events.dispose()
    document.body.classList.remove(BODY_OPEN, BODY_COLLAPSED)
    this.root.remove()
  }

  private setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed
    this.bodyEl.hidden = collapsed
    this.headingEl.hidden = collapsed
    this.stripEl.hidden = !collapsed
    this.removeSmall.hidden = !collapsed
    this.root.classList.toggle('collapsed', collapsed)
    this.toggleBtn.setAttribute('aria-expanded', String(!collapsed))
    this.toggleBtn.setAttribute('aria-label', collapsed ? 'Routenliste ausklappen' : 'Routenliste einklappen')
    this.syncBodyClasses()
  }

  private syncBodyClasses(): void {
    const visible = this.isVisible()
    document.body.classList.toggle(BODY_OPEN, visible)
    document.body.classList.toggle(BODY_COLLAPSED, visible && this.collapsed)
  }

  private updateSliderLabel(): void {
    this.sliderLabel.textContent = `Abstand zur Route: ${this.slider.value} m`
  }

  private renderSummary(): void {
    if (!this.track) return
    const length = formatKm(this.track.lengthM)
    const count = countLabel(this.rows.length)
    this.metaEl.textContent = `${length} · ${count}`
    this.stripEl.textContent = `${this.track.name} · ${length} · ${count}`
  }

  private renderRows(): void {
    const { items, page, pages, total } = paginate(this.rows, this.page, PAGE_SIZE)
    this.page = page
    renderList(this.listEl, items, {
      row: r => ({
        title: r.title,
        subtitle: r.subtitle,
        hint: r.hint ?? '',
        km: `km ${decimal(r.kmAlong)}`,
        offset: formatOffset(r.offsetM),
      }),
      on: { select: r => this.deps.onSelectRow(r.key) },
      decorate: (el, r) => {
        const icon = ref(el, 'icon')
        icon.style.setProperty('--track-row-color', r.color)
        if (r.iconSvg) {
          icon.classList.add('has-svg')
          icon.innerHTML = r.iconSvg // trusted: our own icon set, never user data
        }
        ref(el, 'hint').hidden = !r.hint
        ref(el, 'sub').hidden = r.subtitle === ''
      },
    })
    renderPagination(this.footer, page, pages, total, p => {
      this.page = p
      this.renderRows()
      this.listEl.scrollTop = 0
      this.bodyEl.scrollTop = 0
    })
  }
}
