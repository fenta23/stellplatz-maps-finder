// Komoot import via the unofficial public tour endpoint. One simple GET (no
// custom headers → no CORS preflight). Kill switch below in case Komoot
// changes or blocks it; the GPX upload stays the reliable path.

import { TrackImportError } from './trackErrors.js'
import type { ImportedTrack, TrackPoint } from './trackTypes.js'

export const KOMOOT_IMPORT_ENABLED = true

const API_BASE = 'https://api.komoot.de/v007/tours/'
const DEFAULT_TIMEOUT_MS = 15_000
const HOSTS: ReadonlySet<string> = new Set(['komoot.com', 'komoot.de'])
const LOCALE = /^[a-z]{2}(-[a-z]{2})?$/i
const UNSUPPORTED_SEGMENTS: ReadonlySet<string> = new Set([
  'smarttour',
  'invite-tour',
  'collection',
  'highlight',
  'user',
])

export interface KomootRef {
  readonly tourId: string
  readonly shareToken?: string
}

/** Parsed Komoot URL: path segments without locale prefix plus query. */
function parseKomootUrl(input: string): { segments: string[]; params: URLSearchParams } | null {
  const text = input.trim()
  if (!text || /\s/.test(text)) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  if (!HOSTS.has(host)) return null
  const segments = url.pathname.split('/').filter((s) => s !== '')
  if (segments[0] !== undefined && LOCALE.test(segments[0])) segments.shift()
  return { segments, params: url.searchParams }
}

export function parseKomootLink(input: string): KomootRef | null {
  const parsed = parseKomootUrl(input)
  if (!parsed) return null
  const [first, id] = parsed.segments
  if (first !== 'tour' || !id || !/^\d+$/.test(id)) return null
  const shareToken = parsed.params.get('share_token')
  return shareToken ? { tourId: id, shareToken } : { tourId: id }
}

export function isUnsupportedKomootLink(input: string): boolean {
  const parsed = parseKomootUrl(input)
  return parsed !== null && parsed.segments[0] !== undefined && UNSUPPORTED_SEGMENTS.has(parsed.segments[0])
}

function toPoints(body: unknown): TrackPoint[] | null {
  const items = (body as { _embedded?: { coordinates?: { items?: unknown } } } | null)?._embedded?.coordinates?.items
  if (!Array.isArray(items)) return null
  const points: TrackPoint[] = []
  for (const it of items) {
    const lat = (it as { lat?: unknown } | null)?.lat
    const lng = (it as { lng?: unknown } | null)?.lng
    if (typeof lat !== 'number' || typeof lng !== 'number') continue
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue
    points.push([lat, lng])
  }
  return points
}

export async function fetchKomootTour(
  ref: KomootRef,
  fetchFn: typeof fetch = (...a) => fetch(...a),
  signal?: AbortSignal,
  options: { enabled?: boolean; timeoutMs?: number } = {},
): Promise<ImportedTrack> {
  const { enabled = KOMOOT_IMPORT_ENABLED, timeoutMs = DEFAULT_TIMEOUT_MS } = options
  if (!enabled) throw new TrackImportError('komoot-disabled')

  let url = `${API_BASE}${encodeURIComponent(ref.tourId)}?_embedded=coordinates`
  if (ref.shareToken) url += `&share_token=${encodeURIComponent(ref.shareToken)}`

  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal

  let body: unknown
  try {
    const res = await fetchFn(url, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: combined,
    })
    if (res.status === 401 || res.status === 403) throw new TrackImportError('komoot-private')
    if (res.status === 404) throw new TrackImportError('komoot-not-found')
    if (!res.ok) throw new TrackImportError('komoot-unreachable', String(res.status))
    body = await res.json()
  } catch (err) {
    if (signal?.aborted) throw err
    if (err instanceof TrackImportError) throw err
    throw new TrackImportError('komoot-unreachable', err instanceof Error ? err.message : undefined)
  }

  const points = toPoints(body)
  if (!points) throw new TrackImportError('komoot-unreachable', 'no coordinates')
  if (points.length < 2) throw new TrackImportError('no-points')

  const rawName = (body as { name?: unknown }).name
  const name = typeof rawName === 'string' && rawName.trim() ? rawName.trim() : `Komoot-Tour ${ref.tourId}`
  return { name, source: 'komoot', points }
}

export async function importFromKomootLink(
  input: string,
  fetchFn?: typeof fetch,
  signal?: AbortSignal,
): Promise<ImportedTrack> {
  if (isUnsupportedKomootLink(input)) throw new TrackImportError('komoot-link-unsupported')
  const ref = parseKomootLink(input)
  if (!ref) throw new TrackImportError('komoot-link-invalid')
  return fetchKomootTour(ref, fetchFn, signal)
}
