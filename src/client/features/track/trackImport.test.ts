import { describe, it, expect } from 'vitest'
import { prepareTrack } from './trackImport.js'
import { TrackImportError } from './trackErrors.js'
import { trackLengthM } from './trackGeometry.js'
import { DEFAULT_CORRIDOR_M, MAX_POINTS, type ImportedTrack, type TrackPoint } from './trackTypes.js'

const track = (points: TrackPoint[], name = 'Tour'): ImportedTrack => ({ name, source: 'gpx', points })

const kindOf = (fn: () => unknown) => {
  try { fn() } catch (e) { return e instanceof TrackImportError ? e.kind : 'other' }
  return null
}

describe('prepareTrack', () => {
  it('throws no-points for fewer than 2 points', () => {
    expect(kindOf(() => prepareTrack(track([])))).toBe('no-points')
    expect(kindOf(() => prepareTrack(track([[50, 10]])))).toBe('no-points')
  })

  it('throws no-points when all points collapse to one', () => {
    expect(kindOf(() => prepareTrack(track([[50, 10], [50, 10], [50, 10]])))).toBe('no-points')
  })

  it('throws track-too-long above the limit', () => {
    expect(kindOf(() => prepareTrack(track([[0, 0], [0, 10]])))).toBe('track-too-long')
  })

  it('computes lengthM from the original points, rounded', () => {
    const pts: TrackPoint[] = [[50, 10], [50.0001, 10.01], [50, 10.02]]
    const t = prepareTrack(track(pts))
    expect(t.lengthM).toBe(Math.round(trackLengthM(pts)))
    expect(Number.isInteger(t.lengthM)).toBe(true)
  })

  it('simplifies collinear points', () => {
    const pts: TrackPoint[] = Array.from({ length: 100 }, (_, i) => [50, 10 + i * 0.0005] as TrackPoint)
    expect(prepareTrack(track(pts)).points).toHaveLength(2)
  })

  it('rounds to 5 decimals and drops consecutive duplicates', () => {
    const t = prepareTrack(track([[50.000001, 10.000001], [50.000002, 10.000002], [50.1234567, 10.1234567]]))
    expect(t.points).toEqual([[50, 10], [50.12346, 10.12346]])
  })

  it('doubles the tolerance until MAX_POINTS is met', () => {
    const n = 60_000
    // fast wave (~6 m amplitude jitter every point) keeps many points at 5 m tolerance
    const pts: TrackPoint[] = Array.from({ length: n }, (_, i) =>
      [50 + 0.00008 * Math.sin(i * 1.7) + 0.0002 * Math.sin(i / 3000), 10 + i * 0.00002] as TrackPoint)
    const t = prepareTrack(track(pts))
    expect(t.points.length).toBeLessThanOrEqual(MAX_POINTS)
    expect(t.points.length).toBeGreaterThan(2)
  })

  it('trims the name and falls back to Route', () => {
    const pts: TrackPoint[] = [[50, 10], [50, 10.01]]
    expect(prepareTrack(track(pts, '  Eifelsteig ')).name).toBe('Eifelsteig')
    expect(prepareTrack(track(pts, '   ')).name).toBe('Route')
  })

  it('uses the default corridor and passes a custom one through', () => {
    const pts: TrackPoint[] = [[50, 10], [50, 10.01]]
    expect(prepareTrack(track(pts)).corridorM).toBe(DEFAULT_CORRIDOR_M)
    expect(prepareTrack(track(pts), 800).corridorM).toBe(800)
  })

  it('keeps the source', () => {
    expect(prepareTrack({ name: 'x', source: 'komoot', points: [[50, 10], [50, 10.01]] }).source).toBe('komoot')
  })
})
