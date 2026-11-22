// Changing a planned route by dragging it on the map: pure functions from the old
// plan to the new one. The recalculation itself is `fetchPlannedRoute`.

import { MAX_SNAP_M } from './osrmRoute.js'
import { createSegmentIndex, project } from './routeGeometry.js'
import type { RoutePlan, RoutePoint, LinePoint } from './routeTypes.js'

type LatLon = { readonly lat: number; readonly lon: number }

/**
 * New via point: the line was grabbed at `grab` and released at `drop`.
 * Where it goes among the existing via points follows from the position of `grab`
 * along the current line `points` — the plan itself has no geometry.
 */
export function insertVia(
  plan: RoutePlan, points: readonly LinePoint[], grab: LatLon, drop: LatLon,
): RoutePlan {
  const wps = plan.waypoints
  const index = createSegmentIndex(points, MAX_SNAP_M)
  const grabKm = project(index, grab)?.kmAlong
  // Not on the line at all (should not happen): just before the end.
  let at = wps.length - 1
  if (grabKm !== undefined) {
    at = 1
    let km = 0 // of the previous waypoint; keeps the order monotonic on loops and out-and-back legs
    for (let i = 1; i < wps.length - 1; i++) {
      km = Math.max(km, project(index, wps[i]!)?.kmAlong ?? km)
      if (km <= grabKm) at = i + 1
    }
  }
  const via: RoutePoint = { lat: drop.lat, lon: drop.lon }
  return { mode: plan.mode, waypoints: [...wps.slice(0, at), via, ...wps.slice(at)] }
}

/** Waypoint `index` (start, via or end) now sits at `to`; it loses its label. */
export function moveWaypoint(plan: RoutePlan, index: number, to: LatLon): RoutePlan {
  if (!Number.isInteger(index) || index < 0 || index >= plan.waypoints.length) return plan
  const moved: RoutePoint = { lat: to.lat, lon: to.lon }
  return { mode: plan.mode, waypoints: plan.waypoints.map((w, i) => (i === index ? moved : w)) }
}

/** Removes via point `index`; start, end and invalid indices return the plan unchanged. */
export function removeVia(plan: RoutePlan, index: number): RoutePlan {
  if (!Number.isInteger(index) || index <= 0 || index >= plan.waypoints.length - 1) return plan
  return { mode: plan.mode, waypoints: plan.waypoints.filter((_, i) => i !== index) }
}
