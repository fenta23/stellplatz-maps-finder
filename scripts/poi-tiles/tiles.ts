// Pure building blocks for the static POI tiles (see build.ts). No I/O here so
// everything is unit-testable; the filter definitions come straight from the
// client so there is exactly one source of truth for "what is a camper spot".

import {
  classifyElement, DEFAULT_FILTERS,
  type FilterDef, type OsmElementKind,
} from '../../src/client/features/filters/filterModel.js'
import type { OsmTags } from '../../src/client/features/pois/OverpassClient.js'

export const CELL_DEG = 0.25
export const PARKING_FILTER_ID = 'parking'
export const ATTRIBUTION = '© OpenStreetMap-Mitwirkende, ODbL'

export type Layer = 'parking' | 'rest'
export const LAYERS: readonly Layer[] = ['parking', 'rest']

/** Compact on-disk POI: [type, id, lat, lon, tags] with type n/w/r. */
export type TileType = 'n' | 'w' | 'r'
export type TilePoi = readonly [TileType, number, number, number, Readonly<Record<string, string>>]

export interface Manifest {
  readonly version: string
  readonly date: string
  readonly cellDeg: number
  /** Non-empty tile keys per layer — anything not listed is empty (no request). */
  readonly tiles: Readonly<Record<Layer, readonly string[]>>
  /** POIs per layer — for the data repo's STAND.md and sanity checks. */
  readonly counts: Readonly<Record<Layer, number>>
  readonly attribution: string
  readonly notes: string
}

// ── osmium tags-filter expressions ──────────────────────────────────────────

const KIND_LETTER: Record<OsmElementKind, string> = { node: 'n', way: 'w', relation: 'r' }

/**
 * Coarse pre-filter for `osmium tags-filter`: one expression per (element kinds, key)
 * built from each selector's first positive condition, e.g. `nw/amenity=parking,water_point`.
 * Negations / secondary conditions (motorhome, shelter_type) are left to
 * classifyElement afterwards — the pre-filter only has to be a superset.
 */
export function osmiumExpressions(filters: readonly FilterDef[]): string[] {
  const groups = new Map<string, Set<string>>() // "nw/amenity" → values
  for (const f of filters) {
    if (f.kind !== 'osm') continue
    for (const sel of f.selectors) {
      const primary = sel.tags.find(c => !c.negate)
      if (!primary) continue
      const kinds = (['node', 'way', 'relation'] as const)
        .filter(k => sel.elements.includes(k)).map(k => KIND_LETTER[k]).join('')
      const groupKey = `${kinds}/${primary.key}`
      const values = groups.get(groupKey) ?? new Set<string>()
      if (primary.value !== '') values.add(primary.value)
      groups.set(groupKey, values)
    }
  }
  return [...groups].map(([k, values]) => values.size === 0 ? k : `${k}=${[...values].join(',')}`)
}

// ── Geometry → centre (same as Overpass `out center`: bbox centre) ──────────

export interface Geometry {
  readonly type: string
  readonly coordinates: unknown
}

/** Centre of the geometry's bounding box as {lat, lon}, or null for empty geometries. */
export function bboxCenter(geometry: Geometry): { lat: number; lon: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const walk = (c: unknown): void => {
    if (!Array.isArray(c)) return
    if (typeof c[0] === 'number' && typeof c[1] === 'number') {
      const x = c[0], y = c[1]
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      return
    }
    for (const sub of c) walk(sub)
  }
  walk(geometry.coordinates)
  if (minX === Infinity) return null
  return { lat: round7((minY + maxY) / 2), lon: round7((minX + maxX) / 2) }
}

const round7 = (v: number) => Math.round(v * 1e7) / 1e7

// ── Classification → layer ──────────────────────────────────────────────────

const NON_PARKING = DEFAULT_FILTERS.filter(f => f.id !== PARKING_FILTER_ID)
const PARKING_ONLY = DEFAULT_FILTERS.filter(f => f.id === PARKING_FILTER_ID)

/**
 * Which layer a raw OSM element belongs to, or null if no built-in filter wants it.
 * Anything claimed by a non-parking built-in goes to `rest` — even if it is also a
 * plain parking (e.g. amenity=parking + tourism=camp_site), so users with the
 * parking filter off still see it. Classification ignores `enabled`: default-off
 * filters (hut, shelter) must be in the tiles too.
 */
export function layerFor(tags: OsmTags, kind: OsmElementKind): Layer | null {
  if (classifyElement(tags, kind, NON_PARKING) !== null) return 'rest'
  if (classifyElement(tags, kind, PARKING_ONLY) !== null) return 'parking'
  return null
}

// ── Tags ────────────────────────────────────────────────────────────────────

const DROP_EXACT = new Set(['note', 'fixme', 'FIXME', 'created_by'])
const DROP_PREFIX = ['source', 'check_date']

/** Strip editor-only tags that are useless for display / AI summary. */
export function cleanTags(tags: Readonly<Record<string, unknown>>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(tags)) {
    if (typeof v !== 'string') continue
    if (DROP_EXACT.has(k)) continue
    if (DROP_PREFIX.some(p => k === p || k.startsWith(`${p}:`))) continue
    out[k] = v
  }
  return out
}

// ── Tiles ───────────────────────────────────────────────────────────────────

/** Tile key `floor(lat/cell)_floor(lon/cell)` — negative indices allowed. */
export function tileKey(lat: number, lon: number, cellDeg = CELL_DEG): string {
  return `${Math.floor(lat / cellDeg)}_${Math.floor(lon / cellDeg)}`
}

const TYPE_LETTER: Record<string, TileType> = { n: 'n', w: 'w', r: 'r' }
const KIND_OF: Record<TileType, OsmElementKind> = { n: 'node', w: 'way', r: 'relation' }

/**
 * Parse osmium's `--add-unique-id=type_id` value. Nodes/linestrings come as
 * `n123`/`w45`; areas as `a<areaId>` with areaId = 2·wayId (closed way) or
 * 2·relId+1 (multipolygon relation).
 */
export function parseUniqueId(uid: unknown): { t: TileType; id: number } | null {
  if (typeof uid !== 'string') return null
  const prefix = uid[0] ?? ''
  const num = Number(uid.slice(1))
  if (!/^\d+$/.test(uid.slice(1)) || !Number.isSafeInteger(num) || num <= 0) return null
  if (prefix === 'a') return num % 2 === 0 ? { t: 'w', id: num / 2 } : { t: 'r', id: (num - 1) / 2 }
  const t = TYPE_LETTER[prefix]
  return t ? { t, id: num } : null
}

export interface Feature {
  readonly id?: unknown
  readonly properties?: Readonly<Record<string, unknown>> | null
  readonly geometry?: Geometry | null
}

export interface Placed {
  readonly layer: Layer
  readonly key: string
  readonly poi: TilePoi
}

/** One geojsonseq feature → its layer, tile key and compact record (or null to skip). */
export function placeFeature(feature: Feature): Placed | null {
  const uid = parseUniqueId(feature.id)
  if (!uid || !feature.geometry) return null
  const rawTags = feature.properties ?? {}
  const tags = cleanTags(rawTags)
  // Classify on the raw tags (cleaning only drops editor noise, but stay exact).
  const layer = layerFor(rawTags as OsmTags, KIND_OF[uid.t])
  if (!layer) return null
  const c = bboxCenter(feature.geometry)
  if (!c) return null
  return { layer, key: tileKey(c.lat, c.lon), poi: [uid.t, uid.id, c.lat, c.lon, tags] }
}

export function buildManifest(
  version: string,
  tiles: Readonly<Record<Layer, Iterable<string>>>,
  counts: Readonly<Record<Layer, number>>,
): Manifest {
  return {
    version,
    date: version.slice(0, 10),
    cellDeg: CELL_DEG,
    tiles: {
      parking: [...tiles.parking].sort(),
      rest: [...tiles.rest].sort(),
    },
    counts: { parking: counts.parking, rest: counts.rest },
    attribution: ATTRIBUTION,
    notes: 'Aus Geofabrik-Extrakten via osmium export. Relationen ohne Multipolygon-Geometrie '
      + '(z. B. viele sport=climbing-Sites) fehlen.',
  }
}

/**
 * Layers below their minimum POI count. A broken filter step (e.g. a mangled
 * osmium expression) still yields a valid-looking build — the client would then
 * show no built-in POIs and never fall back to Overpass, so CI must fail instead.
 */
export function belowMinimum(
  counts: Readonly<Record<Layer, number>>,
  min: Readonly<Partial<Record<Layer, number>>>,
): Layer[] {
  return LAYERS.filter(l => counts[l] < (min[l] ?? 0))
}
