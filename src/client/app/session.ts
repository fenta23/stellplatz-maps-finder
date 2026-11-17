import type { OsmPoi } from '@/features/pois/OverpassClient.js'

/** Mutable per-session UI state — passed explicitly to controllers instead of
 *  living as scattered closure `let`s. */
export interface Session {
  userPos: { lat: number; lon: number } | null
  selectedPoi: OsmPoi | null
}

export function createSession(userPos: { lat: number; lon: number } | null): Session {
  return { userPos, selectedPoi: null }
}
