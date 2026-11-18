export interface UiCollapseDeps {
  readonly isMobile: () => boolean
  /** False during startup, so the initial setView does not fold the header away. */
  readonly isReady: () => boolean
  /** The search box shows the route form or the AI dialog. */
  readonly isBoxExpanded: () => boolean
  readonly collapseDetail: () => void
  readonly collapseTrack: () => void
}

export interface UiCollapse {
  /** Map was dragged or zoomed. */
  collapse(): void
  expand(): void
  /**
   * The app is about to move the map itself (jump to a searched place): Leaflet
   * reports that like a zoom by hand, a moment later. Ignore it for `ms`.
   */
  hold(ms?: number): void
}

const COLLAPSED = 'ui-collapsed'
const HOLD_MS = 1000

/**
 * Mobile: moving the map folds header, filter bar and the bottom sheets away.
 * The header stays while the search box is expanded — the route form and the
 * map-pick line live in it and must survive the map being moved.
 */
export function createUiCollapse(deps: UiCollapseDeps): UiCollapse {
  let holdUntil = 0
  return {
    collapse() {
      if (!deps.isMobile() || !deps.isReady()) return
      if (Date.now() < holdUntil) return
      if (!deps.isBoxExpanded()) document.body.classList.add(COLLAPSED)
      deps.collapseDetail()
      deps.collapseTrack()
    },
    expand() {
      document.body.classList.remove(COLLAPSED)
    },
    hold(ms = HOLD_MS) {
      holdUntil = Date.now() + ms
    },
  }
}
