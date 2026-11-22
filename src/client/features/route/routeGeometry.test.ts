import { describe, it, expect } from 'vitest'
import {
  simplify, cumulativeMeters, routeLengthM, boundsOf, sampleEvery,
  createSegmentIndex, project, pointAtMeters,
} from './routeGeometry.js'
import type { LinePoint } from './routeTypes.js'

const M_PER_DEG_LAT = 111_195
/** Straight east-west line at lat 50 with a point every 0.001° lon. */
const eastLine = (n: number): LinePoint[] =>
  Array.from({ length: n }, (_, i) => [50, 10 + i * 0.001] as LinePoint)
const mPerDegLon = M_PER_DEG_LAT * Math.cos((50 * Math.PI) / 180)

describe('cumulativeMeters / trackLengthM', () => {
  it('returns running distances along a straight line', () => {
    const pts: LinePoint[] = [[0, 0], [0, 0.01], [0, 0.02]]
    const cum = cumulativeMeters(pts)
    expect(cum).toHaveLength(3)
    expect(cum[0]).toBe(0)
    expect(cum[1]).toBeCloseTo(0.01 * M_PER_DEG_LAT, 0)
    expect(cum[2]).toBeCloseTo(2 * cum[1]!, 3)
    expect(routeLengthM(pts)).toBeCloseTo(cum[2]!, 6)
  })

  it('handles 0 and 1 points', () => {
    expect(cumulativeMeters([])).toEqual([])
    expect(cumulativeMeters([[1, 1]])).toEqual([0])
    expect(routeLengthM([])).toBe(0)
    expect(routeLengthM([[1, 1]])).toBe(0)
  })
})

describe('boundsOf', () => {
  it('returns the bounding box', () => {
    expect(boundsOf([[1, 5], [3, 2], [2, 9]])).toEqual({ south: 1, west: 2, north: 3, east: 9 })
  })
  it('returns null for no points', () => {
    expect(boundsOf([])).toBeNull()
  })
})

describe('simplify', () => {
  it('removes collinear points but keeps first and last', () => {
    const out = simplify(eastLine(50), 1)
    expect(out).toEqual([eastLine(50)[0], eastLine(50)[49]])
  })

  it('keeps a sharp corner', () => {
    const pts: LinePoint[] = [[50, 10], [50, 10.005], [50, 10.01], [50.005, 10.01], [50.01, 10.01]]
    const out = simplify(pts, 5)
    expect(out).toEqual([[50, 10], [50, 10.01], [50.01, 10.01]])
  })

  it('drops a wiggle below the tolerance and keeps it above', () => {
    // 20 m sideways bump in the middle
    const bump = 20 / M_PER_DEG_LAT
    const pts: LinePoint[] = [[50, 10], [50 + bump, 10.005], [50, 10.01]]
    expect(simplify(pts, 30)).toHaveLength(2)
    expect(simplify(pts, 10)).toHaveLength(3)
  })

  it('is stack safe on 200k points', () => {
    // smooth wave: balanced splits, but still thousands of recursion levels worth of work
    const pts: LinePoint[] = Array.from({ length: 200_000 }, (_, i) =>
      [50 + 0.01 * Math.sin(i / 5000), 10 + i * 1e-6] as LinePoint)
    const out = simplify(pts, 1)
    expect(out[0]).toBe(pts[0])
    expect(out[out.length - 1]).toBe(pts[199_999])
    expect(out.length).toBeGreaterThan(2)
  })

  it('handles 0, 1 and 2 points and closed loops', () => {
    expect(simplify([], 5)).toEqual([])
    expect(simplify([[1, 2]], 5)).toEqual([[1, 2]])
    expect(simplify([[1, 2], [3, 4]], 5)).toEqual([[1, 2], [3, 4]])
    const loop: LinePoint[] = [[50, 10], [50, 10.01], [50.01, 10.01], [50, 10]]
    expect(simplify(loop, 5)).toHaveLength(4)
  })
})

describe('sampleEvery', () => {
  it('samples evenly including start and end', () => {
    const pts: LinePoint[] = [[0, 0], [0, 0.01]]
    const total = routeLengthM(pts)
    const out = sampleEvery(pts, 100)
    expect(out).toHaveLength(Math.ceil(total / 100) + 1)
    expect(out[0]).toEqual([0, 0])
    expect(out[out.length - 1]).toEqual([0, 0.01])
    for (let i = 1; i < out.length - 1; i++) {
      const d = routeLengthM([out[i - 1]!, out[i]!])
      expect(d).toBeCloseTo(100, 0)
    }
  })

  it('interpolates across vertices', () => {
    const pts: LinePoint[] = [[0, 0], [0, 0.001], [0.001, 0.001]]
    const out = sampleEvery(pts, 50)
    const total = routeLengthM(pts)
    expect(routeLengthM(out)).toBeLessThanOrEqual(total) // chords may cut the corner
    expect(routeLengthM(out)).toBeGreaterThan(total * 0.9)
    expect(out).toHaveLength(Math.ceil(total / 50) + 1)
    const idx = createSegmentIndex(pts, 5)
    for (const [lat, lon] of out.slice(0, 2)) expect(project(idx, { lat, lon })).not.toBeNull()
  })

  it('returns only start and end for a step longer than the track', () => {
    expect(sampleEvery([[0, 0], [0, 0.001]], 10_000)).toEqual([[0, 0], [0, 0.001]])
  })

  it('does not throw on degenerate input', () => {
    expect(sampleEvery([], 100)).toEqual([])
    expect(sampleEvery([[1, 1]], 100)).toEqual([[1, 1]])
    expect(sampleEvery([[0, 0], [0, 1]], 0)).toEqual([[0, 0], [0, 1]])
  })
})

describe('project', () => {
  const line = eastLine(11) // 10 segments of ~71 m, ~714 m total

  it('projects beside the middle of a segment', () => {
    const idx = createSegmentIndex([[50, 10], [50, 10.1]], 500) // one ~7 km segment
    const off = 100 / M_PER_DEG_LAT
    const r = project(idx, { lat: 50 + off, lon: 10.05 })!
    expect(r.offsetM).toBeCloseTo(100, 0)
    expect(r.kmAlong).toBeCloseTo((0.05 * mPerDegLon) / 1000, 2)
  })

  it('projects at a vertex', () => {
    const idx = createSegmentIndex(line, 100)
    const r = project(idx, { lat: 50, lon: 10.005 })!
    expect(r.offsetM).toBeLessThan(0.5)
    expect(r.kmAlong).toBeCloseTo((0.005 * mPerDegLon) / 1000, 3)
  })

  it('clamps to the ends', () => {
    const idx = createSegmentIndex(line, 100)
    const before = project(idx, { lat: 50, lon: 10 - 30 / mPerDegLon })!
    expect(before.kmAlong).toBe(0)
    expect(before.offsetM).toBeCloseTo(30, 0)
    const after = project(idx, { lat: 50, lon: 10.01 + 30 / mPerDegLon })!
    expect(after.kmAlong).toBeCloseTo(routeLengthM(line) / 1000, 6)
    expect(after.offsetM).toBeCloseTo(30, 0)
  })

  it('returns null outside the pad', () => {
    const idx = createSegmentIndex(line, 100)
    expect(project(idx, { lat: 50 + 150 / M_PER_DEG_LAT, lon: 10.005 })).toBeNull()
    expect(project(idx, { lat: 51, lon: 11 })).toBeNull()
  })

  it('finds points across a grid cell boundary', () => {
    // cell edge at lat 50.02; route just below, query just above, within pad
    const idx = createSegmentIndex([[50.0199, 10], [50.0199, 10.01]], 300)
    const r = project(idx, { lat: 50.0203, lon: 10.005 })!
    expect(r.offsetM).toBeCloseTo(0.0004 * M_PER_DEG_LAT, 0)
  })

  it('picks the closer pass of an out-and-back track', () => {
    const out: LinePoint[] = [[50, 10], [50, 10.01], [50.0003, 10.01], [50.0003, 10]]
    const idx = createSegmentIndex(out, 200)
    const r = project(idx, { lat: 50.00027, lon: 10.005 })!
    // closer to the way back (lat 50.0003) -> kmAlong beyond the turn
    expect(r.kmAlong).toBeGreaterThan(routeLengthM(out.slice(0, 3)) / 1000)
    expect(r.offsetM).toBeCloseTo(0.00003 * M_PER_DEG_LAT, 0)
  })

  it('prefers the smaller kmAlong on a tie', () => {
    const out: LinePoint[] = [[50, 10], [50, 10.01], [50, 10]]
    const idx = createSegmentIndex(out, 200)
    const r = project(idx, { lat: 50.0005, lon: 10.005 })!
    expect(r.kmAlong).toBeCloseTo((0.005 * mPerDegLon) / 1000, 3)
  })

  it('works for a single-segment track', () => {
    const idx = createSegmentIndex([[50, 10], [50.001, 10]], 50)
    const r = project(idx, { lat: 50.0005, lon: 10 + 20 / mPerDegLon })!
    expect(r.offsetM).toBeCloseTo(20, 0)
    expect(r.kmAlong).toBeCloseTo(0.0005 * M_PER_DEG_LAT / 1000, 3)
  })

  it('handles very long segments via the fallback list', () => {
    const idx = createSegmentIndex([[50, 0], [50, 20]], 100)
    const r = project(idx, { lat: 50, lon: 7 })!
    expect(r.offsetM).toBeLessThan(1)
    const expectedKm = (7 * mPerDegLon) / 1000
    expect(Math.abs(r.kmAlong - expectedKm) / expectedKm).toBeLessThan(0.01)
  })

  it('does not throw on 0 or 1 points', () => {
    expect(project(createSegmentIndex([], 100), { lat: 0, lon: 0 })).toBeNull()
    expect(project(createSegmentIndex([[0, 0]], 100), { lat: 0, lon: 0 })).toBeNull()
  })
})

describe('pointAtMeters', () => {
  const line = eastLine(11) // 10 segments of 0.001° lon
  const index = createSegmentIndex(line, 100)
  const segM = index.cumM[1]!

  it('is null without points and the only point of a single-point line', () => {
    expect(pointAtMeters({ points: [], cumM: [] }, 5)).toBeNull()
    expect(pointAtMeters({ points: [[50, 10]], cumM: [0] }, 5)).toEqual([50, 10])
  })

  it('clamps to start and end', () => {
    expect(pointAtMeters(index, -5)).toEqual(line[0])
    expect(pointAtMeters(index, 0)).toEqual(line[0])
    expect(pointAtMeters(index, 1e9)).toEqual(line[10])
  })

  it('returns vertices exactly and interpolates inside a segment', () => {
    expect(pointAtMeters(index, index.cumM[4]!)).toEqual(line[4])
    const p = pointAtMeters(index, 3.25 * segM)!
    expect(p[0]).toBeCloseTo(50, 9)
    expect(p[1]).toBeCloseTo(10.00325, 7)
  })

  it('is the foot of project(): the point of the line nearest to the projected place', () => {
    const place = { lat: 50.0005, lon: 10.00437 } // ~55 m north of the line
    const pos = project(index, place)!
    const foot = pointAtMeters(index, pos.kmAlong * 1000)!
    expect(foot[0]).toBeCloseTo(50, 7)
    expect(foot[1]).toBeCloseTo(place.lon, 5)
  })
})
