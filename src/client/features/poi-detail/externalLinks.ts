import type { LatLon } from '@/core/geo.js'

/**
 * Google Maps link to the POI. With a name we query "name lat,lon" so Maps
 * resolves to the matching place card (POI selected); coordinates alone just
 * drop a pin. Uses the official Maps URL search API.
 */
export function buildGoogleMapsPoiLink(destination: LatLon, name?: string): string {
  const coords = `${destination.lat},${destination.lon}`
  const query = name && name.trim() ? `${name.trim()} ${coords}` : coords
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}

/**
 * park4night link to the POI. When the OSM element carries a `ref:park4night`
 * tag we deep-link straight to the place detail page; otherwise we build a
 * search link centred on the coordinates so the user lands on the right area.
 */
export function buildPark4nightPoiLink(destination: LatLon, name?: string, park4nightRef?: string): string {
  if (park4nightRef) {
    return `https://park4night.com/lieu/${encodeURIComponent(park4nightRef)}/`
  }
  const params = new URLSearchParams({
    lat: String(destination.lat),
    lng: String(destination.lon),
    z: '15',
  })
  if (name && name.trim()) params.set('q', name.trim())
  return `https://park4night.com/en/search?${params.toString()}`
}

// ── Hand-off to the phone's nav app (destination only; the app decides the rest) ──

export type NavPlatform = 'apple' | 'google'

/** Apple Maps on iOS/iPadOS/macOS, Google Maps everywhere else. */
export function detectNavPlatform(userAgent: string, platform: string): NavPlatform {
  return /iphone|ipad|ipod|macintosh|mac os/i.test(`${userAgent} ${platform}`) ? 'apple' : 'google'
}

/** Directions deeplink with destination only — start and travel mode are left to the nav app. */
export function buildNavLink(to: LatLon, platform?: NavPlatform): string {
  const p = platform
    ?? detectNavPlatform(navigator.userAgent, (navigator as { platform?: string }).platform ?? '')
  const dest = `${to.lat},${to.lon}`
  return p === 'apple'
    ? `https://maps.apple.com/?daddr=${dest}`
    : `https://www.google.com/maps/dir/?api=1&destination=${dest}`
}
