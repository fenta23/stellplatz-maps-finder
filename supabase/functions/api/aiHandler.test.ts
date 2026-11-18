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
import { DEFAULT_FILTERS, FILTER_ICONS, MAX_SELECTOR_CONDITIONS } from '../../../src/client/features/filters/filterModel.ts'
import { TRAVEL_MODES } from '../../../src/client/features/route-planner/plannerModel.ts'

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

async function systemPrompt(): Promise<string> {
  chatCompletion.mockResolvedValue('{"status":"offtopic","reply":"x","intent":null}')
  await handleAi(chat(), null)
  const messages = chatCompletion.mock.calls[0]![0] as { role: string; content: string }[]
  return messages.find(m => m.role === 'system')!.content
}

describe('chat route intent', () => {
  it('passes intent.route through unchanged', async () => {
    const intent = {
      place: 'Lindau',
      enableFilters: ['bakery'],
      adHocFilters: [],
      route: { from: 'Konstanz', to: 'Lindau', mode: 'bike' },
    }
    chatCompletion.mockResolvedValue(JSON.stringify({ status: 'ready', reply: 'Route vorbereitet.', intent }))
    const data = await (await handleAi(chat('mit dem Rad von Konstanz nach Lindau'), null)).json() as { status: string; intent: unknown }
    expect(data.status).toBe('ready')
    expect(data.intent).toEqual(intent)
  })

  it('prompt documents the route shape and every travel mode', async () => {
    const system = await systemPrompt()
    for (const k of ['"route"', '"from"', '"to"', '"mode"']) expect(system).toContain(k)
    for (const m of TRAVEL_MODES) expect(system, `prompt misses mode ${m}`).toContain(`"${m}"`)
  })

  it('prompt states the selector condition limit', async () => {
    const system = await systemPrompt()
    expect(system).toContain(`Höchstens ${MAX_SELECTOR_CONDITIONS} Tag-Bedingungen`)
  })

  it('prompt no longer mentions maxDistanceKm', async () => {
    expect(await systemPrompt()).not.toContain('maxDistanceKm')
  })

  it('requests up to 600 tokens', async () => {
    await systemPrompt()
    expect(chatCompletion.mock.calls[0]![1]).toMatchObject({ maxTokens: 600 })
  })
})

describe('chat system prompt', () => {
  // Drift guard: the prompt hard-codes the filter ids; hut/shelter were once forgotten.
  it('lists every built-in OSM filter id', async () => {
    chatCompletion.mockResolvedValue('{"status":"offtopic","reply":"x","intent":null}')
    await handleAi(chat(), null)
    const messages = chatCompletion.mock.calls[0]![0] as { role: string; content: string }[]
    const system = messages.find(m => m.role === 'system')!.content
    for (const f of DEFAULT_FILTERS.filter(d => d.kind === 'osm')) {
      expect(system, `prompt misses filter id ${f.id}`).toContain(`"${f.id}"`)
    }
  })

  // Regression: the prompt asked for an "iconId" without saying which ids exist or
  // what to do when none fits, so the model picked an unrelated one — a filter for
  // bus stops came back with the toilet icon.
  it('lists every available icon id and tells the model to fall back to "pin"', async () => {
    chatCompletion.mockResolvedValue('{"status":"offtopic","reply":"x","intent":null}')
    await handleAi(chat(), null)
    const messages = chatCompletion.mock.calls[0]![0] as { role: string; content: string }[]
    const system = messages.find(m => m.role === 'system')!.content
    const iconSection = system.slice(system.indexOf('"iconId" eines adHocFilters'))
    expect(iconSection.length, 'prompt has no icon section').toBeGreaterThan(50)
    for (const icon of FILTER_ICONS) {
      expect(iconSection, `prompt misses icon id ${icon.id}`).toContain(`"${icon.id}"`)
    }
    expect(iconSection).toMatch(/Passt keines[\s\S]*nimm "pin"/)
  })
})
