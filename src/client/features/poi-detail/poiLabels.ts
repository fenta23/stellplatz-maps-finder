import { coalesce } from '@shared/fp.js'
import type { OsmPoi } from '@/features/pois/OverpassClient.js'

export const TYPE_LABELS: Record<OsmPoi['type'], string> = {
  parking: 'Parkplatz',
  camper: 'Camper-Stellplatz',
  campsite: 'Campingplatz',
  dump: 'Entsorgungsstation',
  water: 'Wasserstelle',
}

export const typeLabel = (type: OsmPoi['type']): string => coalesce('Ort')(TYPE_LABELS[type])

export const ACCESS_LABELS: Record<string, string> = {
  public: 'Öffentlich', private: 'Privat', permissive: 'Erlaubt',
  customers: 'Nur Kunden', yes: 'Ja', no: 'Nein',
}
export const PARKING_LABELS: Record<string, string> = {
  surface: 'Außenparkplatz', underground: 'Tiefgarage',
  multi_storey: 'Parkhaus', rooftop: 'Dachparkplatz', street_side: 'Straßenrand',
}
export const SURFACE_LABELS: Record<string, string> = {
  paved: 'Asphalt/Pflaster', unpaved: 'Unbefestigt', gravel: 'Schotter',
  sand: 'Sand', grass: 'Rasen', dirt: 'Erde',
}
export const WIFI_LABELS: Record<string, string> = {
  wifi: 'WLAN', wired: 'Kabel', yes: 'Ja', no: 'Nein',
}
export const DOG_LABELS: Record<string, string> = {
  yes: 'Erlaubt', no: 'Nicht erlaubt', leashed: 'An der Leine', unleashed: 'Frei',
}

export function bool(v: string | undefined): string | undefined {
  return v === 'yes' ? 'Ja' : v === 'no' ? 'Nein' : v === 'limited' ? 'Begrenzt' : v
}

export function formatMeters(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`
}

const deKm = (km: number): string => km.toFixed(1).replace('.', ',')

/** Position of a POI along an imported route, e.g. "Route: km 12,4 · noch 73,6 km · 180 m abseits". */
export function trackInfoText(info: { readonly kmAlong: number; readonly kmToEnd: number; readonly offsetM: number }): string {
  const off = info.offsetM
  const offset = off < 10 ? 'an der Route'
    : off < 1000 ? `${Math.round(off)} m abseits`
    : `${deKm(off / 1000)} km abseits`
  return `Route: km ${deKm(info.kmAlong)} · noch ${deKm(info.kmToEnd)} km · ${offset}`
}

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function safeUrl(url: string): string {
  try {
    const u = new URL(url)
    return ['http:', 'https:', 'tel:', 'mailto:'].includes(u.protocol) ? url : '#'
  } catch {
    return '#'
  }
}
