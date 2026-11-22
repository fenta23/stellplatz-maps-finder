// GPX import: turns the text of a .gpx file into an ImportedRoute.
// Namespace-agnostic (GPX 1.0/1.1, any prefix) so files from Komoot, Garmin
// and Outdooractive all work.

import { RouteImportError } from './routeErrors.js'
import { MAX_FILE_BYTES, type ImportedRoute, type LinePoint } from './routeTypes.js'

function elementsNamed(root: Document | Element, localName: string): Element[] {
  return Array.from(root.getElementsByTagNameNS('*', localName))
}

function childNamed(parent: Element, localName: string): Element | undefined {
  return Array.from(parent.children).find((c) => c.localName === localName)
}

function readCoord(el: Element, attr: string, limit: number): number | null {
  const raw = el.getAttribute(attr)
  if (raw === null || raw.trim() === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || Math.abs(n) > limit) return null
  return n
}

function readPoints(doc: Document, localName: string): LinePoint[] {
  const points: LinePoint[] = []
  for (const el of elementsNamed(doc, localName)) {
    const lat = readCoord(el, 'lat', 90)
    const lon = readCoord(el, 'lon', 180)
    if (lat !== null && lon !== null) points.push([lat, lon])
  }
  return points
}

function textOf(el: Element | undefined): string {
  return el?.textContent?.trim() ?? ''
}

function readName(doc: Document, fallbackName?: string): string {
  const trk = elementsNamed(doc, 'trk')[0]
  const trkName = trk ? textOf(childNamed(trk, 'name')) : ''
  if (trkName) return trkName
  const metadata = childNamed(doc.documentElement, 'metadata')
  const metaName = metadata ? textOf(childNamed(metadata, 'name')) : ''
  if (metaName) return metaName
  return fallbackName?.trim() || 'Route'
}

export function parseGpx(xml: string, fallbackName?: string): ImportedRoute {
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(xml, 'application/xml')
  } catch {
    throw new RouteImportError('invalid-file', 'xml')
  }
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new RouteImportError('invalid-file', 'xml')
  }
  if (doc.documentElement?.localName !== 'gpx') {
    throw new RouteImportError('invalid-file', 'no gpx root')
  }

  let points = readPoints(doc, 'trkpt')
  if (points.length === 0) points = readPoints(doc, 'rtept')
  if (points.length < 2) throw new RouteImportError('no-points')

  return { name: readName(doc, fallbackName), source: 'gpx', points }
}

export async function readGpxFile(file: File): Promise<ImportedRoute> {
  if (file.size > MAX_FILE_BYTES) throw new RouteImportError('file-too-large')
  const text = await file.text()
  return parseGpx(text, file.name.replace(/\.gpx$/i, ''))
}
