// Pure helpers for "POIs along the route": search boxes, Overpass chunks and
// matching items against the line. No DOM, no state.

import { haversineMeters } from '../../core/geo.js'
import {
  project, sampleEvery, simplify,
  type SegmentIndex, type RouteBounds,
} from './routeGeometry.js'
import type { LinePoint, RoutePosition } from './routeTypes.js'

const M_PER_DEG = 111_195
const toRad = (d: number) => (d * Math.PI) / 180
const dist = (a: LinePoint, b: LinePoint) =>
  haversineMeters({ lat: a[0], lon: a[1] }, { lat: b[0], lon: b[1] })

/**
 * One lat/lon box per sample point (every `stepM` along the line, incl. start
 * and end), in route order. A point of the corridor can lie up to stepM/2
 * (along the line) away from its nearest sample, so each box is padded by
 * `radiusM + stepM / 2` (+1 % for projection slack): together the boxes cover
 * every point within `radiusM` of the line, also on long straight segments.
 */
export function corridorBoxes(
  points: readonly LinePoint[], radiusM: number, stepM = 1000,
): RouteBounds[] {
  if (points.length === 0) return []
  const padM = (radiusM + (points.length > 1 ? stepM / 2 : 0)) * 1.01
  const padLat = padM / M_PER_DEG
  return sampleEvery(points, stepM).map(([lat, lon]) => {
    const farLat = Math.min(89, Math.max(Math.abs(lat - padLat), Math.abs(lat + padLat)))
    const padLon = padM / (M_PER_DEG * Math.cos(toRad(farLat)))
    return { south: lat - padLat, west: lon - padLon, north: lat + padLat, east: lon + padLon }
  })
}

export interface ChunkOptions {
  readonly maxChunkM?: number
  readonly maxVertices?: number
  readonly toleranceM?: number
}

/**
 * Simplify, then split into consecutive pieces for `around:` Overpass queries.
 * Each piece respects `maxChunkM` (path length) and `maxVertices`; neighbours
 * share their boundary vertex (no gap); over-long segments get intermediate
 * points. Every piece has at least 2 points; fewer than 2 input points → [].
 */
export function chunkForOverpass(points: readonly LinePoint[], opts: ChunkOptions = {}): LinePoint[][] {
  const maxChunkM = opts.maxChunkM ?? 25_000
  const maxVertices = Math.max(2, Math.floor(opts.maxVertices ?? 80))
  const simple = simplify(points, opts.toleranceM ?? 30)
  if (simple.length < 2) return []

  // Insert intermediate points on segments longer than maxChunkM.
  const pts: LinePoint[] = [simple[0]!]
  for (let i = 1; i < simple.length; i++) {
    const a = simple[i - 1]!
    const b = simple[i]!
    const len = dist(a, b)
    const n = Math.ceil((len / maxChunkM) * 1.001)
    for (let k = 1; k < n; k++) {
      const t = k / n
      pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    }
    pts.push(b)
  }

  const chunks: LinePoint[][] = []
  let cur: LinePoint[] = [pts[0]!]
  let curM = 0
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1]!
    const p = pts[i]!
    const d = dist(prev, p)
    if (cur.length >= maxVertices || curM + d > maxChunkM) {
      chunks.push(cur)
      cur = [prev]
      curM = 0
    }
    cur.push(p)
    curM += d
  }
  chunks.push(cur)
  return chunks
}

export interface CorridorHit<T> extends RoutePosition {
  readonly item: T
}

/**
 * Items within `maxOffsetM` of the line, with their position along it, sorted
 * by kmAlong then offsetM. `index` must have been created with a pad >=
 * `maxOffsetM` (createSegmentIndex(points, pad)), otherwise nearer-than-asked
 * items beyond the pad are silently missed.
 */
export function matchCorridor<T extends { readonly lat: number; readonly lon: number }>(
  index: SegmentIndex, lengthM: number, items: readonly T[], maxOffsetM: number,
): CorridorHit<T>[] {
  const hits: CorridorHit<T>[] = []
  const totalKm = lengthM / 1000
  for (const item of items) {
    const pos = project(index, item)
    if (!pos || pos.offsetM > maxOffsetM) continue
    hits.push({
      item, kmAlong: pos.kmAlong, offsetM: pos.offsetM,
      kmToEnd: Math.max(0, totalKm - pos.kmAlong),
    })
  }
  return hits.sort((a, b) => a.kmAlong - b.kmAlong || a.offsetM - b.offsetM)
}

/** Smallest Overpass radius bucket (m) that covers the corridor. */
export function overpassRadiusBucket(corridorM: number): 500 | 1000 | 2000 {
  return corridorM <= 500 ? 500 : corridorM <= 1000 ? 1000 : 2000
}

/**
 * Hits whose position along the route lies within [fromKm, toKm] (inclusive),
 * order preserved. Pure filter for the "Abschnitt" control: list and markers
 * both go through it so they always agree.
 */
export function withinStretch<T extends { readonly kmAlong: number }>(
  hits: readonly T[], fromKm: number, toKm: number,
): T[] {
  return hits.filter(h => h.kmAlong >= fromKm && h.kmAlong <= toKm)
}
