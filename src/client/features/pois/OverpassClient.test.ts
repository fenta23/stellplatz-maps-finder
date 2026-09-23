import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchPois, buildQuery, isPrivateParking } from './OverpassClient.js'
import type { LatLngBounds, OsmPoi } from './OverpassClient.js'
import { DEFAULT_FILTERS, type FilterDef } from '@/features/filters/filterModel.js'

const BOUNDS: LatLngBounds = { south: 48.0, west: 11.0, north: 48.5, east: 11.5 }
const f = (id: string): FilterDef => DEFAULT_FILTERS.find(x => x.id === id)!

afterEach(() => vi.unstubAllGlobals())

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    statusText: status === 429 ? 'Too Many Requests' : 'OK',
    json: () => Promise.resolve(body),
  }))
}

function mockResponse(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText: status === 429 ? 'Too Many Requests' : 'Error',
    json: () => Promise.resolve(body),
  }
}

const PARKING_RESPONSE = {
  elements: [
    { type: 'node', id: 42, lat: 48.1, lon: 11.1, tags: { amenity: 'parking', name: 'Testparkplatz' } },
  ],
}

describe('buildQuery (data-driven)', () => {
  it('includes parking query for the parking filter', () => {
    const q = buildQuery(BOUNDS, [f('parking')])
    expect(q).toContain('"amenity"="parking"')
    expect(q).toContain('48,11,48.5,11.5')
    expect(q).toContain('"motorhome"!="yes"')
  })

  it('includes campsite query for the campsite filter', () => {
    const q = buildQuery(BOUNDS, [f('campsite')])
    expect(q).toContain('"tourism"="camp_site"')
    expect(q).not.toContain('"amenity"="parking"')
  })

  it('includes all queries for multiple filters', () => {
    const q = buildQuery(BOUNDS, [f('parking'), f('camper'), f('campsite')])
    expect(q).toContain('"amenity"="parking"')
    expect(q).toContain('"tourism"="camp_pitch"')
    expect(q).toContain('"tourism"="camp_site"')
    expect(q).toContain('"motorhome"="yes"')
    expect(q).toContain('"tourism"="caravan_site"')
  })

  it('returns empty-ish query for no filters', () => {
    const q = buildQuery(BOUNDS, [])
    expect(q).not.toContain('"amenity"')
    expect(q).not.toContain('"tourism"')
  })
})

describe('isPrivateParking', () => {
  const parking = (access?: string): OsmPoi => ({
    id: 1, type: 'parking', lat: 48, lon: 11,
    tags: access !== undefined ? { access } : {},
  })

  it('treats parking without access tag as public', () => {
    expect(isPrivateParking(parking())).toBe(false)
  })
  it('treats access=private as private', () => {
    expect(isPrivateParking(parking('private'))).toBe(true)
  })
  it('treats access=no as private', () => {
    expect(isPrivateParking(parking('no'))).toBe(true)
  })
  it.each(['yes', 'public', 'permissive', 'customers'])('treats access=%s as public', (a) => {
    expect(isPrivateParking(parking(a))).toBe(false)
  })
  it('returns false for non-parking POIs even with access=private', () => {
    const campsite: OsmPoi = { id: 2, type: 'campsite', lat: 48, lon: 11, tags: { access: 'private' } }
    expect(isPrivateParking(campsite)).toBe(false)
  })
})

describe('fetchPois', () => {
  it('returns empty array when no OSM filters given', async () => {
    const result = await fetchPois(BOUNDS, [])
    expect(result).toEqual([])
  })

  it('parses and classifies node elements', async () => {
    stubFetch(200, PARKING_RESPONSE)
    const result = await fetchPois(BOUNDS, [f('parking')])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ id: 42, type: 'parking', lat: 48.1, lon: 11.1 })
    expect(result[0]?.tags.name).toBe('Testparkplatz')
  })

  it('uses center for way elements', async () => {
    stubFetch(200, {
      elements: [
        { type: 'way', id: 99, center: { lat: 48.2, lon: 11.2 }, tags: { tourism: 'camp_site' } },
      ],
    })
    const result = await fetchPois(BOUNDS, [f('campsite')])
    expect(result[0]).toMatchObject({ lat: 48.2, lon: 11.2, type: 'campsite' })
  })

  it('throws when every mirror responds with an error', async () => {
    stubFetch(429, { error: 'rate limited' })
    await expect(fetchPois(BOUNDS, [f('parking')])).rejects.toThrow('429')
  })

  // Regression: a single mirror can reject a request (e.g. 403/406) while the
  // others are healthy — fetchPois used to call one fixed endpoint with no
  // fallback, so one rejecting mirror took POI loading down entirely.
  it('falls back to the next mirror when the first rejects', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockResponse(403, null))
      .mockResolvedValueOnce(mockResponse(200, PARKING_RESPONSE))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchPois(BOUNDS, [f('parking')])

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ id: 42, type: 'parking' })
  })

  it('falls back past a network error to the next mirror', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(mockResponse(200, PARKING_RESPONSE))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchPois(BOUNDS, [f('parking')])

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result).toHaveLength(1)
  })

  it('filters elements without coordinates', async () => {
    stubFetch(200, {
      elements: [
        { type: 'way', id: 1, tags: { amenity: 'parking' } },
        { type: 'node', id: 2, lat: 48.3, lon: 11.3, tags: { amenity: 'parking' } },
      ],
    })
    const result = await fetchPois(BOUNDS, [f('parking')])
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe(2)
  })

  it('drops elements that no active filter claims', async () => {
    stubFetch(200, {
      elements: [
        { type: 'node', id: 5, lat: 48.1, lon: 11.1, tags: { shop: 'bakery' } },
        { type: 'node', id: 6, lat: 48.1, lon: 11.1, tags: { amenity: 'parking' } },
      ],
    })
    const result = await fetchPois(BOUNDS, [f('parking')])
    expect(result.map(p => p.id)).toEqual([6])
  })

  it('propagates AbortError from an external signal without trying more mirrors', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn().mockImplementation(() => {
      controller.abort()
      return Promise.reject(new DOMException('The operation was aborted', 'AbortError'))
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchPois(BOUNDS, [f('parking')], controller.signal)).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('handles missing elements field gracefully', async () => {
    stubFetch(200, { version: 0.6, generator: 'Overpass' })
    const result = await fetchPois(BOUNDS, [f('parking')])
    expect(result).toEqual([])
  })

  it('deduplicates elements with same id', async () => {
    stubFetch(200, {
      elements: [
        { type: 'node', id: 7, lat: 48.1, lon: 11.1, tags: { amenity: 'parking' } },
        { type: 'node', id: 7, lat: 48.1, lon: 11.1, tags: { amenity: 'parking' } },
      ],
    })
    const result = await fetchPois(BOUNDS, [f('parking')])
    expect(result).toHaveLength(1)
  })
})
