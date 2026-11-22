import { describe, expect, it, vi } from 'vitest'
import {
  KOMOOT_IMPORT_ENABLED,
  fetchKomootTour,
  importFromKomootLink,
  isUnsupportedKomootLink,
  parseKomootLink,
} from './komoot.js'

const BODY = {
  name: 'Siebengebirge',
  status: 'public',
  _embedded: {
    coordinates: {
      items: [
        { lat: 50.830692, lng: 7.275189, alt: 201.8, t: 0 },
        { lat: 50.831, lng: 7.276, alt: 202, t: 5 },
      ],
    },
  },
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

describe('parseKomootLink', () => {
  const ok: ReadonlyArray<[string, { tourId: string; shareToken?: string }]> = [
    ['https://www.komoot.com/de-de/tour/17811772', { tourId: '17811772' }],
    ['https://www.komoot.com/tour/17811772', { tourId: '17811772' }],
    ['  https://www.komoot.com/tour/17811772  \n', { tourId: '17811772' }],
    ['komoot.de/tour/17811772?share_token=abc&ref=wtd', { tourId: '17811772', shareToken: 'abc' }],
    ['www.komoot.de/en-gb/tour/17811772/', { tourId: '17811772' }],
    ['http://komoot.com/en/tour/17811772/extra/segments', { tourId: '17811772' }],
    ['https://www.komoot.com/de-de/tour/17811772?ref=wtd&share_token=a%2Fb', { tourId: '17811772', shareToken: 'a/b' }],
    ['HTTPS://WWW.KOMOOT.COM/tour/5', { tourId: '5' }],
  ]
  it.each(ok)('accepts %j', (input, expected) => {
    expect(parseKomootLink(input)).toEqual(expected)
  })

  const bad = [
    '',
    'hello world',
    'https://www.komoot.com/smarttour/123',
    'https://www.komoot.com/de-de/user/123',
    'https://example.com/tour/123',
    'https://komoot.com.evil.com/tour/123',
    'https://evilkomoot.com/tour/123',
    'https://www.komoot.com/tour/abc',
    'https://www.komoot.com/tour/',
    'https://www.komoot.com/',
    'ftp://www.komoot.com/tour/123',
    'https://www.komoot.com/tour/123 foo',
    'https://www.komoot.com/tour/12x',
  ]
  it.each(bad)('rejects %j', (input) => {
    expect(parseKomootLink(input)).toBeNull()
  })

  it('omits shareToken when empty', () => {
    expect(parseKomootLink('komoot.de/tour/1?share_token=')).toEqual({ tourId: '1' })
  })
})

describe('isUnsupportedKomootLink', () => {
  it.each([
    'https://www.komoot.com/smarttour/123',
    'https://www.komoot.com/de-de/invite-tour/abc',
    'https://www.komoot.de/collection/123/foo',
    'komoot.com/highlight/456',
    'https://www.komoot.com/en-gb/user/789',
  ])('true for %j', (i) => expect(isUnsupportedKomootLink(i)).toBe(true))

  it.each([
    'https://www.komoot.com/de-de/tour/17811772',
    'https://example.com/smarttour/123',
    'plain text',
    '',
    'https://www.komoot.com/',
  ])('false for %j', (i) => expect(isUnsupportedKomootLink(i)).toBe(false))
})

describe('fetchKomootTour', () => {
  it('has the kill switch on by default', () => {
    expect(KOMOOT_IMPORT_ENABLED).toBe(true)
  })

  it('builds the URL and sends a simple request', async () => {
    const f = stub(jsonResponse(BODY))
    await fetchKomootTour({ tourId: '17811772' }, f)
    expect(f).toHaveBeenCalledTimes(1)
    const [url, init] = f.mock.calls[0]!
    expect(url).toBe('https://api.komoot.de/v007/tours/17811772?_embedded=coordinates')
    expect(init?.headers).toBeUndefined()
    expect(init?.method).toBeUndefined()
    expect(init?.credentials).toBe('omit')
    expect(init?.referrerPolicy).toBe('no-referrer')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('appends an encoded share_token', async () => {
    const f = stub(jsonResponse(BODY))
    await fetchKomootTour({ tourId: '1', shareToken: 'a/b c&d' }, f)
    expect(f.mock.calls[0]![0]).toBe(
      'https://api.komoot.de/v007/tours/1?_embedded=coordinates&share_token=a%2Fb%20c%26d',
    )
  })

  it('maps the response to an ImportedRoute', async () => {
    const t = await fetchKomootTour({ tourId: '1' }, stub(jsonResponse(BODY)))
    expect(t).toEqual({
      name: 'Siebengebirge',
      source: 'komoot',
      points: [[50.830692, 7.275189], [50.831, 7.276]],
    })
  })

  it('falls back to a generated name', async () => {
    const { name: _n, ...noName } = BODY
    const t = await fetchKomootTour({ tourId: '42' }, stub(jsonResponse(noName)))
    expect(t.name).toBe('Komoot-Tour 42')
  })

  it('skips invalid items', async () => {
    const body = {
      ..._embeddedWith([
        { lat: 1, lng: 1 },
        { lat: 'x', lng: 1 },
        { lat: 95, lng: 1 },
        null,
        { lat: 2, lng: 2 },
      ]),
    }
    const t = await fetchKomootTour({ tourId: '1' }, stub(jsonResponse(body)))
    expect(t.points).toEqual([[1, 1], [2, 2]])
  })

  it.each([
    [401, 'komoot-private'],
    [403, 'komoot-private'],
    [404, 'komoot-not-found'],
    [500, 'komoot-unreachable'],
    [429, 'komoot-unreachable'],
  ])('maps HTTP %i to %s', async (status, kind) => {
    expect(await kindOf(fetchKomootTour({ tourId: '1' }, stub(jsonResponse({}, status))))).toBe(kind)
  })

  it('maps network errors to komoot-unreachable', async () => {
    const f = stub(() => Promise.reject(new TypeError('Failed to fetch')))
    expect(await kindOf(fetchKomootTour({ tourId: '1' }, f))).toBe('komoot-unreachable')
  })

  it('maps invalid JSON and unusable bodies to komoot-unreachable', async () => {
    expect(await kindOf(fetchKomootTour({ tourId: '1' }, stub(jsonResponse('<html>'))))).toBe('komoot-unreachable')
    expect(await kindOf(fetchKomootTour({ tourId: '1' }, stub(jsonResponse({ name: 'x' }))))).toBe('komoot-unreachable')
    expect(await kindOf(fetchKomootTour({ tourId: '1' }, stub(jsonResponse('null'))))).toBe('komoot-unreachable')
    expect(
      await kindOf(fetchKomootTour({ tourId: '1' }, stub(jsonResponse({ _embedded: { coordinates: { items: 'x' } } })))),
    ).toBe('komoot-unreachable')
  })

  it('reports no-points for fewer than two valid points', async () => {
    const body = _embeddedWith([{ lat: 1, lng: 1 }, { lat: 'x', lng: 2 }])
    expect(await kindOf(fetchKomootTour({ tourId: '1' }, stub(jsonResponse(body))))).toBe('no-points')
    expect(await kindOf(fetchKomootTour({ tourId: '1' }, stub(jsonResponse(_embeddedWith([])))))).toBe('no-points')
  })

  it('maps a timeout to komoot-unreachable', async () => {
    const f = vi.fn<typeof fetch>(
      (_u, init) =>
        new Promise((_res, rej) => {
          init?.signal?.addEventListener('abort', () => rej(init.signal?.reason))
        }),
    )
    expect(await kindOf(fetchKomootTour({ tourId: '1' }, f, undefined, { timeoutMs: 20 }))).toBe('komoot-unreachable')
  })

  it('rethrows the caller abort unchanged', async () => {
    const ctrl = new AbortController()
    const f = vi.fn<typeof fetch>(
      (_u, init) =>
        new Promise((_res, rej) => {
          init?.signal?.addEventListener('abort', () => rej(init.signal?.reason))
        }),
    )
    const p = fetchKomootTour({ tourId: '1' }, f, ctrl.signal)
    ctrl.abort()
    const err = await p.catch((e) => e)
    expect(err).not.toHaveProperty('kind')
    expect((err as Error).name).toBe('AbortError')
  })

  it('rethrows an AbortError from fetch when the caller signal is aborted', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    const abortErr = new DOMException('aborted', 'AbortError')
    const f = stub(() => Promise.reject(abortErr))
    await expect(fetchKomootTour({ tourId: '1' }, f, ctrl.signal)).rejects.toBe(abortErr)
  })

  it('throws komoot-disabled without fetching when disabled', async () => {
    const f = stub(jsonResponse(BODY))
    expect(await kindOf(fetchKomootTour({ tourId: '1' }, f, undefined, { enabled: false }))).toBe('komoot-disabled')
    expect(f).not.toHaveBeenCalled()
  })
})

describe('importFromKomootLink', () => {
  it('rejects unsupported links', async () => {
    const f = stub(jsonResponse(BODY))
    expect(await kindOf(importFromKomootLink('https://www.komoot.com/smarttour/123', f))).toBe('komoot-link-unsupported')
    expect(f).not.toHaveBeenCalled()
  })

  it('rejects non-Komoot input', async () => {
    const f = stub(jsonResponse(BODY))
    expect(await kindOf(importFromKomootLink('https://example.com/tour/123', f))).toBe('komoot-link-invalid')
    expect(await kindOf(importFromKomootLink('hallo', f))).toBe('komoot-link-invalid')
    expect(f).not.toHaveBeenCalled()
  })

  it('fetches a valid link incl. share token', async () => {
    const f = stub(jsonResponse(BODY))
    const t = await importFromKomootLink(' komoot.de/tour/17811772?share_token=abc&ref=wtd ', f)
    expect(t.source).toBe('komoot')
    expect(f.mock.calls[0]![0]).toBe('https://api.komoot.de/v007/tours/17811772?_embedded=coordinates&share_token=abc')
  })
})

function _embeddedWith(items: unknown[]) {
  return { name: 'x', _embedded: { coordinates: { items } } }
}
