import {
  DEFAULT_FILTERS, FILTER_COLORS, FILTER_ICONS, isValidSelector,
  type FilterDef, type OsmSelector, type OsmElementKind, type TagCondition,
} from '@/features/filters/filterModel.js'
import { isTravelMode, type TravelMode } from '@/features/route-planner/plannerModel.js'

// Validation of the AI chat response. This is the SECURITY layer of the
// scope-guard: whatever the model emits, only values that survive these checks
// can ever touch the map. A jailbroken model can at most set known filters.

export type AiStatus = 'clarify' | 'ready' | 'offtopic' | 'limit' | 'error'

export interface AiRouteIntent {
  /** Ortsname; null = eigener Standort. */
  readonly from: string | null
  readonly to: string
  readonly mode: TravelMode | null
}

export interface AiIntent {
  readonly place: string | null
  readonly enableFilters: readonly string[]
  readonly adHocFilters: readonly FilterDef[]
  readonly route: AiRouteIntent | null
}

export interface AiChatResponse {
  readonly status: AiStatus
  readonly reply: string
  readonly intent: AiIntent | null
}

/** Built-in OSM filter ids the AI is allowed to enable — the allowlist. */
export const KNOWN_FILTER_IDS: readonly string[] =
  DEFAULT_FILTERS.filter(f => f.kind === 'osm').map(f => f.id)

const ALL_ELEMENTS: readonly OsmElementKind[] = ['node', 'way', 'relation']
const MAX_ADHOC = 4
const STATUSES: ReadonlySet<string> = new Set(['clarify', 'ready', 'offtopic', 'limit', 'error'])

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null
}

function slug(name: string): string {
  return name.toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'filter'
}

function validateSelector(raw: unknown): OsmSelector | null {
  const r = asRecord(raw)
  if (!r) return null

  const elementsRaw = Array.isArray(r['elements']) ? r['elements'] : []
  const elements = ALL_ELEMENTS.filter(e => elementsRaw.includes(e))
  const els: readonly OsmElementKind[] = elements.length > 0 ? elements : ALL_ELEMENTS

  const tagsRaw = Array.isArray(r['tags']) ? r['tags'] : []
  const tags: TagCondition[] = []
  for (const t of tagsRaw.slice(0, 6)) {
    const tr = asRecord(t)
    if (!tr) continue
    const key = typeof tr['key'] === 'string' ? tr['key'] : ''
    const value = typeof tr['value'] === 'string' ? tr['value'] : ''
    if (!key) continue
    tags.push(tr['negate'] === true ? { key, value, negate: true } : { key, value })
  }

  const sel: OsmSelector = { elements: els, tags }
  return isValidSelector(sel) ? sel : null
}

function buildAdHocFilter(raw: unknown, index: number): FilterDef | null {
  const r = asRecord(raw)
  if (!r) return null
  const name = typeof r['name'] === 'string' ? r['name'].trim() : ''
  if (!name) return null

  const iconId = typeof r['iconId'] === 'string' && FILTER_ICONS.some(i => i.id === r['iconId'])
    ? r['iconId'] : 'pin'

  const selectorsRaw = Array.isArray(r['selectors']) ? r['selectors'] : []
  const selectors = selectorsRaw.map(validateSelector).filter((s): s is OsmSelector => s !== null)
  if (selectors.length === 0) return null

  return {
    id: `ai:${slug(name)}`,
    name,
    iconId,
    color: FILTER_COLORS[index % FILTER_COLORS.length]!,
    enabled: true,
    kind: 'osm',
    builtin: false,
    order: 100,
    selectors,
  }
}

function trimmedOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** Validate the optional route wish; null when missing or unusable. */
export function validateRoute(raw: unknown): AiRouteIntent | null {
  const r = asRecord(raw)
  if (!r) return null
  const to = trimmedOrNull(r['to'])
  if (!to) return null
  const from = trimmedOrNull(r['from'])
  if (from && from.toLowerCase() === to.toLowerCase()) return null
  const mode = isTravelMode(r['mode']) ? r['mode'] : null
  return { from, to, mode }
}

/** Validate a raw intent object; returns a clean AiIntent (possibly empty) or null. */
export function validateIntent(raw: unknown): AiIntent | null {
  const r = asRecord(raw)
  if (!r) return null

  const place = trimmedOrNull(r['place'])

  const enableRaw = Array.isArray(r['enableFilters']) ? r['enableFilters'] : []
  const enableFilters = [...new Set(
    enableRaw.filter((id): id is string => typeof id === 'string' && KNOWN_FILTER_IDS.includes(id)),
  )]

  const adHocRaw = Array.isArray(r['adHocFilters']) ? r['adHocFilters'] : []
  const adHocFilters = adHocRaw
    .slice(0, MAX_ADHOC)
    .map((f, i) => buildAdHocFilter(f, i))
    .filter((f): f is FilterDef => f !== null)

  const route = validateRoute(r['route'])

  return { place, enableFilters, adHocFilters, route }
}

/** True when an intent actually does something to the map. */
export function intentHasActions(intent: AiIntent | null): boolean {
  if (!intent) return false
  return intent.place !== null ||
    intent.enableFilters.length > 0 ||
    intent.adHocFilters.length > 0 ||
    intent.route !== null
}

/** Normalise a raw model/edge response into a safe AiChatResponse. */
export function parseChatResponse(raw: unknown): AiChatResponse {
  const r = asRecord(raw) ?? {}
  const rawStatus = typeof r['status'] === 'string' && STATUSES.has(r['status']) ? r['status'] as AiStatus : 'clarify'
  const reply = typeof r['reply'] === 'string' && r['reply'].trim()
    ? r['reply'].trim()
    : fallbackReply(rawStatus)

  if (rawStatus !== 'ready') return { status: rawStatus, reply, intent: null }

  const intent = validateIntent(r['intent'])
  // "ready" with nothing actionable is a dead end → treat as a clarify prompt.
  if (!intentHasActions(intent)) {
    return { status: 'clarify', reply, intent: null }
  }
  return { status: 'ready', reply, intent }
}

function fallbackReply(status: AiStatus): string {
  switch (status) {
    case 'offtopic': return 'Ich helfe nur beim Finden von Orten auf der Karte. Wonach suchst du?'
    case 'limit': return 'Frage-Limit erreicht – bitte starte die Suche neu.'
    case 'error': return 'Die KI-Suche ist gerade nicht erreichbar.'
    default: return 'Kannst du das etwas genauer beschreiben?'
  }
}
