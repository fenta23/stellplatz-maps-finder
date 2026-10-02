import type { CustomPoi, CustomPoiInput } from '@/features/custom-pois/CustomPoi.js'
import { generateCustomId } from '@/features/custom-pois/CustomPoi.js'
import type { ICustomPoiStore } from '@/features/custom-pois/CustomPoiStore.js'

// ── GeoJSON parser (Google Maps Takeout: "Meine Orte mit Beschriftungen") ─────

interface GmapsFeature {
  geometry?: { coordinates?: [number, number]; type?: string }
  properties?: { name?: string; address?: string }
  type?: string
}

interface GmapsDoc {
  features?: unknown
  type?: string
}

export interface ImportResult {
  readonly imported: number
  readonly geocoded?: number
  readonly skipped?: number
}

function parseAddress(address: string): { street?: string; city?: string } {
  const parts = address.split(',').map(s => s.trim()).filter(Boolean)
  if (parts.length >= 2) {
    const city = parts[parts.length - 2]
    const street = parts.slice(0, -2).join(', ') || undefined
    return { street: street || parts[0], city }
  }
  return { street: address || undefined }
}

function isValidLon(v: unknown): v is number {
  return typeof v === 'number' && isFinite(v) && v >= -180 && v <= 180
}
function isValidLat(v: unknown): v is number {
  return typeof v === 'number' && isFinite(v) && v >= -90 && v <= 90
}

function featureToPoiInput(f: GmapsFeature): CustomPoiInput | null {
  const coords = f.geometry?.coordinates
  if (!coords || !isValidLon(coords[0]) || !isValidLat(coords[1])) return null
  const name = (f.properties?.name ?? 'Unbenannter Ort').trim() || 'Unbenannter Ort'
  const addr = parseAddress(f.properties?.address ?? '')
  return { iconId: 'pin', lat: coords[1], lon: coords[0], name, street: addr.street, city: addr.city }
}

function toPoi(input: CustomPoiInput): CustomPoi {
  const now = Date.now()
  return { id: generateCustomId(), ...input, createdAt: now, updatedAt: now }
}

export function parseGoogleMapsJson(json: string): CustomPoi[] {
  let doc: unknown
  try { doc = JSON.parse(json) } catch { return [] }
  if (!doc || typeof doc !== 'object') return []
  const d = doc as GmapsDoc
  const features: unknown[] = Array.isArray(d.features) ? d.features : []
  const pois: CustomPoi[] = []
  for (const f of features) {
    if (!f || typeof f !== 'object') continue
    const input = featureToPoiInput(f as GmapsFeature)
    if (input) pois.push(toPoi(input))
  }
  return pois
}

// ── CSV parser (Google Maps Takeout: "Gespeichert" → Gespeicherte Orte.csv) ────

interface CsvRow {
  readonly name: string
  readonly note: string
  readonly url: string
}

interface GeocodeItem {
  readonly name: string
  readonly note: string
}

const SEARCH_URL_RE = /\/search\/(-?\d+\.?\d*),(-?\d+\.?\d*)/
const PLACE_NAME_RE = /\/place\/([^/@]+)/

function parseCsvField(text: string): string {
  return text.trim().replace(/^"(.*)"$/s, (_, g) => g.replace(/""/g, '"')).trim()
}

function parseCsvLine(line: string): string[] {
  const cols: string[] = []
  let current = ''
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!
    if (inQuote) {
      if (c === '"') {
        if (line[i + 1] === '"') { current += '"'; i++ }
        else inQuote = false
      } else { current += c }
    } else if (c === '"') {
      inQuote = true
    } else if (c === ',') {
      cols.push(current.trim())
      current = ''
    } else {
      current += c
    }
  }
  cols.push(current.trim())
  return cols
}

function parseCsv(text: string): CsvRow[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter(l => l.trim())
  if (lines.length < 2) return []
  const rows: CsvRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]!)
    if (cols.length < 3) continue
    const name = cols[0]?.trim()
    const url = cols[2]?.trim()
    if (!name || !url) continue
    const note = cols[1]?.trim() ?? ''
    rows.push({ name, note, url })
  }
  return rows
}

function parseSearchUrl(url: string): { lat: number; lon: number } | null {
  const m = url.match(SEARCH_URL_RE)
  if (!m) return null
  const lat = parseFloat(m[1]!)
  const lon = parseFloat(m[2]!)
  if (!isValidLat(lat) || !isValidLon(lon)) return null
  return { lat, lon }
}

function parsePlaceUrl(url: string): string | null {
  const m = url.match(PLACE_NAME_RE)
  if (!m) return null
  return decodeURIComponent(m[1]!).replace(/\+/g, ' ').trim() || null
}

export function parseGoogleMapsCsv(text: string): {
  readonly instant: CustomPoi[]
  readonly geocodeQueue: GeocodeItem[]
} {
  const rows = parseCsv(text)
  const instant: CustomPoi[] = []
  const geocodeQueue: GeocodeItem[] = []
  for (const row of rows) {
    const coords = parseSearchUrl(row.url)
    if (coords) {
      instant.push(toPoi({ iconId: 'pin', lat: coords.lat, lon: coords.lon, name: row.name, description: row.note || undefined }))
    } else {
      const placeName = parsePlaceUrl(row.url)
      if (placeName) {
        geocodeQueue.push({ name: placeName, note: row.note })
      }
    }
  }
  return { instant, geocodeQueue }
}

// ── Geocoding ──────────────────────────────────────────────────────────────────

export interface Geocoder {
  geocode(name: string): Promise<{ lat: number; lon: number } | null>
}

// ── Unified import ─────────────────────────────────────────────────────────────

export interface ImportOptions {
  readonly onProgress?: (msg: string) => void
  readonly geocoder?: Geocoder
}

export function importGoogleMapsFile(
  file: File,
  store: ICustomPoiStore,
  opts: ImportOptions = {},
): Promise<ImportResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const text = reader.result as string
      void (async () => {
        const isCsv = file.name.toLowerCase().endsWith('.csv')
        if (isCsv) {
          const { instant, geocodeQueue } = parseGoogleMapsCsv(text)
          let imported = 0
          let geocoded = 0
          let skipped = 0

          if (instant.length > 0) {
            store.addMany(instant)
            imported += instant.length
          }

          if (geocodeQueue.length > 0 && opts.geocoder) {
            opts.onProgress?.(`Geokodiere ${geocodeQueue.length} Orte…`)
            for (let i = 0; i < geocodeQueue.length; i++) {
              const item = geocodeQueue[i]!
              const coords = await opts.geocoder.geocode(item.name)
              if (coords) {
                store.addMany([toPoi({ iconId: 'pin', lat: coords.lat, lon: coords.lon, name: item.name, description: item.note || undefined })])
                geocoded++
              } else {
                skipped++
              }
              if (i % 5 === 0 || i === geocodeQueue.length - 1) {
                opts.onProgress?.(`${imported + geocoded} von ${instant.length + geocodeQueue.length} importiert…`)
              }
              // Rate-limit: ~1 req/s to respect Nominatim
              if (i < geocodeQueue.length - 1) {
                await new Promise(r => setTimeout(r, 1100))
              }
            }
          } else if (geocodeQueue.length > 0 && !opts.geocoder) {
            skipped = geocodeQueue.length
          }

          const total = imported + geocoded
          if (total === 0 && skipped > 0) {
            return reject(new Error(`Keine Orte mit Koordinaten gefunden — ${skipped} Orte benötigen Geokodierung (nicht verfügbar)`))
          }
          if (total === 0) {
            return reject(new Error('Keine gültigen Orte in der Datei gefunden'))
          }
          resolve({ imported: total, geocoded, skipped })
        } else {
          const pois = parseGoogleMapsJson(text)
          if (pois.length === 0) {
            return reject(new Error('Keine gültigen Orte in der Datei gefunden'))
          }
          store.addMany(pois)
          resolve({ imported: pois.length })
        }
      })().catch(reject)
    }
    reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden'))
    reader.readAsText(file)
  })
}
