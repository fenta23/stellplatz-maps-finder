/**
 * Verkehrsmittel (Glossar: „Verkehrsmittel“) / travel mode: the one shared type for route
 * planning, planned routes, the AI intent and their labels. Shared kernel – any slice may import it.
 */
export type TravelMode = 'foot' | 'bike' | 'car'

export const TRAVEL_MODES: readonly TravelMode[] = ['foot', 'bike', 'car']

export function isTravelMode(v: unknown): v is TravelMode {
  return v === 'foot' || v === 'bike' || v === 'car'
}

/** German display names, e.g. in route names and the AI result card. */
export const TRAVEL_MODE_LABEL: Readonly<Record<TravelMode, string>> = {
  foot: 'Fuß',
  bike: 'Rad',
  car: 'Auto',
}
