import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchNearby } from './nearbyClient.js'

afterEach(() => vi.unstubAllGlobals())

function mockResponse(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText: 'Error',
    json: () => Promise.resolve(body),
  }
}

describe('fetchNearby', () => {
  it('classifies and returns nearby amenities sorted by distance', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {
      elements: [
        { id: 1, lat: 48.1005, lon: 11.5, tags: { amenity: 'fuel', name: 'Shell' } },
        { id: 2, lat: 48.1001, lon: 11.5, tags: { shop: 'bakery' } },
      ],
    })))

    const result = await fetchNearby(48.1, 11.5)

    expect(result.map(r => r.kind)).toEqual(['bakery', 'fuel'])
    expect(result[0]?.name).toBe('Bäckerei') // no OSM name tag → falls back to the German label
    expect(result[1]?.name).toBe('Shell')
  })

  it('uses way/relation center when lat/lon are absent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {
      elements: [{ id: 1, center: { lat: 48.101, lon: 11.501 }, tags: { amenity: 'pharmacy' } }],
    })))

    const result = await fetchNearby(48.1, 11.5)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ kind: 'pharmacy', lat: 48.101, lon: 11.501 })
  })

  it('drops elements without coordinates or an unclassifiable kind', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {
      elements: [
        { id: 1, tags: { amenity: 'fuel' } }, // no coords
        { id: 2, lat: 48.1, lon: 11.5, tags: { shop: 'butcher' } }, // unclassified
      ],
    })))

    expect(await fetchNearby(48.1, 11.5)).toEqual([])
  })

  it('deduplicates elements with the same id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {
      elements: [
        { id: 1, lat: 48.1, lon: 11.5, tags: { amenity: 'fuel' } },
        { id: 1, lat: 48.1, lon: 11.5, tags: { amenity: 'fuel' } },
      ],
    })))

    expect(await fetchNearby(48.1, 11.5)).toHaveLength(1)
  })

  it('caps results at 15, closest first', async () => {
    const elements = Array.from({ length: 20 }, (_, i) => ({
      id: i,
      lat: 48.1 + i * 0.001,
      lon: 11.5,
      tags: { amenity: 'fuel' },
    }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, { elements })))

    const result = await fetchNearby(48.1, 11.5)

    expect(result).toHaveLength(15)
    expect(result[0]?.distance).toBeLessThan(result[14]!.distance)
  })

  // Regression: fetchNearby used to propagate a thrown error from the mirror
  // fetch and crash the caller; loadNearby's UX contract is "silently empty
  // on failure" (matches the old server-proxied behavior).
  it('returns an empty array when every mirror fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(403, null)))

    expect(await fetchNearby(48.1, 11.5)).toEqual([])
  })

  it('falls back to the next mirror when the first rejects', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockResponse(403, null))
      .mockResolvedValueOnce(mockResponse(200, {
        elements: [{ id: 1, lat: 48.1, lon: 11.5, tags: { amenity: 'fuel' } }],
      }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchNearby(48.1, 11.5)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result).toHaveLength(1)
  })
})
