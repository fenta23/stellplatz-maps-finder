import type { GeocodeOptions, NominatimResult } from '@/core/nominatim.js'
import type { PlaceSuggestion } from '@/core/PlaceField.js'

export interface PlaceSuggestDeps {
  readonly geocode: (q: string, opts?: GeocodeOptions) => Promise<NominatimResult[]>
  /** Bias for the place search, e.g. the visible map area. */
  readonly getViewbox?: (() => GeocodeOptions['viewbox'] | undefined) | undefined
  readonly limit: number
}

/** Place suggestions for a `PlaceField`: geocoder hits, biased to the viewbox, without unusable coordinates. */
export function createPlaceSuggest(deps: PlaceSuggestDeps): (query: string) => Promise<readonly PlaceSuggestion[]> {
  return async query => {
    const viewbox = deps.getViewbox?.()
    const hits = await deps.geocode(query, { limit: deps.limit, ...(viewbox ? { viewbox } : {}) })
    return hits.map(h => ({ label: h.display_name, lat: Number(h.lat), lon: Number(h.lon) }))
      .filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon))
  }
}
