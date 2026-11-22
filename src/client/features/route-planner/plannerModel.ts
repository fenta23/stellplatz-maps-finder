import type { TravelMode } from '@/core/travelMode.js'
import type { RoutePoint } from '@/features/track/trackTypes.js'
export type PlanRole = 'start' | 'end'

export interface PlanPoint extends RoutePoint {
  readonly label: string
  readonly kind: 'place' | 'gps' | 'map' | 'poi'
}

export interface PlanRequest {
  readonly start: PlanPoint
  readonly end: PlanPoint
  readonly mode: TravelMode
}

/** "Eifel, Rheinland-Pfalz, Deutschland" → "Eifel". Leerer Anfang → ganzer Name. */
export function shortPlaceLabel(displayName: string): string {
  const head = displayName.split(',')[0]?.trim() ?? ''
  return head || displayName
}

/** Profil → Verkehrsmittel. Reihenfolge = Priorität (Auto vor Rad vor Fuß). */
const PROFILE_MODES: ReadonlyArray<readonly [string, TravelMode]> = [
  ['camper', 'car'],
  ['cyclist', 'bike'],
  ['hiker', 'foot'],
]

/** Gespeicherte Wahl gewinnt; sonst aus den Profilen, ohne/unbekannt → Auto. */
export function defaultTravelMode(stored: TravelMode | null, profiles: readonly string[]): TravelMode {
  if (stored) return stored
  for (const [profile, mode] of PROFILE_MODES) {
    if (profiles.includes(profile)) return mode
  }
  return 'car'
}
