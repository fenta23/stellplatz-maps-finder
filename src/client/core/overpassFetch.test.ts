import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchFromOverpassMirrors } from './overpassFetch.js'

afterEach(() => vi.unstubAllGlobals())

function mockResponse(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText: status === 429 ? 'Too Many Requests' : 'Error',
    json: () => Promise.resolve(body),
  }
}

describe('fetchFromOverpassMirrors', () => {
  it('returns the parsed body on first-mirror success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, { elements: [] }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchFromOverpassMirrors('[out:json];out;')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ elements: [] })
  })

  it('falls back to the next mirror when the first rejects (403/406)', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockResponse(403, null))
      .mockResolvedValueOnce(mockResponse(200, { elements: [{ id: 1 }] }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchFromOverpassMirrors('[out:json];out;')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ elements: [{ id: 1 }] })
  })

  it('falls back past a network error to the next mirror', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(mockResponse(200, { elements: [] }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchFromOverpassMirrors('[out:json];out;')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ elements: [] })
  })

  it('throws with the last status when every mirror rejects', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(429, null))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchFromOverpassMirrors('[out:json];out;')).rejects.toThrow('429')
  })

  it('propagates AbortError from an external signal without trying more mirrors', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn().mockImplementation(() => {
      controller.abort()
      return Promise.reject(new DOMException('The operation was aborted', 'AbortError'))
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchFromOverpassMirrors('[out:json];out;', controller.signal)).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
