import { describe, it, expect } from 'vitest'
import { buildGpxExport, escapeXml, exportFileName, slugifyFileName, type GpxWaypoint } from './gpxExport.js'
import { parseGpx } from './gpx.js'
import type { LinePoint } from './routeTypes.js'

const points: LinePoint[] = [[50.123456, 7.1], [50.2, 7.234567], [50.3, 7.3]]
const wpt = (over: Partial<GpxWaypoint> = {}): GpxWaypoint => ({
  lat: 50.15, lon: 7.15, name: 'Stellplatz Eifel', type: 'Wohnmobilstellplatz', description: 'km 12,4 · 180 m abseits', ...over,
})
const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml')

describe('buildGpxExport', () => {
  it('writes a GPX 1.1 file with metadata, waypoints and one track', () => {
    const xml = buildGpxExport({ name: 'Eifelrunde', points, waypoints: [wpt(), wpt({ name: 'B', lat: 50.2, lon: 7.2 })] })
    const doc = parse(xml)
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0)
    const root = doc.documentElement
    expect(root.localName).toBe('gpx')
    expect(root.getAttribute('version')).toBe('1.1')
    expect(root.getAttribute('creator')).toBe('Camp Finder')
    expect(root.namespaceURI).toBe('http://www.topografix.com/GPX/1/1')
    expect(doc.querySelector('metadata > name')!.textContent).toBe('Eifelrunde')
    const wpts = [...doc.getElementsByTagName('wpt')]
    expect(wpts).toHaveLength(2)
    expect(wpts[0]!.getAttribute('lat')).toBe('50.15')
    expect(wpts[0]!.getAttribute('lon')).toBe('7.15')
    expect(wpts[0]!.querySelector('name')!.textContent).toBe('Stellplatz Eifel')
    expect(wpts[0]!.querySelector('type')!.textContent).toBe('Wohnmobilstellplatz')
    expect(wpts[0]!.querySelector('desc')!.textContent).toBe('km 12,4 · 180 m abseits')
    expect(doc.getElementsByTagName('trk')).toHaveLength(1)
    expect(doc.getElementsByTagName('trkseg')).toHaveLength(1)
    expect(doc.getElementsByTagName('trkpt')).toHaveLength(3)
  })

  it('follows the schema child order name, desc, type and omits an absent description', () => {
    const doc = parse(buildGpxExport({ name: 'x', points, waypoints: [wpt(), ({ lat: 50.15, lon: 7.15, name: 'n', type: 't' } satisfies GpxWaypoint)] }))
    const [a, b] = [...doc.getElementsByTagName('wpt')]
    expect([...a!.children].map(c => c.localName)).toEqual(['name', 'desc', 'type'])
    expect([...b!.children].map(c => c.localName)).toEqual(['name', 'type'])
  })

  it('escapes untrusted text so it round-trips and cannot inject markup', () => {
    const evil = `Bäckerei <Müller> & Söhne "am Markt" 'x'`
    const xml = buildGpxExport({ name: evil, points, waypoints: [wpt({ name: evil, type: evil, description: evil })] })
    expect(xml).not.toContain('<Müller>')
    const doc = parse(xml)
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0)
    expect(doc.querySelector('wpt > name')!.textContent).toBe(evil)
    expect(doc.querySelector('wpt > desc')!.textContent).toBe(evil)
    expect(doc.querySelector('trk > name')!.textContent).toBe(evil)
    expect(escapeXml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&apos;')
  })

  it('removes characters that are illegal in XML 1.0 but keeps tab/LF/CR', () => {
    const dirty = 'A\u0000B\u0008C\u000BD\u001FE￾F\uD800G\tH\nI'
    expect(escapeXml(dirty)).toBe('ABCDEFG\tH\nI')
    const doc = parse(buildGpxExport({ name: dirty, points, waypoints: [wpt({ name: dirty })] }))
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0)
  })

  it('keeps valid surrogate pairs (emoji)', () => {
    expect(escapeXml('Café ☕ 🚐')).toBe('Café ☕ 🚐')
  })

  it('limits coordinates to 6 decimals', () => {
    const xml = buildGpxExport({ name: 'x', points: [[50.123456789, 7.00000001], [1, 2]], waypoints: [wpt({ lat: 50.9999999999, lon: 7.123456789 })] })
    expect(xml).toContain('<trkpt lat="50.123457" lon="7"/>')
    expect(xml).toContain('<wpt lat="51" lon="7.123457">')
  })

  it('skips waypoints with invalid coordinates', () => {
    const doc = parse(buildGpxExport({ name: 'x', points, waypoints: [wpt({ lat: NaN }), wpt()] }))
    expect(doc.getElementsByTagName('wpt')).toHaveLength(1)
  })

  it('still yields a valid file with the track when there are no waypoints', () => {
    const doc = parse(buildGpxExport({ name: 'Leer', points, waypoints: [] }))
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0)
    expect(doc.getElementsByTagName('wpt')).toHaveLength(0)
    expect(doc.getElementsByTagName('trkpt')).toHaveLength(3)
  })

  it('is deterministic (no timestamps)', () => {
    const input = { name: 'x', points, waypoints: [wpt()] }
    expect(buildGpxExport(input)).toBe(buildGpxExport(input))
    expect(buildGpxExport(input)).not.toMatch(/<time>/)
  })

  it('round trip: parseGpx returns the same name and track points', () => {
    const parsed = parseGpx(buildGpxExport({ name: 'Eifelrunde', points, waypoints: [wpt(), wpt()] }))
    expect(parsed.name).toBe('Eifelrunde')
    expect(parsed.points).toEqual(points)
  })
})

describe('slugifyFileName / exportFileName', () => {
  it('transliterates umlauts and replaces other characters with "-"', () => {
    expect(slugifyFileName('Große Eifel-Runde über Köln')).toBe('Grosse-Eifel-Runde-ueber-Koeln')
    expect(slugifyFileName('Tour: A/B (2024)!')).toBe('Tour-A-B-2024')
    expect(slugifyFileName('Café Zürich')).toBe('Cafe-Zuerich')
  })

  it('trims dashes, caps at 60 characters and falls back to "route"', () => {
    expect(slugifyFileName('--- x ---')).toBe('x')
    const long = slugifyFileName('ab '.repeat(50))
    expect(long.length).toBeLessThanOrEqual(60)
    expect(long.endsWith('-')).toBe(false)
    expect(slugifyFileName('')).toBe('route')
    expect(slugifyFileName('🚐🚐 ../..')).toBe('route')
  })

  it('never lets path or control characters through', () => {
    expect(slugifyFileName('../../etc/passwd\u0000')).toBe('etc-passwd')
  })

  it('appends -orte.gpx', () => {
    expect(exportFileName('Eifelrunde')).toBe('Eifelrunde-orte.gpx')
    expect(exportFileName('')).toBe('route-orte.gpx')
  })
})
