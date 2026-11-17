// GPX export of the places along the route (for bike computers, Komoot, Garmin).
// Pure: string in, string out. Everything from OSM tags, file names or Komoot
// is untrusted text and is escaped / sanitised for XML 1.0.

import type { TrackPoint } from './trackTypes.js'

export interface GpxWaypoint {
  readonly lat: number
  readonly lon: number
  readonly name: string
  /** Category label. */
  readonly type: string
  readonly description?: string
}

export interface GpxExportInput {
  readonly name: string
  readonly points: readonly TrackPoint[]
  readonly waypoints: readonly GpxWaypoint[]
}

// Characters not allowed in XML 1.0: control chars except tab/LF/CR, U+FFFE/FFFF, lone surrogates.
// eslint-disable-next-line no-control-regex
const ILLEGAL_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
}

export function escapeXml(text: string): string {
  return text.replace(ILLEGAL_XML, '').replace(/[&<>"']/g, c => ESCAPES[c]!)
}

/** At most 6 decimals (~0.1 m), no trailing zeros. */
const coord = (n: number): string => String(Number(n.toFixed(6)))

const isCoord = (lat: number, lon: number) =>
  Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180

export function buildGpxExport(input: GpxExportInput): string {
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Camp Finder" xmlns="http://www.topografix.com/GPX/1/1">',
    `  <metadata><name>${escapeXml(input.name)}</name></metadata>`,
  ]
  for (const w of input.waypoints) {
    if (!isCoord(w.lat, w.lon)) continue
    // Child order follows the GPX 1.1 schema: name, desc, type.
    const desc = w.description ? `<desc>${escapeXml(w.description)}</desc>` : ''
    out.push(`  <wpt lat="${coord(w.lat)}" lon="${coord(w.lon)}"><name>${escapeXml(w.name)}</name>${desc}<type>${escapeXml(w.type)}</type></wpt>`)
  }
  out.push('  <trk>', `    <name>${escapeXml(input.name)}</name>`, '    <trkseg>')
  for (const [lat, lon] of input.points) {
    if (isCoord(lat, lon)) out.push(`      <trkpt lat="${coord(lat)}" lon="${coord(lon)}"/>`)
  }
  out.push('    </trkseg>', '  </trk>', '</gpx>', '')
  return out.join('\n')
}

const TRANSLITERATIONS: Readonly<Record<string, string>> = {
  'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss', 'Ä': 'Ae', 'Ö': 'Oe', 'Ü': 'Ue',
}
const MAX_SLUG = 60

/** ASCII file-name stem: umlauts transliterated, other runs of non-alphanumerics → "-", trimmed, ≤ 60 chars, fallback "route". */
export function slugifyFileName(name: string): string {
  const slug = name
    .replace(/[äöüßÄÖÜ]/g, c => TRANSLITERATIONS[c]!)
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/g, '')
  return slug || 'route'
}

export const exportFileName = (routeName: string): string => `${slugifyFileName(routeName)}-orte.gpx`
