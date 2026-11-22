import type { TravelMode } from '@/core/travelMode.js'
// Shared types and limits of the route slice (imported tour → line on the map).

/** `[lat, lon]` — a tuple instead of an object keeps a 20,000-point route small in localStorage. */
export type LinePoint = readonly [lat: number, lon: number]

export type RouteSource = 'gpx' | 'komoot' | 'planned'

const ROUTE_SOURCES: ReadonlySet<unknown> = new Set<RouteSource>(['gpx', 'komoot', 'planned'])

export function isRouteSource(v: unknown): v is RouteSource {
  return ROUTE_SOURCES.has(v)
}

const SOURCE_LABELS: Readonly<Record<RouteSource, string>> = { gpx: 'GPX', komoot: 'Komoot', planned: 'Geplant' }

/** Short German label of where a route came from. */
export function sourceLabel(s: RouteSource): string {
  return SOURCE_LABELS[s]
}

/** Start, Zwischenpunkt (via) or Ziel of a planned route. */
export interface RoutePoint {
  readonly lat: number
  readonly lon: number
  /** Name shown in the route name; absent for points set on the map (via points, dragged ends). */
  readonly label?: string
}

/** How a planned route was calculated — kept with the route so it can be changed on the map later. */
export interface RoutePlan {
  readonly mode: TravelMode
  /** Start, via points in route order, end — at least two. */
  readonly waypoints: readonly RoutePoint[] // field name kept for stored routes
}

/** How many via points a planned route may have (start and end not counted). */
export const MAX_VIA_POINTS = 10

/** What an importer (GPX file, Komoot link, route planner) hands over: raw points in route order. */
export interface ImportedRoute {
  readonly name: string
  readonly source: RouteSource
  readonly points: readonly LinePoint[]
  /** Only for `source: 'planned'`; routes planned before this field existed have none (not editable). */
  readonly plan?: RoutePlan
}

/** The active route as shown and persisted: simplified points plus derived values. */
export interface Route extends ImportedRoute {
  readonly lengthM: number
  /** Search corridor to each side of the line, in metres. */
  readonly corridorM: number
}

/** A route in the on-device library. */
export interface SavedRoute extends Route {
  readonly id: string
  /** Epoch ms of the last save/re-activation; the library lists newest first. */
  readonly addedAt: number
}

/** How many routes stay on the device; beyond that the oldest inactive ones are dropped. */
export const MAX_SAVED_ROUTES = 10

export const MAX_FILE_BYTES = 10 * 1024 * 1024
export const MAX_LENGTH_M = 1_000_000
export const MAX_POINTS = 20_000
/** Douglas-Peucker tolerance to start with; doubled until MAX_POINTS is met. */
export const SIMPLIFY_TOLERANCE_M = 5
export const DEFAULT_CORRIDOR_M = 500
export const MIN_CORRIDOR_M = 50
export const MAX_CORRIDOR_M = 2000

/** Where something sits relative to the active route. */
export interface RoutePosition {
  /** Distance from the start to the nearest point on the route, in kilometres. */
  readonly kmAlong: number
  /** Remaining distance from that point to the end, in kilometres. */
  readonly kmToEnd: number
  /** Straight-line distance off the route, in metres. */
  readonly offsetM: number
}
