import { describe, it, expect } from 'vitest'
import { haversineMeters } from '../../core/geo.js'
import { chunkForOverpass, corridorBoxes, matchCorridor, overpassRadiusBucket, withinStretch } from './corridor.js'
import { createSegmentIndex, routeLengthM } from './routeGeometry.js'
import type { LinePoint } from './routeTypes.js'

const dist = (a: LinePoint, b: LinePoint) =>
  haversineMeters({ lat: a[0], lon: a[1] }, { lat: b[0], lon: b[1] })
const chunkLen = (c: readonly LinePoint[]) => routeLengthM(c)

/** Distance (m) from a point to a segment, planar around the point. */
function distToSegment(p: LinePoint, a: LinePoint, b: LinePoint): number {
  const kx = Math.cos((p[0] * Math.PI) / 180) * 111_195
  const ky = 111_195
  const ax = (a[1] - p[1]) * kx, ay = (a[0] - p[0]) * ky
  const bx = (b[1] - p[1]) * kx, by = (b[0] - p[0]) * ky
  const dx = bx - ax, dy = by - ay
  const l2 = dx * dx + dy * dy
  const t = l2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0
  return Math.hypot(ax + t * dx, ay + t * dy)
}

function checkCoverage(line: readonly LinePoint[], radiusM: number, stepM?: number) {
  const boxes = corridorBoxes(line, radiusM, stepM)
  let checked = 0
  const ky = 111_195
  for (let s = 0; s + 1 < line.length; s++) {
    const a = line[s]!, b = line[s + 1]!
    for (let t = 0; t <= 1.0001; t += 0.01) {
      const base: LinePoint = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
      const kx = Math.cos((base[0] * Math.PI) / 180) * 111_195
      for (const [dn, de] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7]]) {
        const p: LinePoint = [base[0] + (dn! * radiusM * 0.99) / ky, base[1] + (de! * radiusM * 0.99) / kx]
        let near = Infinity
        for (let k = 0; k + 1 < line.length; k++) near = Math.min(near, distToSegment(p, line[k]!, line[k + 1]!))
        if (near > radiusM) continue
        checked++
        const inside = boxes.some(bx => p[0] >= bx.south && p[0] <= bx.north && p[1] >= bx.west && p[1] <= bx.east)
        if (!inside) return { ok: false, checked, p }
      }
    }
  }
  return { ok: true, checked, p: null }
}

describe('corridorBoxes', () => {
  it('returns [] for empty input and one box for a single point', () => {
    expect(corridorBoxes([], 500)).toEqual([])
    const one = corridorBoxes([[50, 8]], 500)
    expect(one).toHaveLength(1)
    expect(one[0]!.north - 50).toBeCloseTo(500 * 1.01 / 111_195, 6)
  })

  it('one box per sample in route order, padded in every direction, longitude widened', () => {
    const boxes = corridorBoxes([[60, 10], [60, 10.2]], 500, 1000)
    expect(boxes.length).toBeGreaterThan(5)
    const first = boxes[0]!
    expect(first.north).toBeGreaterThan(60)
    expect(first.south).toBeLessThan(60)
    const latSpan = first.north - first.south
    const lonSpan = first.east - first.west
    expect(lonSpan / latSpan).toBeGreaterThan(1.9) // ~1/cos(60°) = 2
    for (let i = 1; i < boxes.length; i++) expect(boxes[i]!.west).toBeGreaterThan(boxes[i - 1]!.west)
  })

  it('covers the whole corridor of a long diagonal line (incl. ends)', () => {
    const r = checkCoverage([[50, 8], [50.3, 8.4]], 200)
    expect(r.checked).toBeGreaterThan(100)
    expect(r.ok).toBe(true)
  })

  it('covers the corridor of an L-shaped line with a custom step', () => {
    const r = checkCoverage([[50, 8], [50.2, 8], [50.2, 8.3]], 50, 2500)
    expect(r.ok).toBe(true)
    expect(checkCoverage([[50, 8], [50.2, 8], [50.2, 8.3]], 2000).ok).toBe(true)
  })
})

describe('chunkForOverpass', () => {
  const straight = (n: number, dLon = 0.01): LinePoint[] =>
    Array.from({ length: n }, (_, i) => [50 + (i % 2) * 0.01, 8 + i * dLon] as LinePoint)

  it('returns [] for empty and 1-point input', () => {
    expect(chunkForOverpass([])).toEqual([])
    expect(chunkForOverpass([[50, 8]])).toEqual([])
  })

  it('a short line stays one chunk with >= 2 points', () => {
    const c = chunkForOverpass([[50, 8], [50.01, 8.01]])
    expect(c).toHaveLength(1)
    expect(c[0]!.length).toBeGreaterThanOrEqual(2)
  })

  it('respects maxChunkM and maxVertices, neighbours share the boundary vertex', () => {
    const line = straight(300)
    const chunks = chunkForOverpass(line, { maxChunkM: 10_000, maxVertices: 20, toleranceM: 1 })
    expect(chunks.length).toBeGreaterThan(3)
    for (const c of chunks) {
      expect(c.length).toBeGreaterThanOrEqual(2)
      expect(c.length).toBeLessThanOrEqual(20)
      expect(chunkLen(c)).toBeLessThanOrEqual(10_000 + 1)
    }
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]![0]).toEqual(chunks[i - 1]![chunks[i - 1]!.length - 1])
    }
    expect(chunks[0]![0]).toEqual(line[0])
    expect(chunks[chunks.length - 1]!.at(-1)).toEqual(line[299])
  })

  it('splits by vertex count alone', () => {
    const chunks = chunkForOverpass(straight(100), { maxVertices: 10, toleranceM: 1, maxChunkM: 1e9 })
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(10)
    expect(chunks.length).toBeGreaterThan(9)
  })

  it('inserts intermediate points on a single segment longer than maxChunkM', () => {
    const a: LinePoint = [50, 8]
    const b: LinePoint = [50, 9] // ~71 km
    const chunks = chunkForOverpass([a, b], { maxChunkM: 25_000 })
    expect(chunks.length).toBeGreaterThanOrEqual(3)
    for (const c of chunks) {
      expect(c.length).toBeGreaterThanOrEqual(2)
      expect(chunkLen(c)).toBeLessThanOrEqual(25_000 + 1)
    }
    expect(chunks[0]![0]).toEqual(a)
    expect(chunks.at(-1)!.at(-1)).toEqual(b)
    expect(chunks.reduce((s, c) => s + chunkLen(c), 0)).toBeCloseTo(dist(a, b), -1)
  })

  it('simplifies first', () => {
    const line: LinePoint[] = [[50, 8], [50.00001, 8.005], [50, 8.01]]
    expect(chunkForOverpass(line, { toleranceM: 30 })[0]).toHaveLength(2)
  })
})

describe('matchCorridor', () => {
  const line: LinePoint[] = [[50, 8], [50, 8.1]] // ~7.1 km
  const lengthM = routeLengthM(line)
  const index = createSegmentIndex(line, 1000)
  const mk = (id: string, dLat: number, lon: number) => ({ id, lat: 50 + dLat, lon })

  it('keeps items within maxOffsetM, drops others, sorts by kmAlong then offset', () => {
    const items = [
      mk('late', 0.001, 8.08),
      mk('far', 0.02, 8.05), // ~2.2 km off
      mk('mid-far', 0.004, 8.052),
      mk('mid-near', 0.001, 8.05),
      mk('early', -0.002, 8.01),
    ]
    const hits = matchCorridor(index, lengthM, items, 500)
    expect(hits.map(h => h.item.id)).toEqual(['early', 'mid-near', 'mid-far', 'late'])
    expect(hits[0]!.offsetM).toBeGreaterThan(200)
    expect(hits[0]!.offsetM).toBeLessThan(240)
  })

  it('computes kmToEnd = length - kmAlong, never negative', () => {
    const [h] = matchCorridor(index, lengthM, [mk('x', 0.001, 8.05)], 500)
    expect(h!.kmAlong).toBeCloseTo(lengthM / 2000, 1)
    expect(h!.kmToEnd).toBeCloseTo(lengthM / 1000 - h!.kmAlong, 6)
    const [short] = matchCorridor(index, 1000, [mk('y', 0, 8.09)], 500)
    expect(short!.kmToEnd).toBe(0)
  })

  it('returns [] for no items and for an empty index', () => {
    expect(matchCorridor(index, lengthM, [], 500)).toEqual([])
    expect(matchCorridor(createSegmentIndex([], 500), 0, [mk('a', 0, 8)], 500)).toEqual([])
  })
})

describe('overpassRadiusBucket', () => {
  it('picks the smallest bucket >= corridor', () => {
    expect(overpassRadiusBucket(50)).toBe(500)
    expect(overpassRadiusBucket(500)).toBe(500)
    expect(overpassRadiusBucket(501)).toBe(1000)
    expect(overpassRadiusBucket(1000)).toBe(1000)
    expect(overpassRadiusBucket(1001)).toBe(2000)
    expect(overpassRadiusBucket(2000)).toBe(2000)
  })
})

describe('withinStretch', () => {
  const h = (kmAlong: number) => ({ kmAlong, id: kmAlong })
  const hits = [h(0), h(5), h(12), h(12.5), h(45), h(80)]

  it('keeps hits inside the range, bounds inclusive, order preserved', () => {
    expect(withinStretch(hits, 12, 45).map(x => x.id)).toEqual([12, 12.5, 45])
  })

  it('returns everything for the whole route and nothing for an empty stretch', () => {
    expect(withinStretch(hits, 0, 80)).toHaveLength(6)
    expect(withinStretch(hits, 50, 60)).toEqual([])
    expect(withinStretch([], 0, 10)).toEqual([])
  })

  it('does not mutate its input', () => {
    const copy = [...hits]
    withinStretch(hits, 1, 2)
    expect(hits).toEqual(copy)
  })
})
