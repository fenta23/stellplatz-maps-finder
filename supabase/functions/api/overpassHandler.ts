import { jsonResponse, errorResponse, snapBboxInQuery, isValidPoiQuery, OVERPASS_ENDPOINTS, USER_AGENT, POI_CACHE_TTL_MS, getSupabase } from '../_shared/utils.ts'
import { rankEndpoints, recordSuccess, recordFailure, type StatStore } from '../_shared/overpassRanking.ts'

export async function handleOverpass(req: Request, origin: string | null): Promise<Response> {
  const bodyText = await req.text()
  const rawQuery = decodeURIComponent(bodyText.startsWith('data=') ? bodyText.slice(5) : bodyText)

  if (!isValidPoiQuery(rawQuery)) {
    return errorResponse('Unsupported query shape', 400, origin)
  }

  const snappedQuery = snapBboxInQuery(rawQuery)

  const supabase = await getSupabase()
  if (supabase) {
    const cached = await checkCache(supabase, snappedQuery)
    if (cached !== null) return jsonResponse(cached, 200, origin)
  }

  const body = 'data=' + encodeURIComponent(snappedQuery)
  const data = await fetchFromOverpass(body)

  if (!data) {
    return errorResponse('All Overpass endpoints unreachable', 503, origin)
  }

  if (supabase) await setCache(supabase, snappedQuery, data)
  return jsonResponse(data, 200, origin)
}

// ── Overpass fetch: race the healthiest endpoints, fall back through the rest ──

const OVERPASS_TIMEOUT_MS = 10_000
/** Race this many of the top-ranked endpoints in parallel; first success wins. */
const RACE_COUNT = 3

// Per-isolate, best-effort health stats. Warms up over a few requests and resets
// on a cold start — a soft ranking hint, not persisted (see overpassRanking.ts).
const stats: StatStore = new Map()

/** Single attempt; records latency on success and a failure on any error. */
async function fetchOne(url: string, body: string): Promise<unknown> {
  const start = Date.now()
  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
      body,
      signal: AbortSignal.timeout(OVERPASS_TIMEOUT_MS),
    })
    // 429 / 5xx are upstream trouble — treat as failure so the mirror is demoted.
    if (upstream.status === 429 || upstream.status >= 500) {
      console.error(`[overpass] ${url} -> ${upstream.status} after ${Date.now() - start}ms`)
      throw new Error(`Overpass ${upstream.status}`)
    }
    if (!upstream.ok) {
      console.error(`[overpass] ${url} -> ${upstream.status} ${upstream.statusText} after ${Date.now() - start}ms`)
      throw new Error(`Overpass error: ${upstream.statusText}`)
    }
    const json = await upstream.json() as unknown
    recordSuccess(stats, url, Date.now() - start)
    return json
  } catch (err) {
    if (err instanceof Error && !err.message.startsWith('Overpass')) {
      console.error(`[overpass] ${url} -> ${err.name}: ${err.message} after ${Date.now() - start}ms`)
    }
    recordFailure(stats, url, Date.now())
    throw err
  }
}

async function fetchFromOverpass(body: string): Promise<unknown | null> {
  const ranked = rankEndpoints(OVERPASS_ENDPOINTS, stats, Date.now())

  // Race the top RACE_COUNT in parallel — fastest healthy mirror wins.
  const racers = ranked.slice(0, RACE_COUNT)
  try {
    return await Promise.any(racers.map((url) => fetchOne(url, body)))
  } catch {
    // All racers failed; fall through to the remaining endpoints sequentially.
  }

  for (const url of ranked.slice(RACE_COUNT)) {
    try {
      return await fetchOne(url, body)
    } catch {
      continue
    }
  }

  return null
}

async function checkCache(
  supabase: NonNullable<Awaited<ReturnType<typeof getSupabase>>>,
  key: string,
): Promise<unknown | null> {
  try {
    const { data, error } = await supabase
      .from('poi_cache')
      .select('data, fetched_at')
      .eq('key', key)
      .single()

    if (error || !data) return null
    const ageMs = Date.now() - new Date(data.fetched_at as string).getTime()
    return ageMs <= POI_CACHE_TTL_MS ? (data.data as unknown) : null
  } catch {
    return null
  }
}

async function setCache(
  supabase: NonNullable<Awaited<ReturnType<typeof getSupabase>>>,
  key: string,
  data: unknown,
): Promise<void> {
  try {
    await supabase
      .from('poi_cache')
      .upsert({ key, data, fetched_at: new Date().toISOString() })
  } catch {
    // best-effort write
  }
}
