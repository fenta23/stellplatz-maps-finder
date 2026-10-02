import { jsonResponse, errorResponse, getSupabase, checkRateLimit, POI_CACHE_TTL_MS } from '../_shared/utils.ts'
import { aiConfigured, aiModel, chatCompletion, type ChatMessage } from '../_shared/aiClient.ts'

// POST /api/ai — KI-Sidecar.
//   task "summarize": { tags } → { summary }           (Phase 1)
//   task "chat":      { messages } → { status, reply, intent }  (Phase 2)
// Stateless; the chat history is supplied by the client every turn.

interface AiRequest {
  readonly task?: string
  readonly tags?: Record<string, unknown>
  readonly poiId?: string | number
  readonly messages?: unknown
}

export async function handleAi(req: Request, origin: string | null): Promise<Response> {
  let body: AiRequest
  try {
    body = await req.json() as AiRequest
  } catch {
    return errorResponse('Invalid JSON body', 400, origin)
  }

  if (body.task === 'summarize') return handleSummarize(body, req, origin)
  if (body.task === 'chat') return handleChat(body, req, origin)
  return errorResponse('Unsupported task', 400, origin)
}

// ── Shared: rate limit + auth gate ───────────────────────────────────────────

async function aiGate(
  req: Request,
  origin: string | null,
): Promise<{ ok: true; supabase: Awaited<ReturnType<typeof getSupabase>> } | { ok: false; res: Response }> {
  // Auth gate: login required by default. Set AI_REQUIRE_AUTH=false to open it up.
  if ((Deno.env.get('AI_REQUIRE_AUTH') ?? 'true').trim() !== 'false') {
    const authed = await isAuthenticated(req)
    if (!authed) return { ok: false, res: errorResponse('Login required', 401, origin) }
  }

  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const supabase = await getSupabase()
  if (supabase) {
    const { allowed, retryAfterMs } = await checkRateLimit(supabase, 'ai', clientIp)
    if (!allowed) {
      const res = errorResponse('Rate limit exceeded', 429, origin)
      if (retryAfterMs) res.headers.set('Retry-After', String(Math.ceil(retryAfterMs / 1000)))
      return { ok: false, res }
    }
  }
  return { ok: true, supabase }
}

async function isAuthenticated(req: Request): Promise<boolean> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim()
  if (!token) return false
  const supabase = await getSupabase()
  if (!supabase) return false
  try {
    const { data, error } = await supabase.auth.getUser(token)
    return !error && !!data?.user
  } catch {
    return false
  }
}

// ── Task: summarize (Phase 1) ────────────────────────────────────────────────

const SUMMARY_SYSTEM = `Du bist ein Assistent in einer Karte für Wohnmobil-/Camper-Stellplätze.
Fasse die folgenden OpenStreetMap-Tags eines Ortes in 2–3 kurzen, natürlichen deutschen Sätzen zusammen.
Regeln:
- Nutze AUSSCHLIESSLICH die gegebenen Tags. Erfinde nichts dazu (keine Preise, Öffnungszeiten oder Ausstattung, die nicht in den Tags steht).
- Schreibe für Reisende mit Wohnmobil/Camper, sachlich und knapp.
- Kein Auflisten der Roh-Tags, sondern flüssiger Text.
- Wenn die Tags zu wenig hergeben, sage das in einem kurzen Satz.
- Antworte nur mit dem Text, ohne Einleitung oder Überschrift.`

const SKIP_KEYS = new Set([
  'image', 'wikimedia_commons', 'wikipedia', 'source', 'ref', 'url', 'note', 'fixme',
  'website', 'contact:website', 'phone', 'contact:phone', 'email', 'contact:email',
])

function tagLines(tags: Record<string, unknown>): string {
  return Object.entries(tags)
    .filter(([k, v]) =>
      typeof v === 'string' && v.trim() !== '' &&
      !SKIP_KEYS.has(k) && !k.startsWith('source:'))
    .map(([k, v]) => `${k}=${String(v).slice(0, 120)}`)
    .slice(0, 40)
    .join('\n')
}

async function handleSummarize(body: AiRequest, req: Request, origin: string | null): Promise<Response> {
  if (!aiConfigured()) return jsonResponse({ summary: null }, 200, origin)

  const tags = body.tags && typeof body.tags === 'object' ? body.tags : {}
  const lines = tagLines(tags)
  if (!lines) return jsonResponse({ summary: null }, 200, origin)

  const gate = await aiGate(req, origin)
  if (!gate.ok) return gate.res
  const supabase = gate.supabase

  const cacheKey = `ai:summary:${aiModel()}:${await sha256Hex(lines)}`
  if (supabase) {
    const cached = await readCachedSummary(supabase, cacheKey)
    if (cached !== null) return jsonResponse({ summary: cached }, 200, origin)
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: SUMMARY_SYSTEM },
    { role: 'user', content: lines },
  ]

  try {
    const summary = (await chatCompletion(messages, { maxTokens: 220, temperature: 0.2 })).trim()
    if (!summary) return jsonResponse({ summary: null }, 200, origin)
    if (supabase) await writeCachedSummary(supabase, cacheKey, summary)
    return jsonResponse({ summary }, 200, origin)
  } catch (err) {
    // 502 instead of a silent { summary: null } so a dead provider shows up in
    // the network tab; the client hides the block on any non-2xx anyway.
    console.error('AI summarize failed:', err)
    return errorResponse('AI provider error', 502, origin)
  }
}

// ── Task: chat (Phase 2) ─────────────────────────────────────────────────────

const CHAT_SYSTEM = `Du bist der Suchassistent einer Karte für Wohnmobil-/Camper-Reisende.
Deine EINZIGE Aufgabe: dem Nutzer helfen, passende Orte auf der Karte zu finden
(Stellplätze, Campingplätze, Entsorgung, Wasser, Klettern und verwandte Versorgung
wie Dusche, Tankstelle, Supermarkt, Toilette). Du bist KEIN allgemeiner Chatbot.

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt dieser Form:
{
  "status": "clarify" | "ready" | "offtopic",
  "reply": "<kurzer deutscher Satz an den Nutzer>",
  "intent": null | {
    "place": <Ortsname als String oder null>,
    "enableFilters": [<Filter-IDs>],
    "adHocFilters": [ { "name": <String>, "iconId": <String>, "selectors": [ { "elements": ["node","way","relation"], "tags": [ { "key": <String>, "value": <String> } ] } ] } ],
    "maxDistanceKm": <Zahl oder null>
  }
}

Bekannte Filter-IDs (nutze diese bevorzugt): "parking" (Parkplatz),
"camper" (Wohnmobil-/Camperstellplatz), "campsite" (Campingplatz),
"dump" (Entsorgungsstation), "water" (Trinkwasser/Wasserstelle), "climbing" (Klettergebiet).

Für Dinge ohne passende ID baue "adHocFilters" aus echten OSM-Tags, z.B.:
Dusche → amenity=shower, Tankstelle → amenity=fuel, Supermarkt → shop=supermarket,
Toilette → amenity=toilets, Trinkwasser → amenity=drinking_water, Restaurant → amenity=restaurant.

Regeln:
- Wenn die Anfrage zu vage ist (z.B. fehlender Ort oder unklare Kategorie), stelle EINE
  gezielte Rückfrage: status "clarify", intent null.
- Wenn du genug weißt: status "ready" und fülle intent. "reply" fasst kurz zusammen, was du zeigst.
- Bei themenfremden Anfragen (alles, was nicht Orte-Finden auf dieser Karte ist):
  status "offtopic", intent null, und lenke freundlich zurück zum Thema.
- "place" nur setzen, wenn ein konkreter Ort genannt wurde.
- Erfinde keine Filter-IDs. Halte "reply" kurz (1–2 Sätze).`

interface ChatTurn { role: 'user' | 'assistant'; content: string }

function parseTurns(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return []
  const out: ChatTurn[] = []
  for (const m of raw) {
    const role = (m as { role?: unknown })?.role
    const content = (m as { content?: unknown })?.content
    if ((role === 'user' || role === 'assistant') && typeof content === 'string' && content.trim()) {
      out.push({ role, content: content.slice(0, 2000) })
    }
  }
  return out.slice(-12) // keep the recent window
}

function chatMaxTurns(): number {
  const n = Number(Deno.env.get('AI_MAX_TURNS'))
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5
}

async function handleChat(body: AiRequest, req: Request, origin: string | null): Promise<Response> {
  if (!aiConfigured()) {
    return jsonResponse({ status: 'error', reply: 'Die KI-Suche ist derzeit nicht verfügbar.', intent: null }, 200, origin)
  }

  const turns = parseTurns(body.messages)
  if (turns.length === 0) return errorResponse('messages required', 400, origin)

  const userTurns = turns.filter(t => t.role === 'user').length
  if (userTurns > chatMaxTurns()) {
    return jsonResponse({
      status: 'limit',
      reply: `Limit von ${chatMaxTurns()} Fragen erreicht – bitte starte die Suche neu.`,
      intent: null,
    }, 200, origin)
  }

  const gate = await aiGate(req, origin)
  if (!gate.ok) return gate.res

  const messages: ChatMessage[] = [
    { role: 'system', content: CHAT_SYSTEM },
    ...turns,
  ]

  let parsed = await askChat(messages)
  if (parsed === 'invalid') {
    // one corrective retry — strict JSON only
    parsed = await askChat([
      ...messages,
      { role: 'system', content: 'Deine letzte Antwort war kein gültiges JSON. Antworte NUR mit dem geforderten JSON-Objekt.' },
    ])
  }
  // Provider down (expired key, quota, unknown model) is not the user's fault —
  // don't ask them to rephrase. No retry: the same call would fail again.
  if (parsed === 'provider') {
    return jsonResponse({ status: 'error', reply: 'Die KI-Suche ist gerade nicht erreichbar.', intent: null }, 200, origin)
  }
  if (parsed === 'invalid') {
    return jsonResponse({ status: 'clarify', reply: 'Das habe ich nicht verstanden – kannst du es anders formulieren?', intent: null }, 200, origin)
  }
  return jsonResponse(parsed, 200, origin)
}

interface ChatReply { status: string; reply: string; intent: unknown }

/** 'provider' = the AI call itself failed; 'invalid' = it answered, but unusably. */
async function askChat(messages: ChatMessage[]): Promise<ChatReply | 'provider' | 'invalid'> {
  let text: string
  try {
    text = await chatCompletion(messages, { maxTokens: 500, temperature: 0.3, jsonObject: true })
  } catch (err) {
    console.error('AI chat failed:', err)
    return 'provider'
  }
  const obj = extractJsonObject(text)
  if (!obj) return 'invalid'

  const status = typeof obj['status'] === 'string' ? obj['status'] : ''
  if (status !== 'clarify' && status !== 'ready' && status !== 'offtopic') return 'invalid'
  const reply = typeof obj['reply'] === 'string' ? obj['reply'].slice(0, 600) : ''
  if (!reply) return 'invalid'

  // Pass intent through verbatim — the client does the hard allowlist validation.
  return { status, reply, intent: status === 'ready' ? (obj['intent'] ?? null) : null }
}

/** Best-effort: parse a JSON object, tolerating prose or code fences around it. */
function extractJsonObject(text: string): Record<string, unknown> | null {
  const tryParse = (s: string): Record<string, unknown> | null => {
    try {
      const v = JSON.parse(s)
      return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null
    } catch {
      return null
    }
  }
  const direct = tryParse(text.trim())
  if (direct) return direct
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end > start) return tryParse(text.slice(start, end + 1))
  return null
}

// ── Cache helpers (shared with summarize) ────────────────────────────────────

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
}

async function readCachedSummary(
  supabase: NonNullable<Awaited<ReturnType<typeof getSupabase>>>,
  key: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('poi_cache')
      .select('data, fetched_at')
      .eq('key', key)
      .single()
    if (error || !data) return null
    const ageMs = Date.now() - new Date(data.fetched_at as string).getTime()
    if (ageMs > POI_CACHE_TTL_MS) return null
    const v = (data.data as { v?: unknown })?.v
    return typeof v === 'string' ? v : null
  } catch {
    return null
  }
}

async function writeCachedSummary(
  supabase: NonNullable<Awaited<ReturnType<typeof getSupabase>>>,
  key: string,
  summary: string,
): Promise<void> {
  try {
    await supabase
      .from('poi_cache')
      .upsert({ key, data: { v: summary }, fetched_at: new Date().toISOString() })
  } catch {
    // best-effort write
  }
}
