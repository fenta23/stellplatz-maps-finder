import { describe, expect, it, vi } from 'vitest'
import {
  MAX_SNAP_M,
  ROUTE_PLANNING_ENABLED,
  buildRouteUrl,
  fetchPlannedRoute,
  plannedRouteName,
} from './osrmRoute.js'
import type { RoutePlan, RoutePoint } from './trackTypes.js'

/** Test-local shorthand; `toPlan` turns it into the plan the functions take. */
interface Req {
  readonly start: RoutePoint
  readonly end: RoutePoint
  readonly mode: RoutePlan['mode']
  readonly via?: readonly RoutePoint[]
}
const toPlan = (r: Req): RoutePlan => ({ mode: r.mode, waypoints: [r.start, ...(r.via ?? []), r.end] })

const REQ: Req = {
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
    expect(buildRouteUrl(toPlan({ ...REQ, mode }))).toBe(
      `https://routing.openstreetmap.de/routed-${mode}/route/v1/driving/13.7373,51.0504;13.9366,50.9588?overview=full&geometries=geojson`,
    )
  })
})

describe('fetchPlannedRoute: invalid plan', () => {
  it.each([0, 1])('a plan with %i point(s) is route-unreachable without a request', async (n) => {
    const f = stub(jsonResponse(okBody()))
    const plan: RoutePlan = { mode: 'bike', waypoints: [REQ.start, REQ.end].slice(0, n) }
    expect(await kindOf(fetchPlannedRoute(plan, f))).toBe('route-unreachable')
    expect(f).not.toHaveBeenCalled()
  })
})

describe('buildRouteUrl with via points', () => {
  it('puts the via points between start and end, in order', () => {
    const via = [{ lat: 51.02, lon: 13.8 }, { lat: 51.0, lon: 13.85, label: 'Heidenau' }]
    expect(buildRouteUrl(toPlan({ ...REQ, via }))).toBe(
      'https://routing.openstreetmap.de/routed-bike/route/v1/driving/13.7373,51.0504;13.8,51.02;13.85,51;13.9366,50.9588?overview=full&geometries=geojson',
    )
  })

  it('an empty via list gives the plain start;end URL', () => {
    expect(buildRouteUrl(toPlan({ ...REQ, via: [] }))).toBe(buildRouteUrl(toPlan(REQ)))
  })
})

describe('fetchPlannedRoute: plan and via points', () => {
  const VIA = { lat: 51.02, lon: 13.8 }
  const viaBody = (over: Record<string, unknown> = {}) => okBody({
    waypoints: [
      { name: 'Wilsdruffer Straße', distance: 12 },
      { name: 'Elberadweg', distance: 40, location: [13.8004, 51.0197] },
      { name: 'Am Markt', distance: 30 },
    ],
    ...over,
  })

  it('returns the plan: requested start/end with their labels, and the mode', async () => {
    const track = await fetchPlannedRoute(toPlan(REQ), stub(jsonResponse(okBody())))
    expect(track.plan).toEqual({
      mode: 'bike',
      waypoints: [
        { lat: 51.0504, lon: 13.7373, label: 'Dresden' },
        { lat: 50.9588, lon: 13.9366, label: 'Pirna' },
      ],
    })
  })

  it('labels unnamed ends with the road OSRM snapped to, so the name survives later edits', async () => {
    const req: Req = { start: { lat: 51.0504, lon: 13.7373 }, end: { lat: 50.9588, lon: 13.9366 }, mode: 'foot' }
    const track = await fetchPlannedRoute(toPlan(req), stub(jsonResponse(okBody())))
    expect(track.name).toBe('Wilsdruffer Straße → Kartenpunkt (Fuß)')
    expect(track.plan?.waypoints.map(w => w.label)).toEqual(['Wilsdruffer Straße', 'Kartenpunkt'])
  })

  it('requests the via points and keeps them in the plan where OSRM snapped them', async () => {
    const f = stub(jsonResponse(viaBody()))
    const track = await fetchPlannedRoute(toPlan({ ...REQ, via: [VIA] }), f)
    expect(f.mock.calls[0]![0]).toBe(buildRouteUrl(toPlan({ ...REQ, via: [VIA] })))
    expect(track.plan?.waypoints).toEqual([
      { lat: 51.0504, lon: 13.7373, label: 'Dresden' },
      { lat: 51.0197, lon: 13.8004 },
      { lat: 50.9588, lon: 13.9366, label: 'Pirna' },
    ])
  })

  it('keeps the requested via position when OSRM gives no usable location', async () => {
    const body = viaBody({ waypoints: [{ distance: 1 }, { distance: 1, location: ['x', 51] }, { distance: 1 }] })
    const track = await fetchPlannedRoute(toPlan({ ...REQ, via: [VIA] }), stub(jsonResponse(body)))
    expect(track.plan?.waypoints[1]).toEqual(VIA)
  })

  it('names the end after the LAST waypoint, not the second one', async () => {
    const req: Req = { start: REQ.start, end: { lat: 50.9588, lon: 13.9366 }, mode: 'bike', via: [VIA] }
    const track = await fetchPlannedRoute(toPlan(req), stub(jsonResponse(viaBody())))
    expect(track.name).toBe('Dresden → Am Markt (Rad)')
  })

  it('start = end is a round trip with a via point, but still route-same-point without one', async () => {
    const round: Req = { start: REQ.start, end: { ...REQ.start }, mode: 'bike' }
    const none = stub(jsonResponse(okBody()))
    expect(await kindOf(fetchPlannedRoute(toPlan(round), none))).toBe('route-same-point')
    expect(none).not.toHaveBeenCalled()

    const f = stub(jsonResponse(viaBody()))
    const track = await fetchPlannedRoute(toPlan({ ...round, via: [VIA] }), f)
    expect(f).toHaveBeenCalledTimes(1)
    expect(track.plan?.waypoints).toHaveLength(3)
  })

  it('adds up the legs for the length limit', async () => {
    // Start and end are 17 km apart, but the detour via the far point is over 1000 km.
    const f = stub(jsonResponse(viaBody()))
    expect(await kindOf(fetchPlannedRoute(toPlan({ ...REQ, via: [{ lat: 56.5, lon: 13.8 }] }), f))).toBe('track-too-long')
    expect(f).not.toHaveBeenCalled()
  })

  it('refuses more than 10 via points without asking the server', async () => {
    const f = stub(jsonResponse(viaBody()))
    const via = Array.from({ length: 11 }, (_, i) => ({ lat: 51 + i / 1000, lon: 13.8 }))
    expect(await kindOf(fetchPlannedRoute(toPlan({ ...REQ, via }), f))).toBe('route-too-many-vias')
    expect(f).not.toHaveBeenCalled()
    expect(await kindOf(fetchPlannedRoute(toPlan({ ...REQ, via: via.slice(0, 10) }), stub(jsonResponse(viaBody()))))).toBeUndefined()
  })

  it('route-no-road when a via point snapped further than MAX_SNAP_M', async () => {
    const body = viaBody({ waypoints: [{ distance: 1 }, { distance: MAX_SNAP_M + 1 }, { distance: 1 }] })
    expect(await kindOf(fetchPlannedRoute(toPlan({ ...REQ, via: [VIA] }), stub(jsonResponse(body))))).toBe('route-no-road')
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
    const track = await fetchPlannedRoute(toPlan(REQ), f)
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
    await fetchPlannedRoute(toPlan(REQ), f)
    expect(f).toHaveBeenCalledTimes(1)
    const [url, init] = f.mock.calls[0]!
    expect(url).toBe(buildRouteUrl(toPlan(REQ)))
    expect(init?.credentials).toBe('omit')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    expect(init).not.toHaveProperty('referrerPolicy')
    expect(init).not.toHaveProperty('headers')
  })

  describe('names without a label', () => {
    const bare: Req = { ...REQ, start: { lat: REQ.start.lat, lon: REQ.start.lon }, end: { lat: REQ.end.lat, lon: REQ.end.lon } }

    it('takes the waypoint name, falls back to "Kartenpunkt" when it is empty', async () => {
      const track = await fetchPlannedRoute(toPlan(bare), stub(jsonResponse(okBody())))
      expect(track.name).toBe('Wilsdruffer Straße → Kartenpunkt (Rad)')
    })

    it('falls back to "Kartenpunkt" without waypoints', async () => {
      const track = await fetchPlannedRoute(toPlan(bare), stub(jsonResponse(okBody({ waypoints: undefined }))))
      expect(track.name).toBe('Kartenpunkt → Kartenpunkt (Rad)')
    })

    it('treats a blank label like a missing one', async () => {
      const req: Req = { ...REQ, start: { ...REQ.start, label: '   ' } }
      const track = await fetchPlannedRoute(toPlan(req), stub(jsonResponse(okBody())))
      expect(track.name).toBe('Wilsdruffer Straße → Pirna (Rad)')
    })

    it('prefers the label over the waypoint name', async () => {
      const track = await fetchPlannedRoute(toPlan(REQ), stub(jsonResponse(okBody())))
      expect(track.name).toBe('Dresden → Pirna (Rad)')
    })
  })

  describe('without a network request', () => {
    it('route-disabled when the kill switch is off', async () => {
      const f = stub(jsonResponse(okBody()))
      expect(await kindOf(fetchPlannedRoute(toPlan(REQ), f, undefined, { enabled: false }))).toBe('route-disabled')
      expect(f).not.toHaveBeenCalled()
    })

    it('route-same-point below 20 m straight line', async () => {
      const f = stub(jsonResponse(okBody()))
      const req: Req = { ...REQ, end: { lat: REQ.start.lat + 0.00015, lon: REQ.start.lon } } // ~17 m
      expect(await kindOf(fetchPlannedRoute(toPlan(req), f))).toBe('route-same-point')
      expect(f).not.toHaveBeenCalled()
    })

    it('route-same-point for identical points', async () => {
      const f = stub(jsonResponse(okBody()))
      expect(await kindOf(fetchPlannedRoute(toPlan({ ...REQ, end: REQ.start }), f))).toBe('route-same-point')
      expect(f).not.toHaveBeenCalled()
    })

    it('goes on at 25 m straight line', async () => {
      const f = stub(jsonResponse(okBody()))
      const req: Req = { ...REQ, end: { lat: REQ.start.lat + 0.00023, lon: REQ.start.lon } } // ~25.6 m
      await fetchPlannedRoute(toPlan(req), f)
      expect(f).toHaveBeenCalledTimes(1)
    })

    it('track-too-long above 1000 km straight line', async () => {
      const f = stub(jsonResponse(okBody()))
      const req: Req = { ...REQ, end: { lat: 40.4168, lon: -3.7038, label: 'Madrid' }, start: { lat: 60.1699, lon: 24.9384, label: 'Helsinki' } }
      expect(await kindOf(fetchPlannedRoute(toPlan(req), f))).toBe('track-too-long')
      expect(f).not.toHaveBeenCalled()
    })
  })

  describe('error mapping', () => {
    it('route-busy on HTTP 429', async () => {
      expect(await kindOf(fetchPlannedRoute(toPlan(REQ), stub(jsonResponse('', 429))))).toBe('route-busy')
    })

    it('route-not-found on HTTP 400 with code NoRoute', async () => {
      const f = stub(jsonResponse({ code: 'NoRoute', message: 'Impossible route between points' }, 400))
      expect(await kindOf(fetchPlannedRoute(toPlan(REQ), f))).toBe('route-not-found')
    })

    it('route-not-found on code NoRoute with HTTP 200', async () => {
      expect(await kindOf(fetchPlannedRoute(toPlan(REQ), stub(jsonResponse({ code: 'NoRoute' }))))).toBe('route-not-found')
    })

    it('route-not-found on Ok with empty or missing routes', async () => {
      expect(await kindOf(fetchPlannedRoute(toPlan(REQ), stub(jsonResponse(okBody({ routes: [] })))))).toBe('route-not-found')
      expect(await kindOf(fetchPlannedRoute(toPlan(REQ), stub(jsonResponse({ code: 'Ok' }))))).toBe('route-not-found')
    })

    it('route-no-road on code NoSegment (HTTP 400)', async () => {
      const f = stub(jsonResponse({ code: 'NoSegment', message: 'Could not find a matching segment' }, 400))
      expect(await kindOf(fetchPlannedRoute(toPlan(REQ), f))).toBe('route-no-road')
    })

    it('route-no-road when a waypoint snapped further than MAX_SNAP_M', async () => {
      const far = okBody({ waypoints: [{ name: 'x', distance: 10 }, { name: 'y', distance: MAX_SNAP_M + 1 }] })
      expect(await kindOf(fetchPlannedRoute(toPlan(REQ), stub(jsonResponse(far))))).toBe('route-no-road')
    })

    it('accepts a waypoint exactly at MAX_SNAP_M', async () => {
      const edge = okBody({ waypoints: [{ name: 'x', distance: MAX_SNAP_M }, { name: 'y', distance: 0 }] })
      expect((await fetchPlannedRoute(toPlan(REQ), stub(jsonResponse(edge)))).source).toBe('planned')
    })

    it('route-unreachable on HTTP 5xx', async () => {
      expect(await kindOf(fetchPlannedRoute(toPlan(REQ), stub(jsonResponse('oops', 503))))).toBe('route-unreachable')
      expect(await kindOf(fetchPlannedRoute(toPlan(REQ), stub(jsonResponse({ code: 'NoRoute' }, 500))))).toBe('route-unreachable')
    })

    it('route-unreachable on other OSRM codes (e.g. InvalidValue)', async () => {
      const f = stub(jsonResponse({ code: 'InvalidValue', message: 'bad' }, 400))
      expect(await kindOf(fetchPlannedRoute(toPlan(REQ), f))).toBe('route-unreachable')
    })

    it('route-unreachable on a network error', async () => {
      const f = stub(() => Promise.reject(new TypeError('Failed to fetch')))
      expect(await kindOf(fetchPlannedRoute(toPlan(REQ), f))).toBe('route-unreachable')
    })

    it('route-unreachable when the body is not JSON', async () => {
      expect(await kindOf(fetchPlannedRoute(toPlan(REQ), stub(jsonResponse('<html>')))) ).toBe('route-unreachable')
      expect(await kindOf(fetchPlannedRoute(toPlan(REQ), stub(jsonResponse('<html>', 400))))).toBe('route-unreachable')
    })

    it('route-unreachable when the geometry is missing', async () => {
      const body = okBody({ routes: [{ distance: 1000 }] })
      expect(await kindOf(fetchPlannedRoute(toPlan(REQ), stub(jsonResponse(body))))).toBe('route-unreachable')
    })

    it('route-same-point when the route is shorter than 10 m', async () => {
      const body = okBody({ routes: [{ distance: 9, geometry: { coordinates: [[13.7373, 51.0504], [13.7374, 51.0504]] } }] })
      expect(await kindOf(fetchPlannedRoute(toPlan(REQ), stub(jsonResponse(body))))).toBe('route-same-point')
    })

    it('route-same-point with fewer than two valid points', async () => {
      const one = okBody({ routes: [{ distance: 500, geometry: { coordinates: [[13.7, 51.0]] } }] })
      expect(await kindOf(fetchPlannedRoute(toPlan(REQ), stub(jsonResponse(one))))).toBe('route-same-point')
      const broken = okBody({ routes: [{ distance: 500, geometry: { coordinates: [[13.7, 51.0], ['x', 1], [999, 1]] } }] })
      expect(await kindOf(fetchPlannedRoute(toPlan(REQ), stub(jsonResponse(broken))))).toBe('route-same-point')
    })

    it('track-too-long when the route distance exceeds the limit', async () => {
      const body = okBody({ routes: [{ distance: 1_000_001, geometry: { coordinates: [[13.7, 51.0], [13.8, 51.1]] } }] })
      expect(await kindOf(fetchPlannedRoute(toPlan(REQ), stub(jsonResponse(body))))).toBe('track-too-long')
    })

    it('skips invalid coordinates but keeps the valid ones', async () => {
      const body = okBody({ routes: [{ distance: 500, geometry: { coordinates: [[13.7, 51.0], [null, 1], [13.8, 51.1]] } }] })
      const track = await fetchPlannedRoute(toPlan(REQ), stub(jsonResponse(body)))
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
      expect(await kindOf(fetchPlannedRoute(toPlan(REQ), f, undefined, { timeoutMs: 20 }))).toBe('route-unreachable')
    })

    it('rethrows the caller abort unchanged', async () => {
      const ctrl = new AbortController()
      const f = vi.fn<typeof fetch>(
        (_url, init) =>
          new Promise((_res, rej) => {
            init?.signal?.addEventListener('abort', () => rej(init.signal?.reason))
          }),
      )
      const p = fetchPlannedRoute(toPlan(REQ), f, ctrl.signal)
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
      await expect(fetchPlannedRoute(toPlan(REQ), f, ctrl.signal)).rejects.toBe(abortErr)
    })
  })
})
