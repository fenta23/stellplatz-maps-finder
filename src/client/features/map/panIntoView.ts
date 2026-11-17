import type L from 'leaflet'

// Keep the detail panel / bottom sheet from hiding a freshly selected POI.
// Desktop: a 320px side panel on the right → pan the POI into the left strip.
// Mobile: a 60dvh bottom sheet → pan the POI up into the strip above it.
// Mirrors the CSS in index.html (@media max-width:600px, height:60dvh).

export const PANEL_WIDTH = 320
export const MOBILE_BREAKPOINT = 600
export const MOBILE_SHEET_FRACTION = 0.6

export interface PanInput {
  /** POI position in map-container pixel coordinates. */
  readonly poi: { readonly x: number; readonly y: number }
  readonly isMobile: boolean
  readonly mapWidth: number
  readonly mapTop: number
  readonly viewportHeight: number
}

/** Pure: how far to pan so the POI sits in the still-visible strip. Never pans
 *  a POI that is already clear (returns 0). */
export function computePan(i: PanInput): { dx: number; dy: number } {
  if (i.isMobile) {
    const sheetTop = i.viewportHeight * (1 - MOBILE_SHEET_FRACTION) - i.mapTop
    const targetY = Math.max(sheetTop / 2, 40)
    const dy = i.poi.y - targetY
    return { dx: 0, dy: dy > 0 ? dy : 0 }
  }
  const visibleWidth = i.mapWidth - PANEL_WIDTH
  const targetX = Math.max(visibleWidth / 2, 40)
  const dx = i.poi.x - targetX
  return { dx: dx > 0 ? dx : 0, dy: 0 }
}

/** Thin DOM/Leaflet wrapper around computePan.
 *  @param effectiveMapTop  Viewport-y where the map is actually visible
 *                          (0 when ui-collapsed, otherwise bottom of header). */
export function panPoiIntoView(
  map: L.Map,
  container: HTMLElement,
  poi: { lat: number; lon: number },
  effectiveMapTop?: number,
): void {
  const mapTop = effectiveMapTop ?? container.getBoundingClientRect().top
  const point = map.latLngToContainerPoint([poi.lat, poi.lon])
  const { dx, dy } = computePan({
    poi: { x: point.x, y: point.y },
    isMobile: window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches,
    mapWidth: container.clientWidth,
    mapTop,
    viewportHeight: window.innerHeight,
  })
  if (dx !== 0 || dy !== 0) map.panBy([dx, dy], { animate: true })
}

/** A rectangle in map-container pixel coordinates. */
export interface MapArea {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

/** Map edges covered by UI other than the detail panel (header, track panel), in CSS px. */
export interface CoveredEdges {
  readonly left?: number
  readonly top?: number
  readonly bottom?: number
}

export interface FreeAreaInput {
  readonly isMobile: boolean
  readonly mapWidth: number
  readonly mapHeight: number
  /** Viewport y of the map container's top edge. */
  readonly containerTop: number
  readonly viewportHeight: number
  readonly covered?: CoveredEdges
}

/** Pure: the part of the map not covered by the detail panel (side panel / bottom sheet) or `covered`. */
export function freeMapArea(i: FreeAreaInput): MapArea {
  const top = i.covered?.top ?? 0
  const bottom = i.mapHeight - (i.covered?.bottom ?? 0)
  if (i.isMobile) {
    const sheetTop = i.viewportHeight * (1 - MOBILE_SHEET_FRACTION) - i.containerTop
    return { left: 0, top, right: i.mapWidth, bottom: Math.min(bottom, sheetTop) }
  }
  return { left: i.covered?.left ?? 0, top, right: i.mapWidth - PANEL_WIDTH, bottom }
}

/** Below this the free strip is too narrow to aim for; the map centre is used on that axis. */
export const MIN_FREE_PX = 80

/** Pure: how far to pan so the POI sits in the middle of `area`. Unlike computePan it moves in every direction. */
export function computeCenterPan(
  poi: { readonly x: number; readonly y: number },
  area: MapArea,
  map: { readonly width: number; readonly height: number },
): { dx: number; dy: number } {
  const cx = area.right - area.left >= MIN_FREE_PX ? (area.left + area.right) / 2 : map.width / 2
  const cy = area.bottom - area.top >= MIN_FREE_PX ? (area.top + area.bottom) / 2 : map.height / 2
  return { dx: Math.round(poi.x - cx), dy: Math.round(poi.y - cy) }
}

/** Thin DOM/Leaflet wrapper: pan so the POI sits in the middle of the still-visible map.
 *  @param covered  Edges in viewport px; `top` = viewport y where the map becomes visible. */
export function centerPoiInView(
  map: L.Map,
  container: HTMLElement,
  poi: { lat: number; lon: number },
  covered: CoveredEdges = {},
): void {
  const containerTop = container.getBoundingClientRect().top
  const size = { width: container.clientWidth, height: container.clientHeight }
  const area = freeMapArea({
    isMobile: window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches,
    mapWidth: size.width,
    mapHeight: size.height,
    containerTop,
    viewportHeight: window.innerHeight,
    covered: { ...covered, top: Math.max(0, (covered.top ?? containerTop) - containerTop) },
  })
  const point = map.latLngToContainerPoint([poi.lat, poi.lon])
  const { dx, dy } = computeCenterPan({ x: point.x, y: point.y }, area, size)
  if (dx !== 0 || dy !== 0) map.panBy([dx, dy], { animate: true })
}
