import { describe, it, expect } from 'vitest'
import { prepareRoute } from './routeImport.js'
import { RouteImportError } from './routeErrors.js'
import { routeLengthM } from './routeGeometry.js'
import { DEFAULT_CORRIDOR_M, MAX_POINTS, type ImportedRoute, type LinePoint } from './routeTypes.js'

const route = (points: LinePoint[], name = 'Tour'): ImportedRoute => ({ name, source: 'gpx', points })

const kindOf = (fn: () => unknown) => {
  try { fn() } catch (e) { return e instanceof RouteImportError ? e.kind : 'other' }
  return null
}

describe('prepareRoute', () => {
  it('throws no-points for fewer than 2 points', () => {
    expect(kindOf(() => prepareRoute(route([])))).toBe('no-points')
    expect(kindOf(() => prepareRoute(route([[50, 10]])))).toBe('no-points')
  })

  it('throws no-points when all points collapse to one', () => {
    expect(kindOf(() => prepareRoute(route([[50, 10], [50, 10], [50, 10]])))).toBe('no-points')
  })

  it('throws track-too-long above the limit', () => {
    expect(kindOf(() => prepareRoute(route([[0, 0], [0, 10]])))).toBe('track-too-long')
  })

  it('computes lengthM from the original points, rounded', () => {
    const pts: LinePoint[] = [[50, 10], [50.0001, 10.01], [50, 10.02]]
    const t = prepareRoute(route(pts))
    expect(t.lengthM).toBe(Math.round(routeLengthM(pts)))
    expect(Number.isInteger(t.lengthM)).toBe(true)
  })

  it('simplifies collinear points', () => {
    const pts: LinePoint[] = Array.from({ length: 100 }, (_, i) => [50, 10 + i * 0.0005] as LinePoint)
    expect(prepareRoute(route(pts)).points).toHaveLength(2)
  })

  it('rounds to 5 decimals and drops consecutive duplicates', () => {
    const t = prepareRoute(route([[50.000001, 10.000001], [50.000002, 10.000002], [50.1234567, 10.1234567]]))
    expect(t.points).toEqual([[50, 10], [50.12346, 10.12346]])
  })

  it('doubles the tolerance until MAX_POINTS is met', () => {
    const n = 60_000
    // fast wave (~6 m amplitude jitter every point) keeps many points at 5 m tolerance
    const pts: LinePoint[] = Array.from({ length: n }, (_, i) =>
      [50 + 0.00008 * Math.sin(i * 1.7) + 0.0002 * Math.sin(i / 3000), 10 + i * 0.00002] as LinePoint)
    const t = prepareRoute(route(pts))
    expect(t.points.length).toBeLessThanOrEqual(MAX_POINTS)
    expect(t.points.length).toBeGreaterThan(2)
  })

  it('trims the name and falls back to Route', () => {
    const pts: LinePoint[] = [[50, 10], [50, 10.01]]
    expect(prepareRoute(route(pts, '  Eifelsteig ')).name).toBe('Eifelsteig')
    expect(prepareRoute(route(pts, '   ')).name).toBe('Route')
  })

  it('uses the default corridor and passes a custom one through', () => {
    const pts: LinePoint[] = [[50, 10], [50, 10.01]]
    expect(prepareRoute(route(pts)).corridorM).toBe(DEFAULT_CORRIDOR_M)
    expect(prepareRoute(route(pts), 800).corridorM).toBe(800)
  })

  it('keeps the source', () => {
    expect(prepareRoute({ name: 'x', source: 'komoot', points: [[50, 10], [50, 10.01]] }).source).toBe('komoot')
  })

  it('carries the plan of a planned route through, and adds none to an import', () => {
    const plan = { mode: 'bike', waypoints: [{ lat: 50, lon: 10, label: 'A' }, { lat: 50, lon: 10.02, label: 'B' }] } as const
    const planned = prepareRoute({ name: 'A → B (Rad)', source: 'planned', points: [[50, 10], [50, 10.02]], plan })
    expect(planned.plan).toEqual(plan)
    expect(prepareRoute(route([[50, 10], [50, 10.02]]))).not.toHaveProperty('plan')
  })
})
