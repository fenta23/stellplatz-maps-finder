import './route.css'
import { clone, ref } from '@/core/template.js'
import { formatRouteOffset } from '@/core/format.js'
import { renderList } from '@/core/bind.js'
import { renderPagination } from '@/core/pagination.js'
import { createEventScope, type EventScope } from '@/core/events.js'
import { paginate } from '@shared/paginate.js'
import { formatKm } from './RouteImportDialog.js'
import { MAX_CORRIDOR_M, MIN_CORRIDOR_M, type Route } from './routeTypes.js'
import panelHtml from './routePanel.html?raw'

export interface RoutePanelRow {
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

export interface RoutePanelDeps {
  readonly onSelectRow: (key: string) => void
  /** Fired when the slider is released (`change`), not on every `input`. */
  readonly onCorridorChange: (corridorM: number) => void
  readonly onFit: () => void
  readonly onRemove: () => void
  /** Click on "Als GPX exportieren" (only enabled while rows are listed). */
  readonly onExport: () => void
  /** Fired when a stretch handle is released or "Ganze Route" is clicked: km range to show. */
  readonly onStretchChange?: (fromKm: number, toKm: number) => void
  /** Click on a status line that was set with `actionable` (e.g. "erneut versuchen"). */
  readonly onStatusClick?: () => void
}

const PAGE_SIZE = 25
const CORRIDOR_STEP_M = 50
const BODY_OPEN = 'track-open'
const BODY_COLLAPSED = 'track-collapsed'

/** Breakpoint of the CSS: desktop column from this width up, bottom sheet below. */
const DESKTOP_MIN_WIDTH_PX = 601
/** Height of the collapsed bottom strip (matches `.leaflet-bottom` lift in route.css). */
export const COLLAPSED_STRIP_PX = 52

const isDesktop = (): boolean =>
  typeof window.matchMedia === 'function'
    ? window.matchMedia(`(min-width: ${DESKTOP_MIN_WIDTH_PX}px)`).matches
    : window.innerWidth >= DESKTOP_MIN_WIDTH_PX

const decimal = (n: number) => n.toFixed(1).replace('.', ',')

/** "km 12,4" — the position label of a row (also used for the GPX waypoint description). */
export const formatKmAlong = (km: number): string => `km ${decimal(km)}`

/** Routes shorter than this get no stretch control. */
const MIN_STRETCH_ROUTE_M = 2000
/** From this length on the stretch handles move in whole km, below in 0.1 km. */
const COARSE_STRETCH_ROUTE_M = 20_000

/** "an der Route", "180 m abseits" or "1,2 km abseits" — shared with the POI detail panel via core/format. */
export function formatOffset(offsetM: number): string {
  return formatRouteOffset(offsetM)
}

const countLabel = (n: number) => `${n} ${n === 1 ? 'Ort' : 'Orte'}`

/** Docked sheet for the active route: header, corridor slider and the paginated list of places along it. */
export class RoutePanel {
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
  private readonly stretchEl: HTMLElement
  private readonly stretchLabel: HTMLElement
  private readonly stretchReset: HTMLButtonElement
  private readonly stretchFrom: HTMLInputElement
  private readonly stretchTo: HTMLInputElement
  private readonly exportBtn: HTMLButtonElement
  private readonly statusEl: HTMLElement
  private readonly listEl: HTMLElement
  private readonly footer: HTMLElement
  private readonly events: EventScope = createEventScope()
  private route: Route | null = null
  private rows: readonly RoutePanelRow[] = []
  private page = 1
  private collapsed = false
  private statusActionable = false
  private stretchMax = 0
  private stretchCoarse = false

  constructor(container: HTMLElement, private readonly deps: RoutePanelDeps) {
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
    this.stretchEl = ref(this.root, 'stretch')
    this.stretchLabel = ref(this.root, 'stretchLabel')
    this.stretchReset = ref(this.root, 'stretchReset')
    this.stretchFrom = ref(this.root, 'stretchFrom')
    this.stretchTo = ref(this.root, 'stretchTo')
    this.exportBtn = ref(this.root, 'export')
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
    this.exportBtn.addEventListener('click', () => { if (!this.exportBtn.disabled) deps.onExport() })
    // Dragging a handle pushes the other one along (from <= to always holds).
    this.stretchFrom.addEventListener('input', () => {
      if (Number(this.stretchFrom.value) > Number(this.stretchTo.value)) this.stretchTo.value = this.stretchFrom.value
      this.updateStretchLabel()
    })
    this.stretchTo.addEventListener('input', () => {
      if (Number(this.stretchTo.value) < Number(this.stretchFrom.value)) this.stretchFrom.value = this.stretchTo.value
      this.updateStretchLabel()
    })
    const stretchCommit = () => {
      this.updateStretchLabel()
      deps.onStretchChange?.(Number(this.stretchFrom.value), Number(this.stretchTo.value))
    }
    this.stretchFrom.addEventListener('change', stretchCommit)
    this.stretchTo.addEventListener('change', stretchCommit)
    this.stretchReset.addEventListener('click', () => {
      this.setStretch(0, this.stretchMax)
      deps.onStretchChange?.(0, this.stretchMax)
    })
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

  setRoute(route: Route | null): void {
    this.route = route
    if (!route) {
      this.root.hidden = true
      this.rows = []
      this.page = 1
      this.stretchEl.hidden = true
      this.exportBtn.disabled = true
      this.setStatus('')
      this.renderRows()
      this.syncBodyClasses()
      return
    }
    this.root.hidden = false
    this.nameEl.textContent = route.name
    this.slider.value = String(route.corridorM)
    this.updateSliderLabel()
    this.configureStretch(route)
    this.renderSummary()
    this.syncBodyClasses()
  }

  /** Restores a stretch (km, clamped to the route); does not fire `onStretchChange`. */
  setStretch(fromKm: number, toKm: number): void {
    if (this.stretchEl.hidden) return
    const clamp = (n: number) => Math.min(this.stretchMax, Math.max(0, Number.isFinite(n) ? n : 0))
    const from = clamp(Math.min(fromKm, toKm))
    const to = clamp(Math.max(fromKm, toKm))
    this.stretchFrom.value = String(from)
    this.stretchTo.value = String(to)
    this.updateStretchLabel()
  }

  setRows(rows: readonly RoutePanelRow[]): void {
    this.rows = rows
    this.exportBtn.disabled = rows.length === 0
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

  /** Sizes the stretch inputs for the route and resets them to the whole route. */
  private configureStretch(route: Route): void {
    const coarse = route.lengthM >= COARSE_STRETCH_ROUTE_M
    const step = coarse ? 1 : 0.1
    this.stretchCoarse = coarse
    this.stretchMax = coarse ? Math.ceil(route.lengthM / 1000) : Math.ceil(route.lengthM / 100) / 10
    this.stretchEl.hidden = route.lengthM < MIN_STRETCH_ROUTE_M
    for (const input of [this.stretchFrom, this.stretchTo]) {
      input.min = '0'
      input.max = String(this.stretchMax)
      input.step = String(step)
    }
    this.stretchFrom.value = '0'
    this.stretchTo.value = String(this.stretchMax)
    this.updateStretchLabel()
  }

  private updateStretchLabel(): void {
    const from = Number(this.stretchFrom.value)
    const to = Number(this.stretchTo.value)
    const fmt = (n: number) => (this.stretchCoarse ? String(n) : decimal(n))
    this.stretchLabel.textContent = `Abschnitt: km ${fmt(from)} – km ${fmt(to)}`
    this.stretchFrom.setAttribute('aria-valuetext', `${fmt(from)} Kilometer`)
    this.stretchTo.setAttribute('aria-valuetext', `${fmt(to)} Kilometer`)
    this.stretchReset.hidden = from <= 0 && to >= this.stretchMax
  }

  private renderSummary(): void {
    if (!this.route) return
    const length = formatKm(this.route.lengthM)
    const count = countLabel(this.rows.length)
    this.metaEl.textContent = `${length} · ${count}`
    this.stripEl.textContent = `${this.route.name} · ${length} · ${count}`
  }

  private renderRows(): void {
    const { items, page, pages, total } = paginate(this.rows, this.page, PAGE_SIZE)
    this.page = page
    renderList(this.listEl, items, {
      row: r => ({
        title: r.title,
        subtitle: r.subtitle,
        hint: r.hint ?? '',
        km: formatKmAlong(r.kmAlong),
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
