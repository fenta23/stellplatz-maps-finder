import { fetchFromOverpassMirrors } from '@/core/overpassFetch.js'
import type { NearbyItem } from './PoiDetailPanel.js'

const SEARCH_RADIUS_M = 2000
const MAX_RESULTS = 15
const EARTH_RADIUS_M = 6_371_000

const KIND_LABELS: Record<string, string> = {
  fuel: 'Tankstelle',
  supermarket: 'Supermarkt',
  pharmacy: 'Apotheke',
  bakery: 'Bäckerei',
  water: 'Frischwasser',
  dump: 'Entsorgung',
}

type Tags = Record<string, string>

function classifyKind(tags: Tags): string | null {
  if (tags['amenity'] === 'fuel') return 'fuel'
  if (tags['shop'] === 'supermarket') return 'supermarket'
  if (tags['amenity'] === 'pharmacy') return 'pharmacy'
  if (tags['shop'] === 'bakery') return 'bakery'
  if (tags['amenity'] === 'water_point') return 'water'
  if (tags['amenity'] === 'sanitary_dump_station') return 'dump'
  return null
}

function buildNearbyQuery(lat: number, lon: number): string {
  const r = SEARCH_RADIUS_M
  const filters = [
    `node["amenity"="fuel"](around:${r},${lat},${lon})`,
    `way["amenity"="fuel"](around:${r},${lat},${lon})`,
    `node["shop"="supermarket"](around:${r},${lat},${lon})`,
    `way["shop"="supermarket"](around:${r},${lat},${lon})`,
    `node["amenity"="pharmacy"](around:${r},${lat},${lon})`,
    `node["shop"="bakery"](around:${r},${lat},${lon})`,
    `node["amenity"="water_point"](around:${r},${lat},${lon})`,
    `node["amenity"="sanitary_dump_station"](around:${r},${lat},${lon})`,
  ].join(';\n  ')
  return `[out:json][timeout:15];\n(\n  ${filters};\n);\nout center tags;`
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

type OverpassElement = {
  readonly id: number
  readonly lat?: number
  readonly lon?: number
  readonly center?: { readonly lat: number; readonly lon: number }
  readonly tags: Tags
}

type OverpassResult = { elements?: OverpassElement[] }

/** Nearby amenities (fuel, supermarket, …) around a point, sorted by distance. */
export async function fetchNearby(lat: number, lon: number): Promise<NearbyItem[]> {
  let data: OverpassResult
  try {
    data = await fetchFromOverpassMirrors(buildNearbyQuery(lat, lon)) as OverpassResult
  } catch {
    return []
  }

  const seen = new Set<number>()
  return (data.elements ?? [])
    .filter(el => !seen.has(el.id) && seen.add(el.id))
    .flatMap((el): NearbyItem[] => {
      const pos = el.lat !== undefined ? { lat: el.lat, lon: el.lon! } : el.center
      const kind = classifyKind(el.tags)
      if (!pos || !kind) return []
      const label = KIND_LABELS[kind] ?? kind
      return [{
        kind,
        name: el.tags['name'] ?? label,
        distance: Math.round(haversineMeters(lat, lon, pos.lat, pos.lon)),
        lat: pos.lat,
        lon: pos.lon,
      }]
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, MAX_RESULTS)
}
