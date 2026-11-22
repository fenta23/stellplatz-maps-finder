import type { LinePoint } from './routeTypes.js'

/** CSS px of the map covered by UI (e.g. the route panel); added to the default fit padding. */
export interface MapInsets {
  readonly left?: number
  readonly top?: number
  readonly right?: number
  readonly bottom?: number
}

/**
 * Makes the shown route editable by dragging: handles at the waypoints, and the
 * line itself can be grabbed. The layer only reports what the user did — it never
 * changes the route on its own; the owner answers with `show` + `setEditing`.
 */
export interface RouteEditing {
  /** Start, via points in route order, end — one handle each. */
  readonly waypoints: readonly LinePoint[]
  /** A recalculation is running: handles and line are locked and the line is dimmed. */
  readonly busy?: boolean
  /** The line was grabbed at `grab` and released at `drop` (equal for a long-press/right-click). */
  readonly onInsert: (grab: LinePoint, drop: LinePoint) => void
  /** The handle of waypoint `index` was dragged to `to`. */
  readonly onMove: (index: number, to: LinePoint) => void
  /** The handle of via point `index` was clicked/tapped (never start or end). */
  readonly onRemove: (index: number) => void
}

/** Port of the route slice towards the map: draws the imported tour as a line. */
export interface RouteLayer {
  /** Editing handles for the shown route; `null` (the default) = plain, non-interactive line. Survives `show`. */
  setEditing(editing: RouteEditing | null): void
  /** Draw the route, replacing any previous one. */
  show(points: readonly LinePoint[]): void
  /** Zoom/pan so the whole route is visible. No-op without a route. */
  fitBounds(insets?: MapInsets): void
  /** Switch to the high-contrast colours used on aerial imagery. */
  setSatellite(on: boolean): void
  /** Dashed straight line from a point on the route to a place off it, replacing any previous one. */
  showConnector(from: LinePoint, to: LinePoint): void
  clearConnector(): void
  /** Remove the route and the connector. */
  clear(): void
}
