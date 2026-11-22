import type { LatLngBounds } from './OverpassClient.js'

// Routes which 0.05° grid cells have already been fetched, so a viewport made
// entirely of seen cells needs no network, and a partially-new viewport only
// queries the bounding box of its not-yet-seen cells (a thin strip when
// panning) instead of the whole area again.

export const CELL_DEG = 0.05

const round2 = (v: number) => Math.round(v * 100) / 100

// Cell index range for a bounds. Lower edges are inclusive (floor), upper edges
// exclusive (ceil-1) so a viewport edge sitting exactly on a cell line doesn't
// pull in the next cell — which would otherwise be marked covered without
// having been fetched.
function cellRange(bounds: LatLngBounds) {
  return {
    yLo: Math.floor(bounds.south / CELL_DEG),
    yHi: Math.ceil(bounds.north / CELL_DEG) - 1,
    xLo: Math.floor(bounds.west / CELL_DEG),
    xHi: Math.ceil(bounds.east / CELL_DEG) - 1,
  }
}

/** Mark every cell touched by `bounds` as covered. */
export function markCovered(bounds: LatLngBounds, covered: Set<string>): void {
  const { yLo, yHi, xLo, xHi } = cellRange(bounds)
  for (let y = yLo; y <= yHi; y++) {
    for (let x = xLo; x <= xHi; x++) {
      covered.add(`${y}:${x}`)
    }
  }
}

/**
 * Bounding box of the cells in `bounds` that are not yet covered, or null when
 * the whole viewport is already covered (→ render from the store, no fetch).
 */
export function uncoveredBounds(bounds: LatLngBounds, covered: ReadonlySet<string>): LatLngBounds | null {
  const { yLo, yHi, xLo, xHi } = cellRange(bounds)
  let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity
  for (let y = yLo; y <= yHi; y++) {
    for (let x = xLo; x <= xHi; x++) {
      if (!covered.has(`${y}:${x}`)) {
        if (y < minY) minY = y
        if (y > maxY) maxY = y
        if (x < minX) minX = x
        if (x > maxX) maxX = x
      }
    }
  }
  if (maxY === -Infinity) return null
  return {
    south: round2(minY * CELL_DEG),
    north: round2((maxY + 1) * CELL_DEG),
    west: round2(minX * CELL_DEG),
    east: round2((maxX + 1) * CELL_DEG),
  }
}

export function withinBounds(p: { lat: number; lon: number }, b: LatLngBounds): boolean {
  return p.lat >= b.south && p.lat <= b.north && p.lon >= b.west && p.lon <= b.east
}
