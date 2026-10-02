const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const TIMEOUT_MS = 8_000

export interface NominatimResult {
  readonly lat: string
  readonly lon: string
  readonly display_name: string
}

export interface GeocodeOptions {
  readonly limit?: number
  /** Nominatim viewbox order: west,north,east,south — biases, doesn't restrict. */
  readonly viewbox?: { readonly west: number; readonly north: number; readonly east: number; readonly south: number }
}

/**
 * Geocodes directly from the browser. Nominatim answers the Supabase edge
 * (cloud IPs) with 403, same block as Overpass — so no server proxy here.
 * The browser's Referer identifies the app per Nominatim's usage policy.
 * Errors and non-2xx responses resolve to [] so callers can degrade quietly.
 */
export async function geocode(q: string, opts: GeocodeOptions = {}): Promise<NominatimResult[]> {
  const params = new URLSearchParams({ q, format: 'json', limit: String(opts.limit ?? 6), addressdetails: '0' })
  const vb = opts.viewbox
  if (vb) params.set('viewbox', `${vb.west},${vb.north},${vb.east},${vb.south}`)

  try {
    const res = await fetch(`${NOMINATIM_URL}?${params}`, {
      headers: { 'Accept-Language': 'de,en' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return []
    const data: unknown = await res.json()
    return Array.isArray(data) ? data as NominatimResult[] : []
  } catch {
    return []
  }
}
