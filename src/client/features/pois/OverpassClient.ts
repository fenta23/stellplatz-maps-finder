import { notNullUndefined } from '@shared/common.js'
import { fetchFromOverpassMirrors } from '@/core/overpassFetch.js'
import { buildOverpassQuery, classifyElement, type FilterDef } from '@/features/filters/filterModel.js'

/**
 * A POI's group identity = a filter id. Built-in ids ('parking', 'camper', …)
 * stay stable; user-defined filters use uuids. Kept as a string alias so the
 * favorites/notes snapshots and the detail panel keep compiling.
 */
export type PoiType = string

export interface LatLngBounds {
  readonly south: number
  readonly west: number
  readonly north: number
  readonly east: number
}

export interface OsmTags {
  readonly name?: string
  readonly opening_hours?: string
  readonly phone?: string
  readonly website?: string
  readonly fee?: string
  readonly capacity?: string
  readonly operator?: string
  readonly description?: string
  readonly motorhome?: string
  readonly tourism?: string
  readonly amenity?: string
  readonly sport?: string
  readonly [key: string]: string | undefined
}

export interface OsmElement {
  readonly type: 'node' | 'way' | 'relation'
  readonly id: number
  readonly lat?: number
  readonly lon?: number
  readonly center?: { readonly lat: number; readonly lon: number }
  readonly tags: OsmTags
}

export interface OsmPoi {
  readonly id: number
  readonly type: PoiType
  readonly lat: number
  readonly lon: number
  readonly tags: OsmTags
}

/** Build the Overpass query from the given filter definitions (data-driven). */
export function buildQuery(bounds: LatLngBounds, filters: readonly FilterDef[]): string {
  return buildOverpassQuery(bounds, filters)
}

// OSM access values that mark parking as restricted. Everything else —
// yes/public/permissive/customers or no access tag — counts as public.
const PRIVATE_ACCESS_VALUES = new Set(['private', 'no'])

/** True only for parking POIs whose `access` tag is `private` or `no`. */
export function isPrivateParking(poi: OsmPoi): boolean {
  if (poi.type !== 'parking') return false
  const access = poi.tags['access']
  return access !== undefined && PRIVATE_ACCESS_VALUES.has(access)
}

function elementToLatLon(el: OsmElement): { lat: number; lon: number } | null {
  if (el.lat !== undefined && el.lon !== undefined) {
    return { lat: el.lat, lon: el.lon }
  }
  if (el.center) {
    return { lat: el.center.lat, lon: el.center.lon }
  }
  return null
}

function parseElements(data: { elements?: OsmElement[] }, filters: readonly FilterDef[]): readonly OsmPoi[] {
  const seen = new Set<number>()
  return (data.elements ?? [])
    .filter(el => !seen.has(el.id) && seen.add(el.id))
    .map((el): OsmPoi | null => {
      const pos = elementToLatLon(el)
      if (!pos) return null
      // Classify against the same filters that built the query; first match wins.
      const type = classifyElement(el.tags, el.type, filters)
      if (type === null) return null
      return { id: el.id, type, lat: pos.lat, lon: pos.lon, tags: el.tags }
    })
    .filter(notNullUndefined)
}

export async function fetchPois(
  bounds: LatLngBounds,
  filters: readonly FilterDef[],
  signal?: AbortSignal,
): Promise<readonly OsmPoi[]> {
  if (!filters.some(f => f.kind === 'osm' && f.selectors.length > 0)) return []

  const query = buildQuery(bounds, filters)
  const data = await fetchFromOverpassMirrors(query, signal) as { elements?: OsmElement[] }
  return parseElements(data, filters)
}
