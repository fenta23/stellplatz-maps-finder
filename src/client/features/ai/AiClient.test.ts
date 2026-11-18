import { describe, it, expect, afterEach, vi } from 'vitest'
import { loadPoiSummary, sendAiChat } from './AiClient.js'
import type { OsmPoi } from '@/features/pois/OverpassClient.js'

afterEach(() => vi.unstubAllGlobals())

const poi: OsmPoi = {
  id: 42,
  type: 'camper',
  lat: 47.6,
  lon: 9.1,
  tags: { name: 'Stellplatz am See', motorhome: 'yes', fee: 'yes', capacity: '12' },
}

describe('loadPoiSummary', () => {
  it('returns the trimmed summary on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ summary: '  Wohnmobilstellplatz mit 12 Plätzen.  ' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    expect(await loadPoiSummary(poi)).toBe('Wohnmobilstellplatz mit 12 Plätzen.')
  })

  it('POSTs the summarize task with the POI tags', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ summary: 'x' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await loadPoiSummary(poi)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toContain('/api/ai')
    expect(init.method).toBe('POST')
    const sent = JSON.parse(init.body as string)
    expect(sent).toMatchObject({ task: 'summarize', poiId: 42 })
    expect(sent.tags).toMatchObject({ motorhome: 'yes', capacity: '12' })
  })

  it('returns null when summary is empty or missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ summary: '' }) }))
    expect(await loadPoiSummary(poi)).toBeNull()

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }))
    expect(await loadPoiSummary(poi)).toBeNull()
  })

  it('returns null on a non-ok response (e.g. 429 rate limit)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, json: () => Promise.resolve({}) }))
    expect(await loadPoiSummary(poi)).toBeNull()
  })

  it('returns null on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expect(await loadPoiSummary(poi)).toBeNull()
  })

  it('returns null when the JSON body is malformed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.reject(new Error('bad json')) }))
    expect(await loadPoiSummary(poi)).toBeNull()
  })
})

describe('sendAiChat', () => {
  const turns = [{ role: 'user', content: 'Bodensee' }] as const

  it('passes a valid response through parseChatResponse', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'ready', reply: 'Gefunden.', intent: { place: 'Bodensee', enableFilters: ['camper'] } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await sendAiChat(turns)

    expect(res.status).toBe('ready')
    expect(res.reply).toBe('Gefunden.')
    expect(res.intent?.place).toBe('Bodensee')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toContain('/api/ai')
    expect(JSON.parse(init.body as string)).toMatchObject({ task: 'chat', messages: turns })
  })

  it('asks to log in again on 401 (expired session)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: () => Promise.resolve({}) }))
    const res = await sendAiChat(turns)
    expect(res.status).toBe('error')
    expect(res.reply).toBe('Bitte melde dich erneut an, um die KI-Suche zu nutzen.')
  })

  it('reports rate limiting on 429', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, json: () => Promise.resolve({}) }))
    const res = await sendAiChat(turns)
    expect(res.status).toBe('error')
    expect(res.reply).toBe('Zu viele Anfragen – bitte einen Moment warten.')
  })

  it('reports unavailability on other HTTP errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) }))
    const res = await sendAiChat(turns)
    expect(res).toMatchObject({ status: 'error', reply: 'Die KI-Suche ist gerade nicht erreichbar.' })
  })

  it('maps a network error to an error status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const res = await sendAiChat(turns)
    expect(res.status).toBe('error')
    expect(res.intent).toBeNull()
  })
})
