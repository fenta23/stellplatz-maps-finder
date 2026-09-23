import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Must mock before importing nearbyHandler because its dependency
// _shared/utils.ts uses Deno.env and npm: imports which don't resolve in Node.
vi.mock('../_shared/utils.ts', () => {
  const jsonResponse = (data: unknown, status = 200, _origin: string | null = null) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
  const errorResponse = (msg: string, status = 400, _origin: string | null = null) =>
    new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json' } })
  const parseLatLon = (latRaw: unknown, lonRaw: unknown) => {
    if (typeof latRaw !== 'string' || typeof lonRaw !== 'string') return null
    const lat = Number(latRaw)
    const lon = Number(lonRaw)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
    return { lat, lon }
  }
  const haversineMeters = (lat1: number, lon1: number, lat2: number, lon2: number) =>
    Math.hypot(lat2 - lat1, lon2 - lon1) * 111_000
  return {
    jsonResponse,
    errorResponse,
    parseLatLon,
    haversineMeters,
    USER_AGENT: 'test/1.0',
    OVERPASS_ENDPOINTS: ['https://a.example/api/interpreter', 'https://b.example/api/interpreter'],
  }
})

import { handleNearby } from './nearbyHandler.ts'

const OVERPASS_RESPONSE = {
  elements: [
    { id: 1, lat: 48.101, lon: 11.501, tags: { amenity: 'fuel', name: 'Shell' } },
  ],
}

function buildRequest(params: Record<string, string> = {}): Request {
  const qs = new URLSearchParams(params).toString()
  return new Request(`https://example.com/api/nearby${qs ? '?' + qs : ''}`)
}

function mockOverpassResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('handleNearby', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns 400 when lat/lon are missing', async () => {
    const res = await handleNearby(buildRequest(), null)
    expect(res.status).toBe(400)
  })

  it('returns nearby POIs for valid coordinates', async () => {
    vi.mocked(fetch).mockResolvedValue(mockOverpassResponse(OVERPASS_RESPONSE))

    const res = await handleNearby(buildRequest({ lat: '48.1', lon: '11.5' }), null)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual([
      expect.objectContaining({ kind: 'fuel', name: 'Shell' }),
    ])
  })

  // Regression: the first configured mirror can reject this specific query
  // (e.g. 403) while still being healthy overall — handleNearby used to call
  // OVERPASS_ENDPOINTS[0] directly with no fallback, so a single mirror
  // rejection took the whole endpoint down instead of trying the next mirror.
  it('falls back to the next mirror when the first rejects the request', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('Forbidden', { status: 403 }))
      .mockResolvedValueOnce(mockOverpassResponse(OVERPASS_RESPONSE))

    const res = await handleNearby(buildRequest({ lat: '48.1', lon: '11.5' }), null)

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual([
      expect.objectContaining({ kind: 'fuel', name: 'Shell' }),
    ])
  })

  it('returns 503 when every mirror fails', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('Forbidden', { status: 403 }))

    const res = await handleNearby(buildRequest({ lat: '48.1', lon: '11.5' }), null)

    expect(res.status).toBe(503)
  })

  it('returns 503 when every mirror throws', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'))

    const res = await handleNearby(buildRequest({ lat: '48.1', lon: '11.5' }), null)

    expect(res.status).toBe(503)
  })
})
