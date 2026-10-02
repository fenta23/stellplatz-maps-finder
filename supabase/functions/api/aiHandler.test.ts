import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Must mock before importing aiHandler because _shared/utils.ts uses Deno.env
// and npm: imports which don't resolve in Node. getSupabase → null skips the
// rate limiter and the summary cache.
vi.mock('../_shared/utils.ts', () => {
  const jsonResponse = (data: unknown, status = 200, _origin: string | null = null) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
  const errorResponse = (msg: string, status = 400, _origin: string | null = null) =>
    new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json' } })
  return {
    jsonResponse,
    errorResponse,
    getSupabase: async () => null,
    checkRateLimit: async () => ({ allowed: true }),
    POI_CACHE_TTL_MS: 0,
  }
})

const chatCompletion = vi.fn()
vi.mock('../_shared/aiClient.ts', () => ({
  aiConfigured: () => true,
  aiModel: () => 'test-model',
  chatCompletion: (...args: unknown[]) => chatCompletion(...args),
}))

import { handleAi } from './aiHandler.ts'

const env: Record<string, string> = { AI_REQUIRE_AUTH: 'false' }

beforeEach(() => {
  vi.stubGlobal('Deno', { env: { get: (k: string) => env[k] } })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  chatCompletion.mockReset()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function post(body: unknown): Request {
  return new Request('http://x/api/ai', { method: 'POST', body: JSON.stringify(body) })
}

const chat = (text = 'Stellplätze bei Rochlitz') =>
  post({ task: 'chat', messages: [{ role: 'user', content: text }] })

describe('handleAi chat', () => {
  // Regression: an expired provider key made every search answer
  // "Das habe ich nicht verstanden …", sending users to rephrase in vain.
  it('reports provider failure as error, not as "nicht verstanden"', async () => {
    chatCompletion.mockRejectedValue(new Error('AI provider 401: key expired'))
    const res = await handleAi(chat(), null)
    const data = await res.json() as { status: string; reply: string }
    expect(data.status).toBe('error')
    expect(data.reply).toBe('Die KI-Suche ist gerade nicht erreichbar.')
    expect(chatCompletion).toHaveBeenCalledTimes(1) // no pointless retry
  })

  it('still asks to rephrase when the model answers with invalid JSON twice', async () => {
    chatCompletion.mockResolvedValue('kein json')
    const res = await handleAi(chat(), null)
    const data = await res.json() as { status: string; reply: string }
    expect(data.status).toBe('clarify')
    expect(data.reply).toContain('nicht verstanden')
    expect(chatCompletion).toHaveBeenCalledTimes(2)
  })

  it('reports error when the corrective retry hits a provider failure', async () => {
    chatCompletion
      .mockResolvedValueOnce('kein json')
      .mockRejectedValueOnce(new Error('AI provider 429'))
    const data = await (await handleAi(chat(), null)).json() as { status: string }
    expect(data.status).toBe('error')
  })

  it('passes a valid reply through', async () => {
    chatCompletion.mockResolvedValue(JSON.stringify({ status: 'clarify', reply: 'Welche Region?' }))
    const data = await (await handleAi(chat(), null)).json() as { status: string; reply: string }
    expect(data).toEqual({ status: 'clarify', reply: 'Welche Region?', intent: null })
  })
})

describe('handleAi summarize', () => {
  const summarize = () => post({ task: 'summarize', tags: { amenity: 'parking', motorhome: 'yes' } })

  // Regression: provider failure was a silent 200 { summary: null },
  // indistinguishable from "nothing to summarize".
  it('returns 502 when the provider fails', async () => {
    chatCompletion.mockRejectedValue(new Error('AI provider 401: key expired'))
    const res = await handleAi(summarize(), null)
    expect(res.status).toBe(502)
  })

  it('returns the summary on success', async () => {
    chatCompletion.mockResolvedValue('Kostenloser Parkplatz für Wohnmobile.')
    const res = await handleAi(summarize(), null)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ summary: 'Kostenloser Parkplatz für Wohnmobile.' })
  })
})
