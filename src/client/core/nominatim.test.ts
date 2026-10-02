import { describe, it, expect, vi, afterEach } from 'vitest'
import { geocode } from './nominatim.js'

afterEach(() => vi.unstubAllGlobals())

function stubFetch(res: Partial<Response> | Error) {
  const fn = res instanceof Error ? vi.fn().mockRejectedValue(res) : vi.fn().mockResolvedValue(res)
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('geocode', () => {
  // Regression: /api/geocode proxied via Supabase got 403 from Nominatim
  // (cloud-IP block). The browser must call Nominatim directly.
  it('calls Nominatim directly, not the Supabase proxy', async () => {
    const fn = stubFetch({ ok: true, json: () => Promise.resolve([]) })
    await geocode('rochlitz')
    const url = String(fn.mock.calls[0]?.[0])
    expect(url.startsWith('https://nominatim.openstreetmap.org/search?')).toBe(true)
    expect(url).not.toContain('/api/geocode')
    expect(url).toContain('q=rochlitz')
    expect(url).toContain('format=json')
    expect(url).toContain('limit=6')
  })

  it('passes limit and viewbox in Nominatim order (west,north,east,south)', async () => {
    const fn = stubFetch({ ok: true, json: () => Promise.resolve([]) })
    await geocode('x', { limit: 1, viewbox: { south: 48, west: 11, north: 48.5, east: 11.5 } })
    const url = new URL(String(fn.mock.calls[0]?.[0]))
    expect(url.searchParams.get('limit')).toBe('1')
    expect(url.searchParams.get('viewbox')).toBe('11,48.5,11.5,48')
  })

  it('returns parsed results', async () => {
    const hits = [{ lat: '51.05', lon: '12.8', display_name: 'Rochlitz' }]
    stubFetch({ ok: true, json: () => Promise.resolve(hits) })
    expect(await geocode('rochlitz')).toEqual(hits)
  })

  it('returns [] on non-2xx', async () => {
    stubFetch({ ok: false, status: 403 })
    expect(await geocode('rochlitz')).toEqual([])
  })

  it('returns [] on network error', async () => {
    stubFetch(new TypeError('Failed to fetch'))
    expect(await geocode('rochlitz')).toEqual([])
  })

  it('returns [] when the body is not an array', async () => {
    stubFetch({ ok: true, json: () => Promise.resolve({ error: 'x' }) })
    expect(await geocode('rochlitz')).toEqual([])
  })
})
