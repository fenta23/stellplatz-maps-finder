import { jsonResponse, errorResponse, parseLatLon, haversineMeters, OVERPASS_ENDPOINTS, USER_AGENT } from '../_shared/utils.ts'

const SEARCH_RADIUS_M = 2000
const MAX_RESULTS = 15

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

type OverpassElement = {
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags: Tags
}

type OverpassResult = { elements?: OverpassElement[] }

/**
 * Sequential fallback across all configured mirrors — a single mirror can
 * reject a specific request pattern (e.g. 403) even while it's healthy for
 * other endpoints, so unlike a hard failure this isn't worth racing/ranking.
 */
async function fetchFromOverpass(body: string): Promise<OverpassResult | null> {
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const upstream = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
        body,
        signal: AbortSignal.timeout(12_000),
      })
      if (!upstream.ok) continue
      return await upstream.json() as OverpassResult
    } catch {
      continue
    }
  }
  return null
}

export async function handleNearby(req: Request, origin: string | null): Promise<Response> {
  const url = new URL(req.url)
  const coords = parseLatLon(url.searchParams.get('lat'), url.searchParams.get('lon'))
  if (!coords) return errorResponse('lat and lon required', 400, origin)

  const { lat, lon } = coords
  const body = `data=${encodeURIComponent(buildNearbyQuery(lat, lon))}`

  const data = await fetchFromOverpass(body)
  if (!data) return errorResponse('Overpass unreachable', 503, origin)

  const seen = new Set<number>()
  const items = (data.elements ?? [])
    .filter(el => !seen.has(el.id) && seen.add(el.id))
    .flatMap(el => {
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

  return jsonResponse(items, 200, origin)
}
