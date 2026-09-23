export const BBOX_SNAP_DEG = 0.2
export const POI_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

// Cold-start priority order (healthiest-known first) — overpassHandler races all
// of these in parallel. At runtime overpassRanking.ts re-sorts them by observed
// latency and failures, so a slow/flapping mirror is demoted automatically.
//
// kumi.systems and openstreetmap.ru were dropped 2026-09-23: both were fully
// unreachable (connection timeout, 0/3 probes) from multiple networks, just
// burning the per-attempt timeout budget with no chance of success. See
// CHANGELOG for the underlying Overpass outage this was tuned around.
export const OVERPASS_ENDPOINTS = [
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://osm.hpi.de/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
] as const

export const USER_AGENT = 'stellplatz-maps-finder/0.1 (https://github.com/local/stellplatz)'

// ── CORS ───────────────────────────────────────────────────────────────────────
// Allow exactly the origins that serve our app + optional extras.
// Falls back to * only when no origin header is set (curl, server-to-server).

const ALLOWED_ORIGINS: readonly string[] = (
  Deno.env.get('ALLOWED_ORIGINS') ?? ''
).split(',').map(s => s.trim()).filter(Boolean)

const APP_ORIGINS = [
  'https://camp-finder.de',
  'https://www.camp-finder.de',
  'https://fenta23.github.io',
  'capacitor://localhost',
  'http://localhost:5173',
  ...ALLOWED_ORIGINS,
]

export function corsHeaders(origin: string | null): Headers {
  const allowOrigin = !origin ? '*' :
    APP_ORIGINS.includes(origin) ? origin : 'null'

  return new Headers({
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  })
}

export function jsonResponse(data: unknown, status = 200, origin: string | null = null): Response {
  const headers = corsHeaders(origin)
  headers.set('Content-Type', 'application/json')
  return new Response(JSON.stringify(data), { status, headers })
}

export function errorResponse(msg: string, status = 400, origin: string | null = null): Response {
  return jsonResponse({ error: msg }, status, origin)
}

// ── Geo utilities ──────────────────────────────────────────────────────────────

const BBOX_RE = /\((-?\d+\.?\d*),(-?\d+\.?\d*),(-?\d+\.?\d*),(-?\d+\.?\d*)\)/g

const snapFloor = (v: string) =>
  (Math.floor(parseFloat(v) / BBOX_SNAP_DEG) * BBOX_SNAP_DEG).toFixed(2)

const snapCeil = (v: string) =>
  (Math.ceil(parseFloat(v) / BBOX_SNAP_DEG) * BBOX_SNAP_DEG).toFixed(2)

export function snapBboxInQuery(query: string): string {
  return query.replace(
    BBOX_RE,
    (_m, s, w, n, e) => `(${snapFloor(s)},${snapFloor(w)},${snapCeil(n)},${snapCeil(e)})`,
  )
}

export function parseLatLon(latRaw: unknown, lonRaw: unknown): { lat: number; lon: number } | null {
  const lat = toFiniteNumber(latRaw)
  const lon = toFiniteNumber(lonRaw)
  if (lat === null || lon === null) return null
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return { lat, lon }
}

function toFiniteNumber(raw: unknown): number | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

const EARTH_RADIUS_M = 6_371_000
const toRad = (deg: number) => (deg * Math.PI) / 180

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function decodeVarInt(encoded: string, startIndex: number): { value: number; nextIndex: number } {
  let result = 0
  let shift = 0
  let index = startIndex
  let b: number
  do {
    b = encoded.charCodeAt(index++) - 63
    result |= (b & 0x1f) << shift
    shift += 5
  } while (b >= 0x20)
  return { value: result & 1 ? ~(result >> 1) : result >> 1, nextIndex: index }
}

export function decodeValhallaPolyline(encoded: string): Array<[number, number]> {
  const coords: Array<[number, number]> = []
  let index = 0
  let lat = 0
  let lng = 0

  while (index < encoded.length) {
    const latResult = decodeVarInt(encoded, index)
    index = latResult.nextIndex
    lat += latResult.value

    const lngResult = decodeVarInt(encoded, index)
    index = lngResult.nextIndex
    lng += lngResult.value

    coords.push([lng / 1e6, lat / 1e6])
  }

  return coords
}

// ── Overpass query validation ──────────────────────────────────────────────────

const MAX_STATEMENTS = 40
const MAX_TIMEOUT_S = 30

const COORD = String.raw`-?\d+(?:\.\d+)?`
const BBOX = `\\(${COORD}(?:,${COORD}){3}\\)`
const TAG_FILTER = String.raw`\["[\w:-]+"(?:!?=)"[\w:-]+"\]`
const STATEMENT = `(?:node|way|relation)(?:${TAG_FILTER}){1,4}${BBOX};`
const QUERY_RE = new RegExp(
  `^\\[out:json\\](?:\\[timeout:(\\d{1,3})\\])?;\\((?:${STATEMENT})+\\);outcentertags;$`,
)

export function isValidPoiQuery(rawQuery: string): boolean {
  const compact = rawQuery.replace(/\s+/g, '')
  const m = QUERY_RE.exec(compact)
  if (!m) return false

  const timeout = m[1] ? Number(m[1]) : 0
  if (timeout > MAX_TIMEOUT_S) return false

  const statements = compact.match(/(?:node|way|relation)\[/g)?.length ?? 0
  return statements <= MAX_STATEMENTS
}

// ── Supabase client (lazy singleton) ──────────────────────────────────────────

let _supabase: ReturnType<typeof createSupabaseClient> | null = null

async function createSupabaseClient() {
  const { createClient } = await import('npm:@supabase/supabase-js')
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  return url && key ? createClient(url, key) : null
}

export async function getSupabase() {
  if (!_supabase) _supabase = await createSupabaseClient()
  return _supabase
}

// ── Rate limiting (Supabase-backed, best-effort) ────────────────────────────
// Uses the existing poi_cache table to track request counts per window.
// Race-condition-tolerant: a few extra requests may slip through, which is
// acceptable for a soft rate limit protecting external API tokens.

interface RateLimitConfig {
  maxRequests: number
  windowMs: number
}

const RATE_LIMITS: Record<string, RateLimitConfig> = {
  mapillary: { maxRequests: 20, windowMs: 60_000 },
  // LLM calls cost money/tokens — keep this tighter than the upstream proxies.
  ai: { maxRequests: 30, windowMs: 60_000 },
}

export async function checkRateLimit(
  supabase: NonNullable<Awaited<ReturnType<typeof getSupabase>>>,
  bucket: string,
  clientIp: string,
): Promise<{ allowed: boolean; retryAfterMs?: number }> {
  const config = RATE_LIMITS[bucket]
  if (!config) return { allowed: true }

  const key = `ratelimit:${bucket}:${clientIp}`
  const now = Date.now()

  try {
    const { data } = await supabase
      .from('poi_cache')
      .select('data')
      .eq('key', key)
      .single()

    if (data?.data) {
      const entry = data.data as { count: number; windowStart: number }
      if (now - entry.windowStart < config.windowMs) {
        if (entry.count >= config.maxRequests) {
          const retryAfterMs = config.windowMs - (now - entry.windowStart)
          return { allowed: false, retryAfterMs }
        }
        await supabase.from('poi_cache').upsert({
          key,
          data: { count: entry.count + 1, windowStart: entry.windowStart },
          fetched_at: new Date().toISOString(),
        })
      } else {
        await supabase.from('poi_cache').upsert({
          key,
          data: { count: 1, windowStart: now },
          fetched_at: new Date().toISOString(),
        })
      }
    } else {
      await supabase.from('poi_cache').upsert({
        key,
        data: { count: 1, windowStart: now },
        fetched_at: new Date().toISOString(),
      })
    }
    return { allowed: true }
  } catch {
    return { allowed: true }
  }
}
