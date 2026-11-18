import type { TrackPoint } from './trackTypes.js'

/** CSS px of the map covered by UI (e.g. the track panel); added to the default fit padding. */
export interface MapInsets {
  readonly left?: number
  readonly top?: number
  readonly right?: number
  readonly bottom?: number
}

/**
 * Makes the shown track editable by dragging: handles at the waypoints, and the
 * line itself can be grabbed. The layer only reports what the user did — it never
 * changes the track on its own; the owner answers with `show` + `setEditing`.
 */
export interface TrackEditing {
  /** Start, via points in route order, end — one handle each. */
  readonly waypoints: readonly TrackPoint[]
  /** A recalculation is running: handles and line are locked and the line is dimmed. */
  readonly busy?: boolean
  /** The line was grabbed at `grab` and released at `drop` (equal for a long-press/right-click). */
  readonly onInsert: (grab: TrackPoint, drop: TrackPoint) => void
  /** The handle of waypoint `index` was dragged to `to`. */
  readonly onMove: (index: number, to: TrackPoint) => void
  /** The handle of via point `index` was clicked/tapped (never start or end). */
  readonly onRemove: (index: number) => void
}

/** Port of the track slice towards the map: draws the imported tour as a line. */
export interface TrackLayer {
  /** Editing handles for the shown track; `null` (the default) = plain, non-interactive line. Survives `show`. */
  setEditing(editing: TrackEditing | null): void
  /** Draw the track, replacing any previous one. */
  show(points: readonly TrackPoint[]): void
  /** Zoom/pan so the whole track is visible. No-op without a track. */
  fitBounds(insets?: MapInsets): void
  /** Switch to the high-contrast colours used on aerial imagery. */
  setSatellite(on: boolean): void
  /** Dashed straight line from a point on the track to a place off it, replacing any previous one. */
  showConnector(from: TrackPoint, to: TrackPoint): void
  clearConnector(): void
  /** Remove the track and the connector. */
  clear(): void
}
