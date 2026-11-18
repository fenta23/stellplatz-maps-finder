import { apiUrl } from '@/core/config.js'
import type { OsmPoi } from '@/features/pois/OverpassClient.js'
import { getSupabaseClient } from '@/features/auth/authClient.js'
import { parseChatResponse, type AiChatResponse } from './intentSchema.js'

// Thin client for the KI-Sidecar Edge endpoint (`POST /api/ai`).
//   Phase 1: a short, German plain-text summary of a POI's OSM tags.
//   Phase 2: a chat turn → validated { status, reply, intent }.

export interface ChatTurn {
  readonly role: 'user' | 'assistant'
  readonly content: string
}

/** Bearer header for the logged-in user (used when AI_REQUIRE_AUTH is on). */
async function authHeaders(): Promise<Record<string, string>> {
  try {
    const supabase = getSupabaseClient()
    const token = (await supabase?.auth.getSession())?.data.session?.access_token
    return token ? { Authorization: `Bearer ${token}` } : {}
  } catch {
    return {}
  }
}

/**
 * Sends one chat turn (full history) and returns a validated response. Never
 * throws — transport failures map to a safe `error` status the modal can show.
 */
export async function sendAiChat(messages: readonly ChatTurn[]): Promise<AiChatResponse> {
  try {
    const resp = await fetch(apiUrl('/api/ai'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ task: 'chat', messages }),
    })
    if (!resp.ok) {
      return parseChatResponse({
        status: 'error',
        reply: resp.status === 401
          ? 'Bitte melde dich erneut an, um die KI-Suche zu nutzen.'
          : resp.status === 429
            ? 'Zu viele Anfragen – bitte einen Moment warten.'
            : 'Die KI-Suche ist gerade nicht erreichbar.',
      })
    }
    return parseChatResponse(await resp.json())
  } catch {
    return parseChatResponse({ status: 'error' })
  }
}

/**
 * Loads an AI-generated summary of a POI's tags, or null when the feature is
 * unconfigured, the request fails, the tags yield nothing, or the response is
 * malformed. Callers simply hide the block on null — never throws.
 */
export async function loadPoiSummary(poi: OsmPoi): Promise<string | null> {
  try {
    const resp = await fetch(apiUrl('/api/ai'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ task: 'summarize', poiId: poi.id, tags: poi.tags }),
    })
    if (!resp.ok) return null
    const data = await resp.json() as { summary?: unknown }
    const summary = typeof data.summary === 'string' ? data.summary.trim() : ''
    return summary.length > 0 ? summary : null
  } catch {
    return null
  }
}
