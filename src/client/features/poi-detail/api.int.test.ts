import { describe, it, expect } from 'vitest'

const BASE = import.meta.env.VITE_API_BASE || 'http://localhost:54321/functions/v1'
const API = `${BASE}/api`

describe('api edge function', () => {
  it('health returns ok', async () => {
    const res = await fetch(`${API}/health`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  it('health includes CORS with known origin', async () => {
    const res = await fetch(`${API}/health`, {
      headers: { Origin: 'https://fenta23.github.io' },
    })
    expect(res.headers.get('access-control-allow-origin')).toBe('https://fenta23.github.io')
  })

  it('health blocks unknown origin', async () => {
    const res = await fetch(`${API}/health`, {
      headers: { Origin: 'https://evil.com' },
    })
    expect(res.headers.get('access-control-allow-origin')).toBe('null')
  })

  it('OPTIONS preflight returns 204', async () => {
    const res = await fetch(`${API}/health`, { method: 'OPTIONS' })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('rejects overpass with unsupported query', async () => {
    const res = await fetch(`${API}/overpass`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=invalid',
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Unsupported query shape' })
  })

  it('rejects overpass GET', async () => {
    const res = await fetch(`${API}/overpass`)
    expect(res.status).toBe(405)
    expect(await res.json()).toEqual({ error: 'Method not allowed' })
  })

  it('geocode rejects missing q', async () => {
    const res = await fetch(`${API}/geocode`)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'q is required' })
  })

  it('route rejects missing coordinates', async () => {
    const res = await fetch(`${API}/route`)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'from and to coordinates required (lat,lon)' })
  })

  it('nearby rejects missing coordinates', async () => {
    const res = await fetch(`${API}/nearby`)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'lat and lon required' })
  })

  // 503 = alle konfigurierten Overpass-Mirrors lehnen gerade ab (bekannte,
  // andauernde Außenwelt-Instabilität seit 2026-09-14, s. CHANGELOG) — das ist
  // kein Regressionssignal für diesen Endpoint, nur echtes 200 wird auf die
  // Datenform geprüft.
  it('nearby accepts valid coordinates', async () => {
    const res = await fetch(`${API}/nearby?lat=48.1&lon=11.5`)
    expect([200, 503]).toContain(res.status)
    if (res.status === 200) {
      const body = await res.json()
      expect(Array.isArray(body)).toBe(true)
    }
  })

  it('mapillary rejects missing coordinates', async () => {
    const res = await fetch(`${API}/mapillary`)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'lat and lon required' })
  })

  it('notes rejects missing coordinates', async () => {
    const res = await fetch(`${API}/notes`)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'lat and lon required' })
  })

  it('returns 404 for unknown path', async () => {
    const res = await fetch(`${API}/nonexistent`)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Not found' })
  })

  it('returns 404 for unknown root path', async () => {
    const res = await fetch(`${API}/`)
    expect(res.status).toBe(404)
  })
})
