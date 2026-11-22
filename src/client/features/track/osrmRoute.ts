// Route planning via the public OSRM instances of FOSSGIS (routing.openstreetmap.de).
// One simple GET straight from the browser (CORS is open, no custom headers → no
// preflight). The result is an ImportedTrack like a GPX file or a Komoot tour, so
// it flows through the same pipeline. Kill switch below in case the service
// changes its terms or goes away.
//
// OSRM quirks handled here: errors come as HTTP 400 *with* a JSON body, and
// start = end or points far off any road still answer `code: "Ok"` — those cases
// are checked by us.

import { haversineMeters } from '@/core/geo.js'
import { TRAVEL_MODE_LABEL, type TravelMode } from '@/core/travelMode.js'
import { TrackImportError } from './trackErrors.js'
import {
  MAX_LENGTH_M, MAX_VIA_POINTS,
  type ImportedTrack, type RoutePlan, type RoutePoint, type TrackPoint,
} from './trackTypes.js'

export const ROUTE_PLANNING_ENABLED = true
/** A snapped waypoint further than this from the road network counts as "no road nearby". */
export const MAX_SNAP_M = 2000

const BASE = 'https://routing.openstreetmap.de'
const DEFAULT_TIMEOUT_MS = 15_000
/** Straight-line distance below which start and end count as the same place. */
const MIN_AIR_M = 20
/** Route length below which the result counts as "same place". */
const MIN_ROUTE_M = 10
const FALLBACK_NAME = 'Kartenpunkt'

/** The instance decides the profile; the path always says `driving`. Coordinates are lon,lat. */
export function buildRouteUrl(plan: RoutePlan): string {
  const coords = plan.waypoints.map(p => `${p.lon},${p.lat}`).join(';')
  return `${BASE}/routed-${plan.mode}/route/v1/driving/${coords}?overview=full&geometries=geojson`
}

/** "Dresden → Pirna (Rad)" */
export function plannedRouteName(start: string, end: string, mode: TravelMode): string {
  return `${start} → ${end} (${TRAVEL_MODE_LABEL[mode]})`
}

const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function toPoints(coordinates: unknown): TrackPoint[] | null {
  if (!Array.isArray(coordinates)) return null
  const points: TrackPoint[] = []
  for (const c of coordinates) {
    const lon = Array.isArray(c) ? c[0] : undefined
    const lat = Array.isArray(c) ? c[1] : undefined
    if (!isFiniteNum(lat) || !isFiniteNum(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue
    points.push([lat, lon])
  }
  return points
}

/** Own label if given, else the street name OSRM snapped to, else a neutral fallback. */
function endpointName(endpoint: RoutePoint, waypoint: unknown): string {
  const label = endpoint.label?.trim()
  if (label) return label
  const name = (waypoint as { name?: unknown } | null | undefined)?.name
  return typeof name === 'string' && name.trim() ? name.trim() : FALLBACK_NAME
}

/**
 * Where a via point is kept: on the road OSRM snapped it to, so its handle sits on
 * the line. Start and end keep the requested place instead (see `fetchPlannedRoute`).
 */
function snappedVia(via: RoutePoint, waypoint: unknown): RoutePoint {
  const loc = (waypoint as { location?: unknown } | null | undefined)?.location
  const lon = Array.isArray(loc) ? loc[0] : undefined
  const lat = Array.isArray(loc) ? loc[1] : undefined
  const snapped = isFiniteNum(lat) && isFiniteNum(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
  const label = via.label?.trim()
  return { lat: snapped ? lat : via.lat, lon: snapped ? lon : via.lon, ...(label ? { label } : {}) }
}

/**
 * The result carries its `plan` (start, via points, end, mode) so the route can be
 * changed on the map later. Start and end keep the requested coordinates and get the
 * resolved name as label — the route name then stays the same when a via point is added.
 */
export async function fetchPlannedRoute(
  plan: RoutePlan,
  fetchFn: typeof fetch = (...a) => fetch(...a),
  signal?: AbortSignal,
  options: { enabled?: boolean; timeoutMs?: number } = {},
): Promise<ImportedTrack> {
  const { enabled = ROUTE_PLANNING_ENABLED, timeoutMs = DEFAULT_TIMEOUT_MS } = options
  if (!enabled) throw new TrackImportError('route-disabled')

  const all = plan.waypoints
  if (all.length < 2) throw new TrackImportError('route-unreachable', 'invalid plan')
  const start = all[0]!
  const end = all[all.length - 1]!
  const via = all.slice(1, -1)
  if (via.length > MAX_VIA_POINTS) throw new TrackImportError('route-too-many-vias')

  // Straight-line checks first: no network request for obviously useless input.
  // With via points start = end is a legitimate round trip.
  let airM = 0
  for (let i = 1; i < all.length; i++) airM += haversineMeters(all[i - 1]!, all[i]!)
  if (via.length === 0 && airM < MIN_AIR_M) throw new TrackImportError('route-same-point')
  if (airM > MAX_LENGTH_M) throw new TrackImportError('track-too-long')

  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal

  let body: unknown
  try {
    const res = await fetchFn(buildRouteUrl(plan), { credentials: 'omit', signal: combined })
    if (res.status === 429) throw new TrackImportError('route-busy')
    if (res.status >= 500) throw new TrackImportError('route-unreachable', String(res.status))
    // OSRM reports routing failures as HTTP 400 with a JSON body — read it either way.
    try {
      body = await res.json()
    } catch {
      throw new TrackImportError('route-unreachable', res.ok ? 'no json' : String(res.status))
    }
    const code = (body as { code?: unknown } | null)?.code
    if (code === 'NoRoute') throw new TrackImportError('route-not-found')
    if (code === 'NoSegment') throw new TrackImportError('route-no-road')
    if (code !== 'Ok') throw new TrackImportError('route-unreachable', typeof code === 'string' ? code : String(res.status))
  } catch (err) {
    if (signal?.aborted) throw err
    if (err instanceof TrackImportError) throw err
    throw new TrackImportError('route-unreachable', err instanceof Error ? err.message : undefined)
  }

  const { routes, waypoints } = body as { routes?: unknown; waypoints?: unknown }
  const route = Array.isArray(routes) ? (routes[0] as Record<string, unknown> | undefined) : undefined
  if (!route) throw new TrackImportError('route-not-found')

  const wps: readonly unknown[] = Array.isArray(waypoints) ? waypoints : []
  for (const wp of wps) {
    const d = (wp as { distance?: unknown } | null)?.distance
    if (isFiniteNum(d) && d > MAX_SNAP_M) throw new TrackImportError('route-no-road')
  }

  const distance = route.distance
  if (isFiniteNum(distance) && distance > MAX_LENGTH_M) throw new TrackImportError('track-too-long')

  const points = toPoints((route.geometry as { coordinates?: unknown } | null | undefined)?.coordinates)
  if (!points) throw new TrackImportError('route-unreachable', 'no geometry')
  if (points.length < 2 || (isFiniteNum(distance) && distance < MIN_ROUTE_M)) {
    throw new TrackImportError('route-same-point')
  }

  const startName = endpointName(start, wps[0])
  const endName = endpointName(end, wps[all.length - 1])
  const planned: RoutePoint[] = [
    { lat: start.lat, lon: start.lon, label: startName },
    ...via.map((v, i) => snappedVia(v, wps[i + 1])),
    { lat: end.lat, lon: end.lon, label: endName },
  ]
  return {
    name: plannedRouteName(startName, endName, plan.mode),
    source: 'planned',
    points,
    plan: { mode: plan.mode, waypoints: planned },
  }
}
