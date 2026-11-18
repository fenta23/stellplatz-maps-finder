import { describe, expect, it, vi } from 'vitest'
import {
  MAX_SNAP_M,
  ROUTE_PLANNING_ENABLED,
  buildRouteUrl,
  fetchPlannedRoute,
  plannedRouteName,
  type RouteRequest,
} from './osrmRoute.js'

const REQ: RouteRequest = {
  start: { lat: 51.0504, lon: 13.7373, label: 'Dresden' },
  end: { lat: 50.9588, lon: 13.9366, label: 'Pirna' },
  mode: 'bike',
}

function okBody(over: Record<string, unknown> = {}) {
  return {
    code: 'Ok',
    routes: [
      {
        distance: 18_432.5,
        duration: 3000,
        geometry: {
          type: 'LineString',
          coordinates: [
            [13.7373, 51.0504],
            [13.85, 51.0],
            [13.9366, 50.9588],
          ],
        },
      },
    ],
    waypoints: [
      { name: 'Wilsdruffer Straße', distance: 12 },
      { name: '', distance: 30 },
    ],
    ...over,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
}

function stub(res: Response | (() => Promise<Response>)) {
  return vi.fn<typeof fetch>(async () => (typeof res === 'function' ? res() : res))
}

function kindOf(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => undefined,
    (e) => (e as { kind?: string }).kind ?? e,
  )
}

describe('buildRouteUrl', () => {
  it.each(['foot', 'bike', 'car'] as const)('uses the %s instance with the driving path and lon,lat order', (mode) => {
    expect(buildRouteUrl({ ...REQ, mode })).toBe(
      `https://routing.openstreetmap.de/routed-${mode}/route/v1/driving/13.7373,51.0504;13.9366,50.9588?overview=full&geometries=geojson`,
    )
  })
})

describe('plannedRouteName', () => {
  it('formats start → end (mode)', () => {
    expect(plannedRouteName('Dresden', 'Pirna', 'bike')).toBe('Dresden → Pirna (Rad)')
    expect(plannedRouteName('A', 'B', 'foot')).toBe('A → B (Fuß)')
    expect(plannedRouteName('A', 'B', 'car')).toBe('A → B (Auto)')
  })
})

describe('fetchPlannedRoute', () => {
  it('has the kill switch on by default and a snap limit of 2000 m', () => {
    expect(ROUTE_PLANNING_ENABLED).toBe(true)
    expect(MAX_SNAP_M).toBe(2000)
  })

  it('returns a planned track with [lat, lon] points and a name from the labels', async () => {
    const f = stub(jsonResponse(okBody()))
    const track = await fetchPlannedRoute(REQ, f)
    expect(track.source).toBe('planned')
    expect(track.name).toBe('Dresden → Pirna (Rad)')
    expect(track.points).toEqual([
      [51.0504, 13.7373],
      [51.0, 13.85],
      [50.9588, 13.9366],
    ])
  })

  it('requests the built URL with credentials omit, no headers and no referrerPolicy', async () => {
    const f = stub(jsonResponse(okBody()))
    await fetchPlannedRoute(REQ, f)
    expect(f).toHaveBeenCalledTimes(1)
    const [url, init] = f.mock.calls[0]!
    expect(url).toBe(buildRouteUrl(REQ))
    expect(init?.credentials).toBe('omit')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    expect(init).not.toHaveProperty('referrerPolicy')
    expect(init).not.toHaveProperty('headers')
  })

  describe('names without a label', () => {
    const bare: RouteRequest = { ...REQ, start: { lat: REQ.start.lat, lon: REQ.start.lon }, end: { lat: REQ.end.lat, lon: REQ.end.lon } }

    it('takes the waypoint name, falls back to "Kartenpunkt" when it is empty', async () => {
      const track = await fetchPlannedRoute(bare, stub(jsonResponse(okBody())))
      expect(track.name).toBe('Wilsdruffer Straße → Kartenpunkt (Rad)')
    })

    it('falls back to "Kartenpunkt" without waypoints', async () => {
      const track = await fetchPlannedRoute(bare, stub(jsonResponse(okBody({ waypoints: undefined }))))
      expect(track.name).toBe('Kartenpunkt → Kartenpunkt (Rad)')
    })

    it('treats a blank label like a missing one', async () => {
      const req: RouteRequest = { ...REQ, start: { ...REQ.start, label: '   ' } }
      const track = await fetchPlannedRoute(req, stub(jsonResponse(okBody())))
      expect(track.name).toBe('Wilsdruffer Straße → Pirna (Rad)')
    })

    it('prefers the label over the waypoint name', async () => {
      const track = await fetchPlannedRoute(REQ, stub(jsonResponse(okBody())))
      expect(track.name).toBe('Dresden → Pirna (Rad)')
    })
  })

  describe('without a network request', () => {
    it('route-disabled when the kill switch is off', async () => {
      const f = stub(jsonResponse(okBody()))
      expect(await kindOf(fetchPlannedRoute(REQ, f, undefined, { enabled: false }))).toBe('route-disabled')
      expect(f).not.toHaveBeenCalled()
    })

    it('route-same-point below 20 m straight line', async () => {
      const f = stub(jsonResponse(okBody()))
      const req: RouteRequest = { ...REQ, end: { lat: REQ.start.lat + 0.00015, lon: REQ.start.lon } } // ~17 m
      expect(await kindOf(fetchPlannedRoute(req, f))).toBe('route-same-point')
      expect(f).not.toHaveBeenCalled()
    })

    it('route-same-point for identical points', async () => {
      const f = stub(jsonResponse(okBody()))
      expect(await kindOf(fetchPlannedRoute({ ...REQ, end: REQ.start }, f))).toBe('route-same-point')
      expect(f).not.toHaveBeenCalled()
    })

    it('goes on at 25 m straight line', async () => {
      const f = stub(jsonResponse(okBody()))
      const req: RouteRequest = { ...REQ, end: { lat: REQ.start.lat + 0.00023, lon: REQ.start.lon } } // ~25.6 m
      await fetchPlannedRoute(req, f)
      expect(f).toHaveBeenCalledTimes(1)
    })

    it('track-too-long above 1000 km straight line', async () => {
      const f = stub(jsonResponse(okBody()))
      const req: RouteRequest = { ...REQ, end: { lat: 40.4168, lon: -3.7038, label: 'Madrid' }, start: { lat: 60.1699, lon: 24.9384, label: 'Helsinki' } }
      expect(await kindOf(fetchPlannedRoute(req, f))).toBe('track-too-long')
      expect(f).not.toHaveBeenCalled()
    })
  })

  describe('error mapping', () => {
    it('route-busy on HTTP 429', async () => {
      expect(await kindOf(fetchPlannedRoute(REQ, stub(jsonResponse('', 429))))).toBe('route-busy')
    })

    it('route-not-found on HTTP 400 with code NoRoute', async () => {
      const f = stub(jsonResponse({ code: 'NoRoute', message: 'Impossible route between points' }, 400))
      expect(await kindOf(fetchPlannedRoute(REQ, f))).toBe('route-not-found')
    })

    it('route-not-found on code NoRoute with HTTP 200', async () => {
      expect(await kindOf(fetchPlannedRoute(REQ, stub(jsonResponse({ code: 'NoRoute' }))))).toBe('route-not-found')
    })

    it('route-not-found on Ok with empty or missing routes', async () => {
      expect(await kindOf(fetchPlannedRoute(REQ, stub(jsonResponse(okBody({ routes: [] })))))).toBe('route-not-found')
      expect(await kindOf(fetchPlannedRoute(REQ, stub(jsonResponse({ code: 'Ok' }))))).toBe('route-not-found')
    })

    it('route-no-road on code NoSegment (HTTP 400)', async () => {
      const f = stub(jsonResponse({ code: 'NoSegment', message: 'Could not find a matching segment' }, 400))
      expect(await kindOf(fetchPlannedRoute(REQ, f))).toBe('route-no-road')
    })

    it('route-no-road when a waypoint snapped further than MAX_SNAP_M', async () => {
      const far = okBody({ waypoints: [{ name: 'x', distance: 10 }, { name: 'y', distance: MAX_SNAP_M + 1 }] })
      expect(await kindOf(fetchPlannedRoute(REQ, stub(jsonResponse(far))))).toBe('route-no-road')
    })

    it('accepts a waypoint exactly at MAX_SNAP_M', async () => {
      const edge = okBody({ waypoints: [{ name: 'x', distance: MAX_SNAP_M }, { name: 'y', distance: 0 }] })
      expect((await fetchPlannedRoute(REQ, stub(jsonResponse(edge)))).source).toBe('planned')
    })

    it('route-unreachable on HTTP 5xx', async () => {
      expect(await kindOf(fetchPlannedRoute(REQ, stub(jsonResponse('oops', 503))))).toBe('route-unreachable')
      expect(await kindOf(fetchPlannedRoute(REQ, stub(jsonResponse({ code: 'NoRoute' }, 500))))).toBe('route-unreachable')
    })

    it('route-unreachable on other OSRM codes (e.g. InvalidValue)', async () => {
      const f = stub(jsonResponse({ code: 'InvalidValue', message: 'bad' }, 400))
      expect(await kindOf(fetchPlannedRoute(REQ, f))).toBe('route-unreachable')
    })

    it('route-unreachable on a network error', async () => {
      const f = stub(() => Promise.reject(new TypeError('Failed to fetch')))
      expect(await kindOf(fetchPlannedRoute(REQ, f))).toBe('route-unreachable')
    })

    it('route-unreachable when the body is not JSON', async () => {
      expect(await kindOf(fetchPlannedRoute(REQ, stub(jsonResponse('<html>')))) ).toBe('route-unreachable')
      expect(await kindOf(fetchPlannedRoute(REQ, stub(jsonResponse('<html>', 400))))).toBe('route-unreachable')
    })

    it('route-unreachable when the geometry is missing', async () => {
      const body = okBody({ routes: [{ distance: 1000 }] })
      expect(await kindOf(fetchPlannedRoute(REQ, stub(jsonResponse(body))))).toBe('route-unreachable')
    })

    it('route-same-point when the route is shorter than 10 m', async () => {
      const body = okBody({ routes: [{ distance: 9, geometry: { coordinates: [[13.7373, 51.0504], [13.7374, 51.0504]] } }] })
      expect(await kindOf(fetchPlannedRoute(REQ, stub(jsonResponse(body))))).toBe('route-same-point')
    })

    it('route-same-point with fewer than two valid points', async () => {
      const one = okBody({ routes: [{ distance: 500, geometry: { coordinates: [[13.7, 51.0]] } }] })
      expect(await kindOf(fetchPlannedRoute(REQ, stub(jsonResponse(one))))).toBe('route-same-point')
      const broken = okBody({ routes: [{ distance: 500, geometry: { coordinates: [[13.7, 51.0], ['x', 1], [999, 1]] } }] })
      expect(await kindOf(fetchPlannedRoute(REQ, stub(jsonResponse(broken))))).toBe('route-same-point')
    })

    it('track-too-long when the route distance exceeds the limit', async () => {
      const body = okBody({ routes: [{ distance: 1_000_001, geometry: { coordinates: [[13.7, 51.0], [13.8, 51.1]] } }] })
      expect(await kindOf(fetchPlannedRoute(REQ, stub(jsonResponse(body))))).toBe('track-too-long')
    })

    it('skips invalid coordinates but keeps the valid ones', async () => {
      const body = okBody({ routes: [{ distance: 500, geometry: { coordinates: [[13.7, 51.0], [null, 1], [13.8, 51.1]] } }] })
      const track = await fetchPlannedRoute(REQ, stub(jsonResponse(body)))
      expect(track.points).toEqual([[51.0, 13.7], [51.1, 13.8]])
    })
  })

  describe('timeout and abort', () => {
    it('maps a timeout to route-unreachable', async () => {
      const f = vi.fn<typeof fetch>(
        (_url, init) =>
          new Promise((_res, rej) => {
            init?.signal?.addEventListener('abort', () => rej(init.signal?.reason))
          }),
      )
      expect(await kindOf(fetchPlannedRoute(REQ, f, undefined, { timeoutMs: 20 }))).toBe('route-unreachable')
    })

    it('rethrows the caller abort unchanged', async () => {
      const ctrl = new AbortController()
      const f = vi.fn<typeof fetch>(
        (_url, init) =>
          new Promise((_res, rej) => {
            init?.signal?.addEventListener('abort', () => rej(init.signal?.reason))
          }),
      )
      const p = fetchPlannedRoute(REQ, f, ctrl.signal)
      ctrl.abort()
      const err = await p.catch((e: unknown) => e)
      expect((err as Error).name).toBe('AbortError')
      expect((err as { kind?: string }).kind).toBeUndefined()
    })

    it('rethrows an AbortError from fetch when the caller signal is aborted', async () => {
      const ctrl = new AbortController()
      ctrl.abort()
      const abortErr = new DOMException('aborted', 'AbortError')
      const f = stub(() => Promise.reject(abortErr))
      await expect(fetchPlannedRoute(REQ, f, ctrl.signal)).rejects.toBe(abortErr)
    })
  })
})
