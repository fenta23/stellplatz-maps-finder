// Pure building blocks for the static POI tiles (see build.ts). No I/O here so
// everything is unit-testable; the filter definitions come straight from the
// client so there is exactly one source of truth for "what is a camper spot".

import {
  classifyElement, DEFAULT_FILTERS, TILE_LAYER_IDS, tileLayerOf,
  type FilterDef, type OsmElementKind, type TileLayerId,
} from '../../src/client/features/filters/filterModel.js'
import type { OsmTags } from '../../src/client/features/pois/OverpassClient.js'

export const CELL_DEG = 0.25
export const PARKING_FILTER_ID = 'parking'
export const ATTRIBUTION = '© OpenStreetMap-Mitwirkende, ODbL'

export type Layer = TileLayerId
export const LAYERS: readonly Layer[] = TILE_LAYER_IDS

/** Compact on-disk POI: [type, id, lat, lon, tags] with type n/w/r. */
export type TileType = 'n' | 'w' | 'r'
export type TilePoi = readonly [TileType, number, number, number, Readonly<Record<string, string>>]

export interface Manifest {
  readonly version: string
  readonly date: string
  readonly cellDeg: number
  /**
   * Non-empty tile keys per layer — anything not listed is empty (no request).
   * `parking` and `rest` keep their original meaning (old clients read only these two).
   */
  readonly tiles: Readonly<Record<Layer, readonly string[]>>
  /** POIs per layer — for the data repo's STAND.md and sanity checks. */
  readonly counts: Readonly<Record<Layer, number>>
  /**
   * Built-in filter ids contained in each layer. Lets a client tell whether the
   * deployed tiles know a filter at all (a build from before a filter existed
   * lacks it) and otherwise fall back to Overpass.
   */
  readonly filters: Readonly<Record<Layer, readonly string[]>>
  readonly attribution: string
  readonly notes: string
}

// ── osmium tags-filter expressions ──────────────────────────────────────────

const KIND_LETTER: Record<OsmElementKind, string> = { node: 'n', way: 'w', relation: 'r' }

/**
 * Coarse pre-filter for `osmium tags-filter`: one expression per (element kinds, key)
 * built from each selector's first positive condition, e.g. `nw/amenity=parking,water_point`.
 * Negations / secondary conditions (motorhome, shelter_type, access, food) are left to
 * classifyElement afterwards — the pre-filter only has to be a superset. That is also why
 * `natural=spring` and `man_made=water_tap` pre-filter ALL springs / taps: the
 * `drinking_water=yes` condition is applied later by classifyElement.
 *
 * A key-only selector (value '') in a group makes the whole group key-only, because
 * `k` is a superset of `k=a,b` — emitting just the valued part would drop elements.
 */
export function osmiumExpressions(filters: readonly FilterDef[]): string[] {
  const groups = new Map<string, { keyOnly: boolean; values: Set<string> }>() // "nw/amenity"
  for (const f of filters) {
    if (f.kind !== 'osm') continue
    for (const sel of f.selectors) {
      const primary = sel.tags.find(c => !c.negate)
      if (!primary) continue
      const kinds = (['node', 'way', 'relation'] as const)
        .filter(k => sel.elements.includes(k)).map(k => KIND_LETTER[k]).join('')
      const groupKey = `${kinds}/${primary.key}`
      const g = groups.get(groupKey) ?? { keyOnly: false, values: new Set<string>() }
      if (primary.value === '') g.keyOnly = true
      else g.values.add(primary.value)
      groups.set(groupKey, g)
    }
  }
  return [...groups].map(([k, g]) => g.keyOnly || g.values.size === 0 ? k : `${k}=${[...g.values].join(',')}`)
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

// ── Classification → layers ────────────────────────────────────────────────

const OSM_FILTERS = DEFAULT_FILTERS.filter(f => f.kind === 'osm')

/** Built-in OSM filters per layer, in DEFAULT_FILTERS order. */
const GROUPS: Readonly<Record<Layer, readonly FilterDef[]>> = Object.fromEntries(
  LAYERS.map(l => [l, OSM_FILTERS.filter(f => tileLayerOf(f.id) === l)]),
) as Record<Layer, readonly FilterDef[]>

/** Filter ids per layer, for the manifest. */
export const LAYER_FILTERS: Readonly<Record<Layer, readonly string[]>> = Object.fromEntries(
  LAYERS.map(l => [l, GROUPS[l].map(f => f.id)]),
) as Record<Layer, readonly string[]>

/**
 * Every layer a raw OSM element belongs to (empty if no built-in filter wants it).
 * An element is written to EVERY layer whose group claims it: a hotel that is also
 * tagged restaurant lands in `lodging` and `food`, otherwise it would be missing
 * when only one of the two layers is loaded (the client de-duplicates by OSM id).
 *
 * Special rule (unchanged from the two-layer days): an element claimed by the `rest`
 * group is not written to `parking`, so e.g. amenity=parking + tourism=camp_site shows
 * with the parking filter off. A plain parking that is ALSO claimed by one of the new
 * layers (e.g. amenity=parking + amenity=toilets) is written to `parking` AND that
 * layer: it stays reachable with only the parking filter on and with only the other
 * filter on. Classification ignores `enabled`: default-off filters (hut, shelter) must
 * be in the tiles too.
 */
export function layersFor(tags: OsmTags, kind: OsmElementKind): Layer[] {
  const claimed = LAYERS.filter(l => GROUPS[l].length > 0 && classifyElement(tags, kind, GROUPS[l]) !== null)
  return claimed.includes('rest') ? claimed.filter(l => l !== 'parking') : claimed
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
  /** Non-empty: the element is written to each of these layers (same tile key). */
  readonly layers: readonly Layer[]
  readonly key: string
  readonly poi: TilePoi
}

/** One geojsonseq feature → its layers, tile key and compact record (or null to skip). */
export function placeFeature(feature: Feature): Placed | null {
  const uid = parseUniqueId(feature.id)
  if (!uid || !feature.geometry) return null
  const rawTags = feature.properties ?? {}
  const tags = cleanTags(rawTags)
  // Classify on the raw tags (cleaning only drops editor noise, but stay exact).
  const layers = layersFor(rawTags as OsmTags, KIND_OF[uid.t])
  if (layers.length === 0) return null
  const c = bboxCenter(feature.geometry)
  if (!c) return null
  return { layers, key: tileKey(c.lat, c.lon), poi: [uid.t, uid.id, c.lat, c.lon, tags] }
}

export function buildManifest(
  version: string,
  tiles: Readonly<Record<Layer, Iterable<string>>>,
  counts: Readonly<Record<Layer, number>>,
): Manifest {
  const sortedTiles = Object.fromEntries(LAYERS.map(l => [l, [...tiles[l]].sort()])) as Record<Layer, string[]>
  const layerCounts = Object.fromEntries(LAYERS.map(l => [l, counts[l]])) as Record<Layer, number>
  return {
    version,
    date: version.slice(0, 10),
    cellDeg: CELL_DEG,
    tiles: sortedTiles,
    counts: layerCounts,
    filters: LAYER_FILTERS,
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
