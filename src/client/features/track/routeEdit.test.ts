import { describe, expect, it } from 'vitest'
import { insertVia, moveWaypoint, removeVia } from './routeEdit.js'
import type { RoutePlan, TrackPoint } from './trackTypes.js'

// A straight line west → east along 50° N; 0.01° of longitude ≈ 716 m.
const LINE: readonly TrackPoint[] = [[50, 10], [50, 10.1], [50, 10.2], [50, 10.3], [50, 10.4]]
const at = (lon: number, lat = 50) => ({ lat, lon })
const START = { lat: 50, lon: 10, label: 'A' }
const END = { lat: 50, lon: 10.4, label: 'B' }
const plan = (...via: Array<{ lat: number; lon: number }>): RoutePlan =>
  ({ mode: 'bike', waypoints: [START, ...via, END] })
const lons = (p: RoutePlan) => p.waypoints.map(w => w.lon)

describe('insertVia', () => {
  it('puts the first via point between start and end, at the drop position and without a label', () => {
    const next = insertVia(plan(), LINE, at(10.2), at(10.2, 50.05))
    expect(next).toEqual({ mode: 'bike', waypoints: [START, { lat: 50.05, lon: 10.2 }, END] })
  })

  it('orders by where the LINE was grabbed, not by where it was dropped', () => {
    const p = plan(at(10.1), at(10.3))
    expect(lons(insertVia(p, LINE, at(10.05), at(10.35)))).toEqual([10, 10.35, 10.1, 10.3, 10.4]) // before both
    expect(lons(insertVia(p, LINE, at(10.2), at(10.01)))).toEqual([10, 10.1, 10.01, 10.3, 10.4]) // between
    expect(lons(insertVia(p, LINE, at(10.35), at(10.02)))).toEqual([10, 10.1, 10.3, 10.02, 10.4]) // after both
  })

  it('uses the nearest point of the line for a grab slightly beside it', () => {
    const p = plan(at(10.2))
    expect(lons(insertVia(p, LINE, at(10.25, 50.001), at(10.25, 50.02)))).toEqual([10, 10.2, 10.25, 10.4])
  })

  it('goes just before the end when the grab point is nowhere near the line', () => {
    const p = plan(at(10.1), at(10.3))
    expect(lons(insertVia(p, LINE, at(10.2, 55), at(10.2, 55)))).toEqual([10, 10.1, 10.3, 10.2, 10.4])
  })

  it('a via point off the line counts as lying where its predecessor does', () => {
    // The second via is 5° north of the line: it inherits the position of the first (10.1).
    const p = plan(at(10.1), at(10.3, 55))
    expect(lons(insertVia(p, LINE, at(10.2), at(10.2)))).toEqual([10, 10.1, 10.3, 10.2, 10.4])
    expect(lons(insertVia(p, LINE, at(10.05), at(10.05)))).toEqual([10, 10.05, 10.1, 10.3, 10.4])
  })

  it('keeps start and end in place when the line runs out and back over itself', () => {
    const outAndBack: readonly TrackPoint[] = [[50, 10], [50, 10.2], [50, 10.4], [50, 10.2], [50, 10]]
    const home = { lat: 50, lon: 10 }
    const p: RoutePlan = { mode: 'foot', waypoints: [START, at(10.4), home] }
    const next = insertVia(p, outAndBack, at(10.1), at(10.1, 50.01))
    expect(next.waypoints).toHaveLength(4)
    expect(next.waypoints[0]).toEqual(START)
    expect(next.waypoints[3]).toEqual(home)
  })

  it('does not change its input', () => {
    const p = plan(at(10.1))
    const before = JSON.stringify(p)
    insertVia(p, LINE, at(10.2), at(10.2))
    expect(JSON.stringify(p)).toBe(before)
  })
})

describe('moveWaypoint', () => {
  it('moves start, via or end and drops the label of the moved one only', () => {
    const p = plan(at(10.2))
    expect(moveWaypoint(p, 0, at(10.01, 50.01)).waypoints).toEqual([{ lat: 50.01, lon: 10.01 }, at(10.2), END])
    expect(moveWaypoint(p, 1, at(10.25)).waypoints).toEqual([START, at(10.25), END])
    expect(moveWaypoint(p, 2, at(10.5)).waypoints).toEqual([START, at(10.2), { lat: 50, lon: 10.5 }])
    expect(moveWaypoint(p, 0, at(10.01)).waypoints[0]).not.toHaveProperty('label')
  })

  it.each([-1, 3, 1.5, NaN])('returns the same plan for the invalid index %s', (index) => {
    const p = plan(at(10.2))
    expect(moveWaypoint(p, index, at(10.3))).toBe(p)
  })
})

describe('removeVia', () => {
  it('removes a via point', () => {
    const p = plan(at(10.1), at(10.3))
    expect(lons(removeVia(p, 1))).toEqual([10, 10.3, 10.4])
    expect(lons(removeVia(p, 2))).toEqual([10, 10.1, 10.4])
  })

  it.each([0, 3, -1, 4, 1.5])('never removes start or end, nor an invalid index (%s)', (index) => {
    const p = plan(at(10.1), at(10.3))
    expect(removeVia(p, index)).toBe(p)
  })
})
