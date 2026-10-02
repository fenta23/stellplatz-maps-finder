// API base URL resolution.
//
// Web + PWA: served same-origin by Express → base is empty, calls stay relative
// (`/api/...`). Packaged builds (Capacitor) run from a non-HTTP origin
// (`capacitor://`, `file://`), so relative calls would miss the server — set
// VITE_API_BASE to the deployed origin (e.g. https://stellplatz-maps-finder.onrender.com)
// at build time and every call is rewritten to an absolute URL.

/** Joins an API base with a path, tolerating a trailing slash on the base. */
export function joinApiUrl(base: string, path: string): string {
  return base.replace(/\/+$/, '') + path
}

function readEnv(key: string): string {
  // Vite statically replaces import.meta.env.VITE_* at build time.
  // Falls VITE_API_BASE gesetzt ist (z. B. via .env), wird absolut retourniert.
  try {
    return (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[key] || ''
  } catch {
    return ''
  }
}

export const API_BASE = readEnv('VITE_API_BASE')

/** Resolve an API path (e.g. `/api/overpass`) to the right URL for this build target. */
export const apiUrl = (path: string): string => joinApiUrl(API_BASE, path)

// Statische POI-Kacheln (eingebaute Filter), wöchentlich aus Geofabrik gebaut und
// auf GitHub Pages im Daten-Repo gehostet. Lokal z. B. `VITE_POI_TILES_BASE=http://localhost:3000`.
export const DEFAULT_POI_TILES_BASE = 'https://fenta23.github.io/camp-finder-data'
export const POI_TILES_BASE = readEnv('VITE_POI_TILES_BASE') || DEFAULT_POI_TILES_BASE
