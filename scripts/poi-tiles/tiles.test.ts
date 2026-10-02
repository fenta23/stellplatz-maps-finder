import { describe, it, expect } from 'vitest'
import { DEFAULT_FILTERS } from '../../src/client/features/filters/filterModel.js'
import {
  belowMinimum, bboxCenter, buildManifest, cleanTags, layerFor, osmiumExpressions,
  parseUniqueId, placeFeature, tileKey,
} from './tiles.js'

describe('osmiumExpressions', () => {
  const exprs = osmiumExpressions(DEFAULT_FILTERS)

  it('groups primary conditions by element kinds + key', () => {
    expect(exprs).toContain('nw/amenity=parking,sanitary_dump_station,water_point,shelter')
    expect(exprs).toContain('nwr/tourism=camp_pitch,caravan_site,camp_site')
    expect(exprs).toContain('nw/tourism=wilderness_hut,alpine_hut')
    expect(exprs).toContain('nwr/sport=climbing')
  })

  it('never uses a negated condition as the pre-filter', () => {
    expect(exprs.join(' ')).not.toMatch(/motorhome|shelter_type/)
  })

  it('skips the personal (non-osm) filter', () => {
    expect(exprs).toHaveLength(4)
  })
})

describe('bboxCenter', () => {
  it('point → itself', () => {
    expect(bboxCenter({ type: 'Point', coordinates: [12.9, 50.8] })).toEqual({ lat: 50.8, lon: 12.9 })
  })

  it('line → bbox centre', () => {
    expect(bboxCenter({ type: 'LineString', coordinates: [[12, 50], [13, 51], [12.5, 50.2]] }))
      .toEqual({ lat: 50.5, lon: 12.5 })
  })

  it('multipolygon → bbox centre over all rings', () => {
    const g = { type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]], [[[3, 4], [4, 4], [3, 4]]]] }
    expect(bboxCenter(g)).toEqual({ lat: 2, lon: 2 })
  })

  it('empty geometry → null', () => {
    expect(bboxCenter({ type: 'LineString', coordinates: [] })).toBeNull()
  })
})

describe('layerFor', () => {
  it('plain parking → parking', () => {
    expect(layerFor({ amenity: 'parking' }, 'way')).toBe('parking')
  })

  it('parking + motorhome=yes → rest (it is a camper spot)', () => {
    expect(layerFor({ amenity: 'parking', motorhome: 'yes' }, 'node')).toBe('rest')
  })

  it('parking that is also a campsite → rest, so it shows without the parking layer', () => {
    expect(layerFor({ amenity: 'parking', tourism: 'camp_site' }, 'way')).toBe('rest')
  })

  it('default-off filters (hut, shelter) are still tiled', () => {
    expect(layerFor({ tourism: 'alpine_hut' }, 'node')).toBe('rest')
    expect(layerFor({ amenity: 'shelter' }, 'node')).toBe('rest')
  })

  it('applies secondary conditions (bus shelter excluded)', () => {
    expect(layerFor({ amenity: 'shelter', shelter_type: 'public_transport' }, 'node')).toBeNull()
  })

  it('respects element kinds (parking relation is not a built-in match)', () => {
    expect(layerFor({ amenity: 'parking' }, 'relation')).toBeNull()
    expect(layerFor({ tourism: 'camp_site' }, 'relation')).toBe('rest')
  })

  it('unrelated element → null', () => {
    expect(layerFor({ highway: 'residential' }, 'way')).toBeNull()
  })
})

describe('cleanTags', () => {
  it('drops editor-only tags, keeps the rest', () => {
    expect(cleanTags({
      name: 'P1', amenity: 'parking', source: 'survey', 'source:date': '2020',
      note: 'x', fixme: 'y', FIXME: 'z', check_date: '2024', 'check_date:opening_hours': '2024',
      created_by: 'JOSM', 'note:de': 'bleibt', sourcing: 'bleibt',
    })).toEqual({ name: 'P1', amenity: 'parking', 'note:de': 'bleibt', sourcing: 'bleibt' })
  })
})

describe('tileKey', () => {
  it('floors to 0.25° cells', () => {
    expect(tileKey(50.83, 12.92)).toBe('203_51')
    expect(tileKey(50.75, 12.75)).toBe('203_51') // lower edges inclusive
  })

  it('handles negative coordinates (floor, not trunc)', () => {
    expect(tileKey(-0.1, -9.13)).toBe('-1_-37')
    expect(tileKey(40.4, -3.7)).toBe('161_-15')
  })
})

describe('parseUniqueId', () => {
  it('parses n/w/r ids', () => {
    expect(parseUniqueId('n123')).toEqual({ t: 'n', id: 123 })
    expect(parseUniqueId('w45')).toEqual({ t: 'w', id: 45 })
    expect(parseUniqueId('r6')).toEqual({ t: 'r', id: 6 })
  })

  it('maps area ids back to way (even) / relation (odd)', () => {
    expect(parseUniqueId('a1541882720')).toEqual({ t: 'w', id: 770941360 })
    expect(parseUniqueId('a9551355')).toEqual({ t: 'r', id: 4775677 })
  })

  it('rejects garbage', () => {
    expect(parseUniqueId('x1')).toBeNull()
    expect(parseUniqueId('n1e3')).toBeNull()
    expect(parseUniqueId('n')).toBeNull()
    expect(parseUniqueId(12)).toBeNull()
  })
})

describe('placeFeature', () => {
  it('builds the compact record', () => {
    const placed = placeFeature({
      id: 'w7',
      properties: { amenity: 'parking', motorhome: 'yes', source: 'x', name: 'WoMo' },
      geometry: { type: 'Polygon', coordinates: [[[12.9, 50.8], [13.0, 50.8], [13.0, 50.9], [12.9, 50.8]]] },
    })
    expect(placed).toEqual({ layer: 'rest', key: '203_51', poi: ['w', 7, 50.85, 12.95, { amenity: 'parking', motorhome: 'yes', name: 'WoMo' }] })
  })

  it('places multipolygon relations (area id) as relations', () => {
    const placed = placeFeature({
      id: 'a9551355',
      properties: { tourism: 'camp_site', name: 'Camp' },
      geometry: { type: 'MultiPolygon', coordinates: [[[[12.9, 50.8], [13.0, 50.8], [12.9, 50.8]]]] },
    })
    expect(placed?.poi.slice(0, 2)).toEqual(['r', 4775677])
  })

  it('skips non-matching features', () => {
    expect(placeFeature({ id: 'n1', properties: { shop: 'bakery' }, geometry: { type: 'Point', coordinates: [1, 1] } })).toBeNull()
  })
})

describe('buildManifest', () => {
  it('lists sorted tile keys per layer + attribution', () => {
    const m = buildManifest('2026-10-02', { parking: ['2_1', '1_1'], rest: new Set(['5_5']) }, { parking: 3, rest: 1 })
    expect(m).toMatchObject({
      version: '2026-10-02', date: '2026-10-02', cellDeg: 0.25,
      tiles: { parking: ['1_1', '2_1'], rest: ['5_5'] },
      counts: { parking: 3, rest: 1 },
    })
    expect(m.attribution).toContain('OpenStreetMap')
  })
})

describe('belowMinimum', () => {
  it('flags layers under their floor, none by default', () => {
    expect(belowMinimum({ parking: 42_000, rest: 104 }, { rest: 1000 })).toEqual(['rest'])
    expect(belowMinimum({ parking: 0, rest: 0 }, {})).toEqual([])
  })
})
