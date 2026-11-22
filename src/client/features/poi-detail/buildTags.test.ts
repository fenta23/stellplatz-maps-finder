import { describe, it, expect } from 'vitest'
import { buildTags } from './buildTags.js'
import type { OsmPoi } from '@/features/pois/OverpassClient.js'

const base: OsmPoi = { id: 1, type: 'parking', lat: 0, lon: 0, tags: {} }

describe('buildTags', () => {
  it('always includes type', () => {
    const rows = buildTags(base)
    expect(rows).toContainEqual({ label: 'Filter', value: 'Parkplatz' })
  })

  it('adds opening_hours when present', () => {
    const rows = buildTags({ ...base, tags: { opening_hours: 'Mo-Fr 09:00-18:00' } })
    expect(rows).toContainEqual({ label: 'Öffnungszeiten', value: 'Mo-Fr 09:00-18:00' })
  })

  it('formats parking-specific tags', () => {
    const rows = buildTags({ ...base, tags: { parking: 'multi_storey', lit: 'yes', maxheight: '2.2', capacity: '200' } })
    expect(rows).toContainEqual({ label: 'Parkplatztyp', value: 'Parkhaus' })
    expect(rows).toContainEqual({ label: 'Beleuchtet', value: 'Ja' })
    expect(rows).toContainEqual({ label: 'Max. Höhe', value: '2.2 m' })
    expect(rows).toContainEqual({ label: 'Kapazität', value: '200' })
  })

  it('formats camper/campsite-specific tags', () => {
    const poi: OsmPoi = { id: 2, type: 'campsite', lat: 0, lon: 0, tags: { electricity: 'yes', shower: 'yes', stars: '3' } }
    const rows = buildTags(poi)
    expect(rows).toContainEqual({ label: 'Strom', value: 'Ja' })
    expect(rows).toContainEqual({ label: 'Dusche', value: 'Ja' })
    expect(rows).toContainEqual({ label: 'Sterne', value: '★★★' })
  })

  it('adds link rows for contact info', () => {
    const rows = buildTags({ ...base, tags: { phone: '+49 30 123', email: 'x@y.de', website: 'https://example.com' } })
    expect(rows).toContainEqual({ label: 'Telefon', value: '+49 30 123', href: 'tel:+49 30 123' })
    expect(rows).toContainEqual({ label: 'E-Mail', value: 'x@y.de', href: 'mailto:x@y.de' })
    expect(rows).toContainEqual({ label: 'Website', value: 'Öffnen', href: 'https://example.com' })
  })

  it('builds address from addr:* tags', () => {
    const rows = buildTags({ ...base, tags: { 'addr:street': 'Hauptstr', 'addr:housenumber': '5', 'addr:postcode': '10115', 'addr:city': 'Berlin' } })
    expect(rows).toContainEqual({ label: 'Adresse', value: 'Hauptstr 5, 10115 Berlin' })
  })

  it('skips address when no addr tags', () => {
    const rows = buildTags(base)
    expect(rows.find(r => r.label === 'Adresse')).toBeUndefined()
  })

  it('adds operator and description', () => {
    const rows = buildTags({ ...base, tags: { operator: 'Stadtwerke', description: 'Großer Parkplatz' } })
    expect(rows).toContainEqual({ label: 'Betreiber', value: 'Stadtwerke' })
    expect(rows).toContainEqual({ label: 'Beschreibung', value: 'Großer Parkplatz' })
  })
})
