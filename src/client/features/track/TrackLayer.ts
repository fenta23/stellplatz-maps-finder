import type { TrackPoint } from './trackTypes.js'

/** Port of the track slice towards the map: draws the imported tour as a line. */
export interface TrackLayer {
  /** Draw the track, replacing any previous one. */
  show(points: readonly TrackPoint[]): void
  /** Zoom/pan so the whole track is visible. No-op without a track. */
  fitBounds(): void
  /** Switch to the high-contrast colours used on aerial imagery. */
  setSatellite(on: boolean): void
  clear(): void
}
