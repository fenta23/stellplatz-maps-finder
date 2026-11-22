import { simplify, routeLengthM } from './routeGeometry.js'
import { RouteImportError } from './routeErrors.js'
import {
  DEFAULT_CORRIDOR_M, MAX_LENGTH_M, MAX_POINTS, SIMPLIFY_TOLERANCE_M,
  type ImportedRoute, type Route, type LinePoint,
} from './routeTypes.js'

const round5 = (v: number) => Math.round(v * 1e5) / 1e5

function roundAndDedupe(points: readonly LinePoint[]): LinePoint[] {
  const out: LinePoint[] = []
  for (const [lat, lon] of points) {
    const r: LinePoint = [round5(lat), round5(lon)]
    const last = out[out.length - 1]
    if (!last || last[0] !== r[0] || last[1] !== r[1]) out.push(r)
  }
  return out
}

/** Turn raw imported points into the route that is shown and persisted. */
export function prepareRoute(imported: ImportedRoute, corridorM = DEFAULT_CORRIDOR_M): Route {
  if (imported.points.length < 2) throw new RouteImportError('no-points')
  const lengthM = Math.round(routeLengthM(imported.points))
  if (lengthM > MAX_LENGTH_M) throw new RouteImportError('track-too-long')

  let tolerance = SIMPLIFY_TOLERANCE_M
  let points = roundAndDedupe(simplify(imported.points, tolerance))
  while (points.length > MAX_POINTS) {
    tolerance *= 2
    points = roundAndDedupe(simplify(points, tolerance))
  }
  if (points.length < 2) throw new RouteImportError('no-points')

  return {
    name: imported.name.trim() || 'Route',
    source: imported.source,
    points,
    lengthM,
    corridorM,
    ...(imported.plan ? { plan: imported.plan } : {}),
  }
}
