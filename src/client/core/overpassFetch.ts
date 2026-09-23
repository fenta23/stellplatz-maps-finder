import { OVERPASS_ENDPOINTS } from './overpassEndpoints.js'

const MIRROR_TIMEOUT_MS = 10_000

/**
 * Tries each Overpass mirror in turn, first success wins. A caller-supplied
 * `signal` (e.g. the map moved again) aborts the whole attempt immediately;
 * a single mirror's own timeout or error just falls through to the next one.
 */
export async function fetchFromOverpassMirrors(query: string, signal?: AbortSignal): Promise<unknown> {
  const body = `data=${encodeURIComponent(query)}`
  let lastError = new Error('Overpass error: no endpoints configured')

  for (const url of OVERPASS_ENDPOINTS) {
    const timeoutSignal = AbortSignal.timeout(MIRROR_TIMEOUT_MS)
    const attemptSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: attemptSignal,
      })
      if (!res.ok) {
        lastError = new Error(`Overpass error: ${res.status} ${res.statusText}`)
        continue
      }
      return await res.json()
    } catch (err) {
      // The caller cancelled (e.g. map panned again) — stop retrying and
      // propagate the AbortError so the caller can swallow it silently.
      if (signal?.aborted) throw err
      lastError = err instanceof Error ? err : new Error(String(err))
    }
  }
  throw lastError
}
