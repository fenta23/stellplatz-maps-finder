import type { TrackPoint } from './trackTypes.js'

/** CSS px of the map covered by UI (e.g. the track panel); added to the default fit padding. */
export interface MapInsets {
  readonly left?: number
  readonly top?: number
  readonly right?: number
  readonly bottom?: number
}

/** Port of the track slice towards the map: draws the imported tour as a line. */
export interface TrackLayer {
  /** Draw the track, replacing any previous one. */
  show(points: readonly TrackPoint[]): void
  /** Zoom/pan so the whole track is visible. No-op without a track. */
  fitBounds(insets?: MapInsets): void
  /** Switch to the high-contrast colours used on aerial imagery. */
  setSatellite(on: boolean): void
  clear(): void
}
