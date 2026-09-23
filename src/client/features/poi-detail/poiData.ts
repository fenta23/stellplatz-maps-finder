import { apiUrl } from '@/core/config.js'
import type { OsmPoi } from '@/features/pois/OverpassClient.js'
import type { PoiImage } from './imageGallery.js'
import type { NearbyItem } from './PoiDetailPanel.js'
import type { OsmNote } from './noteRenderer.js'
import { fetchNearby } from './nearbyClient.js'

// ── Wikimedia Commons (pure helpers) ──────────────────────────────────────────

export function wikimediaTitle(tag: string): string {
  return tag.startsWith('File:') || tag.startsWith('Category:') ? tag : `File:${tag}`
}

export function wikimediaApiUrl(title: string): string {
  return `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=imageinfo&iiprop=url&iiurlwidth=400&format=json&origin=*`
}

interface WikimediaResponse {
  query?: { pages?: Record<string, { imageinfo?: Array<{ url: string; thumburl: string }> }> }
}

/** Resolves an OSM `wikimedia_commons` tag to a thumbnail image, or null. */
export async function resolveWikimediaImage(tag: string): Promise<PoiImage | null> {
  const title = wikimediaTitle(tag)
  try {
    const resp = await fetch(wikimediaApiUrl(title), { signal: AbortSignal.timeout(5000) })
    const data = await resp.json() as WikimediaResponse
    const info = Object.values(data.query?.pages ?? {})[0]?.imageinfo?.[0]
    if (!info?.thumburl) return null
    return {
      src: info.thumburl,
      link: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`,
      caption: 'Wikimedia Commons',
    }
  } catch {
    return null
  }
}

/** OSM `image` tag + resolved Wikimedia image (the fast, local-ish sources). */
export async function collectTagImages(poi: OsmPoi): Promise<PoiImage[]> {
  const images: PoiImage[] = []
  if (poi.tags['image']) images.push({ src: poi.tags['image'], caption: 'OSM' })
  const wmc = poi.tags['wikimedia_commons']
  if (wmc) {
    const resolved = await resolveWikimediaImage(wmc)
    if (resolved) images.push(resolved)
  }
  return images
}

// ── Proxied endpoints ─────────────────────────────────────────────────────────

type LatLon = { lat: number; lon: number }

async function getJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const resp = await fetch(apiUrl(path))
    if (!resp.ok) return fallback
    return await resp.json() as T
  } catch {
    return fallback
  }
}

export const loadMapillaryImages = (p: LatLon): Promise<PoiImage[]> =>
  getJson(`/api/mapillary?lat=${p.lat}&lon=${p.lon}`, [] as PoiImage[])

export const loadNearby = (p: LatLon): Promise<NearbyItem[]> =>
  fetchNearby(p.lat, p.lon)

export const loadNotes = (p: LatLon): Promise<OsmNote[]> =>
  getJson(`/api/notes?lat=${p.lat}&lon=${p.lon}`, [] as OsmNote[])
