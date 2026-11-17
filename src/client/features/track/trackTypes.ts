// Shared types and limits of the track slice (imported tour → line on the map).

/** `[lat, lon]` — a tuple instead of an object keeps a 20,000-point track small in localStorage. */
export type TrackPoint = readonly [lat: number, lon: number]

export type TrackSource = 'gpx' | 'komoot'

/** What an importer (GPX file, Komoot link) hands over: raw points in route order. */
export interface ImportedTrack {
  readonly name: string
  readonly source: TrackSource
  readonly points: readonly TrackPoint[]
}

/** The active track as shown and persisted: simplified points plus derived values. */
export interface Track extends ImportedTrack {
  readonly lengthM: number
  /** Search corridor to each side of the line, in metres. */
  readonly corridorM: number
}

export const MAX_FILE_BYTES = 10 * 1024 * 1024
export const MAX_LENGTH_M = 1_000_000
export const MAX_POINTS = 20_000
/** Douglas-Peucker tolerance to start with; doubled until MAX_POINTS is met. */
export const SIMPLIFY_TOLERANCE_M = 5
export const DEFAULT_CORRIDOR_M = 500
export const MIN_CORRIDOR_M = 50
export const MAX_CORRIDOR_M = 2000
