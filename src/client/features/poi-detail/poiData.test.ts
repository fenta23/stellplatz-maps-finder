import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'

const { fetchNearbyMock } = vi.hoisted(() => ({ fetchNearbyMock: vi.fn() }))
vi.mock('./nearbyClient.js', () => ({ fetchNearby: fetchNearbyMock }))

import { wikimediaTitle, wikimediaApiUrl, resolveWikimediaImage, collectTagImages, loadMapillaryImages, loadNearby, loadNotes } from './poiData.js'

afterEach(() => vi.unstubAllGlobals())

describe('wikimediaTitle', () => {
  it('prefixes a bare filename with File:', () => expect(wikimediaTitle('Foo.jpg')).toBe('File:Foo.jpg'))
  it('keeps an existing File: prefix', () => expect(wikimediaTitle('File:Foo.jpg')).toBe('File:Foo.jpg'))
  it('keeps a Category: prefix', () => expect(wikimediaTitle('Category:Bar')).toBe('Category:Bar'))
})

describe('wikimediaApiUrl', () => {
  it('targets the commons API and encodes the title', () => {
    const url = wikimediaApiUrl('File:Schöne Hütte.jpg')
    expect(url).toContain('commons.wikimedia.org/w/api.php')
    expect(url).toContain(encodeURIComponent('File:Schöne Hütte.jpg'))
  })
})

describe('resolveWikimediaImage', () => {
  it('maps an imageinfo thumbnail to a PoiImage', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ query: { pages: { '1': { imageinfo: [{ url: 'u', thumburl: 'https://thumb/x.jpg' }] } } } }),
    }))
    const img = await resolveWikimediaImage('Foo.jpg')
    expect(img).toMatchObject({ src: 'https://thumb/x.jpg', caption: 'Wikimedia Commons' })
    expect(img?.link).toContain('commons.wikimedia.org/wiki/')
  })

  it('returns null when there is no thumbnail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: () => Promise.resolve({ query: { pages: {} } }) }))
    expect(await resolveWikimediaImage('Foo.jpg')).toBeNull()
  })

  it('returns null on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expect(await resolveWikimediaImage('Foo.jpg')).toBeNull()
  })
})

describe('collectTagImages', () => {
  type POI = Parameters<typeof collectTagImages>[0]
  const base: POI = { id: 1, type: 'campsite', lat: 0, lon: 0, tags: {} }

  it('returns empty when no image tags exist', async () => {
    expect(await collectTagImages(base)).toEqual([])
  })

  it('collects the image tag', async () => {
    const r = await collectTagImages({ ...base, tags: { image: 'https://example.com/pic.jpg' } })
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ src: 'https://example.com/pic.jpg', caption: 'OSM' })
  })

  it('resolves a wikimedia_commons tag', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ query: { pages: { '1': { imageinfo: [{ url: 'u', thumburl: 'https://thumb/x.jpg' }] } } } }),
    }))
    const r = await collectTagImages({ ...base, tags: { wikimedia_commons: 'Foo.jpg' } })
    expect(r).toHaveLength(1)
    expect(r[0].caption).toBe('Wikimedia Commons')
  })

  it('includes both image and wikimedia_commons', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ query: { pages: { '1': { imageinfo: [{ url: 'u', thumburl: 'https://thumb/y.jpg' }] } } } }),
    }))
    const r = await collectTagImages({ ...base, tags: { image: 'https://x.com/a.jpg', wikimedia_commons: 'Bar.jpg' } })
    expect(r).toHaveLength(2)
    expect(r[0].src).toBe('https://x.com/a.jpg')
    expect(r[1].caption).toBe('Wikimedia Commons')
  })

  it('skips wikimedia_commons when resolution fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fail')))
    const r = await collectTagImages({ ...base, tags: { wikimedia_commons: 'Foo.jpg' } })
    expect(r).toHaveLength(0)
  })
})

describe('loadMapillaryImages', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()) })
  afterEach(() => vi.unstubAllGlobals())

  it('returns images on success', async () => {
    const data = [{ src: 'https://mapillary.com/img.jpg', caption: 'Mapillary' }]
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(data) })
    const r = await loadMapillaryImages({ lat: 48.1, lon: 11.2 })
    expect(r).toEqual(data)
  })

  it('returns empty on HTTP error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false })
    expect(await loadMapillaryImages({ lat: 48.1, lon: 11.2 })).toEqual([])
  })

  it('returns empty on network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('net'))
    expect(await loadMapillaryImages({ lat: 48.1, lon: 11.2 })).toEqual([])
  })
})

// loadNearby just delegates to nearbyClient's fetchNearby (which fetches
// Overpass mirrors directly) — see nearbyClient.test.ts for the actual
// fetch/classify/sort logic.
describe('loadNearby', () => {
  afterEach(() => fetchNearbyMock.mockReset())

  it('delegates to fetchNearby with the point\'s lat/lon', async () => {
    const data = [{ kind: 'fuel', name: 'Tanke', distance: 200, lat: 48.2, lon: 11.3 }]
    fetchNearbyMock.mockResolvedValue(data)

    const r = await loadNearby({ lat: 48.1, lon: 11.2 })

    expect(fetchNearbyMock).toHaveBeenCalledWith(48.1, 11.2)
    expect(r).toEqual(data)
  })
})

describe('loadNotes', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()) })
  afterEach(() => vi.unstubAllGlobals())

  it('returns notes on success', async () => {
    const data = [{ id: 1, date: '2026-06-12', text: 'Wasser' }]
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(data) })
    const r = await loadNotes({ lat: 48.1, lon: 11.2 })
    expect(r).toEqual(data)
  })

  it('returns empty on error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('net'))
    expect(await loadNotes({ lat: 48.1, lon: 11.2 })).toEqual([])
  })
})
