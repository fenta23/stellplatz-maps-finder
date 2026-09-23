// Public Overpass mirrors, queried directly from the browser.
//
// Server-side calls (Supabase Edge Function, GitHub Actions) to these same
// mirrors are rejected within ~100ms (403/406) — the mirrors block
// cloud/datacenter egress ranges. Browser/residential traffic is unaffected
// (verified live against all three), so the client talks to them directly
// instead of via the backend proxy. See CHANGELOG for the incident.
export const OVERPASS_ENDPOINTS = [
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://osm.hpi.de/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
] as const
