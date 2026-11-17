// Pure geometry for imported tracks: simplification, sampling and
// projection of points onto the polyline. No DOM, no state.

import { haversineMeters } from '../../core/geo.js'
import type { TrackPoint } from './trackTypes.js'

export interface TrackBounds {
  readonly south: number
  readonly west: number
  readonly north: number
  readonly east: number
}

const M_PER_DEG = 111_195 // 2π · 6371 km / 360, matches haversineMeters
const toRad = (d: number) => (d * Math.PI) / 180
const dist = (a: TrackPoint, b: TrackPoint) =>
  haversineMeters({ lat: a[0], lon: a[1] }, { lat: b[0], lon: b[1] })

/** Distance from (px,py) to the segment (ax,ay)-(bx,by) in the plane; also returns the clamped parameter. */
function segmentFoot(
  px: number, py: number, ax: number, ay: number, bx: number, by: number,
): { t: number; d: number } {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return { t, d: Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) }
}

/** Douglas-Peucker with an explicit stack (safe for 200k+ points). Keeps first and last point. */
export function simplify(points: readonly TrackPoint[], toleranceM: number): TrackPoint[] {
  const n = points.length
  if (n <= 2) return [...points]
  let latSum = 0
  for (const p of points) latSum += p[0]
  const kx = Math.cos(toRad(latSum / n)) * M_PER_DEG
  const xs = new Float64Array(n)
  const ys = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const pt = points[i]!
    xs[i] = pt[1] * kx
    ys[i] = pt[0] * M_PER_DEG
  }
  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[n - 1] = 1
  const stack: number[] = [0, n - 1]
  while (stack.length > 0) {
    const hi = stack.pop()!
    const lo = stack.pop()!
    let maxD = -1
    let idx = -1
    for (let i = lo + 1; i < hi; i++) {
      const { d } = segmentFoot(xs[i]!, ys[i]!, xs[lo]!, ys[lo]!, xs[hi]!, ys[hi]!)
      if (d > maxD) { maxD = d; idx = i }
    }
    if (idx !== -1 && maxD > toleranceM) {
      keep[idx] = 1
      stack.push(lo, idx, idx, hi)
    }
  }
  const out: TrackPoint[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i]!)
  return out
}

/** Running distance along the line: [0, d01, d01+d12, …]. */
export function cumulativeMeters(points: readonly TrackPoint[]): number[] {
  const out: number[] = new Array(points.length)
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    if (i > 0) sum += dist(points[i - 1]!, points[i]!)
    out[i] = sum
  }
  return out
}

export function trackLengthM(points: readonly TrackPoint[]): number {
  let sum = 0
  for (let i = 1; i < points.length; i++) sum += dist(points[i - 1]!, points[i]!)
  return sum
}

export function boundsOf(points: readonly TrackPoint[]): TrackBounds | null {
  if (points.length === 0) return null
  let south = Infinity, west = Infinity, north = -Infinity, east = -Infinity
  for (const [lat, lon] of points) {
    if (lat < south) south = lat
    if (lat > north) north = lat
    if (lon < west) west = lon
    if (lon > east) east = lon
  }
  return { south, west, north, east }
}

/** Points along the line every `stepM` metres, including start and end (interpolated). */
export function sampleEvery(points: readonly TrackPoint[], stepM: number): TrackPoint[] {
  if (points.length < 2 || !(stepM > 0) || !Number.isFinite(stepM)) return [...points]
  const cum = cumulativeMeters(points)
  const total = cum[cum.length - 1]!
  const out: TrackPoint[] = [points[0]!]
  let seg = 0
  for (let target = stepM; target < total; target += stepM) {
    while (seg < points.length - 2 && cum[seg + 1]! < target) seg++
    const len = cum[seg + 1]! - cum[seg]!
    const t = len > 0 ? (target - cum[seg]!) / len : 0
    const a = points[seg]!
    const b = points[seg + 1]!
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
  }
  out.push(points[points.length - 1]!)
  return out
}

const CELL_DEG = 0.02
const MAX_CELLS_PER_SEGMENT = 4096

export interface SegmentIndex {
  readonly points: readonly TrackPoint[]
  readonly cumM: readonly number[]
  readonly padM: number
  readonly cells: ReadonlyMap<number, readonly number[]>
  /** Segments too large to register cell by cell; tested on every lookup. */
  readonly long: readonly number[]
}

const cellKey = (ilat: number, ilon: number) => (ilat + 5000) * 20_000 + (ilon + 10_000)

export function createSegmentIndex(points: readonly TrackPoint[], padM: number): SegmentIndex {
  const cumM = cumulativeMeters(points)
  const cells = new Map<number, number[]>()
  const long: number[] = []
  const padLat = padM / 111_000
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!
    const b = points[i + 1]!
    const maxAbsLat = Math.min(89, Math.max(Math.abs(a[0]), Math.abs(b[0])) + padLat)
    const padLon = padM / (111_000 * Math.cos(toRad(maxAbsLat)))
    const i0 = Math.floor((Math.min(a[0], b[0]) - padLat) / CELL_DEG)
    const i1 = Math.floor((Math.max(a[0], b[0]) + padLat) / CELL_DEG)
    const j0 = Math.floor((Math.min(a[1], b[1]) - padLon) / CELL_DEG)
    const j1 = Math.floor((Math.max(a[1], b[1]) + padLon) / CELL_DEG)
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > MAX_CELLS_PER_SEGMENT) {
      long.push(i)
      continue
    }
    for (let ci = i0; ci <= i1; ci++) {
      for (let cj = j0; cj <= j1; cj++) {
        const k = cellKey(ci, cj)
        const list = cells.get(k)
        if (list) list.push(i)
        else cells.set(k, [i])
      }
    }
  }
  return { points, cumM, padM, cells, long }
}

/** The point `m` metres along the line, clamped to its ends; null without points. */
export function pointAtMeters(
  line: Pick<SegmentIndex, 'points' | 'cumM'>, m: number,
): TrackPoint | null {
  const { points, cumM } = line
  const n = points.length
  if (n === 0) return null
  if (n === 1 || !(m > 0)) return points[0]!
  if (m >= cumM[n - 1]!) return points[n - 1]!
  // Invariant: cumM[lo] <= m < cumM[hi]
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (cumM[mid]! <= m) lo = mid
    else hi = mid
  }
  const len = cumM[hi]! - cumM[lo]!
  const t = len > 0 ? (m - cumM[lo]!) / len : 0
  const a = points[lo]!
  const b = points[hi]!
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

/** Nearest point on the line within the index' pad; null when farther away (or no segments). */
export function project(
  index: SegmentIndex, p: { lat: number; lon: number },
): { kmAlong: number; offsetM: number } | null {
  const key = cellKey(Math.floor(p.lat / CELL_DEG), Math.floor(p.lon / CELL_DEG))
  const local = index.cells.get(key)
  if (!local && index.long.length === 0) return null
  const kx = Math.cos(toRad(p.lat)) * M_PER_DEG
  let bestOff = Infinity
  let bestM = 0
  const test = (i: number) => {
    const a = index.points[i]!
    const b = index.points[i + 1]!
    const { t, d } = segmentFoot(
      0, 0,
      (a[1] - p.lon) * kx, (a[0] - p.lat) * M_PER_DEG,
      (b[1] - p.lon) * kx, (b[0] - p.lat) * M_PER_DEG,
    )
    if (d > index.padM) return
    const m = index.cumM[i]! + t * (index.cumM[i + 1]! - index.cumM[i]!)
    if (d < bestOff - 1 || (d <= bestOff + 1 && m < bestM)) {
      bestOff = d
      bestM = m
    }
  }
  if (local) for (const i of local) test(i)
  for (const i of index.long) test(i)
  return bestOff === Infinity ? null : { kmAlong: bestM / 1000, offsetM: bestOff }
}
