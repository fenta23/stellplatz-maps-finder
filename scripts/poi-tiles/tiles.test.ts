import { describe, it, expect } from 'vitest'
import { DEFAULT_FILTERS } from '../../src/client/features/filters/filterModel.js'
import {
  belowMinimum, bboxCenter, buildManifest, cleanTags, LAYERS, layersFor, osmiumExpressions,
  parseUniqueId, placeFeature, tileKey,
} from './tiles.js'
import { TILE_LAYER_IDS, tileLayerOf, type FilterDef } from '../../src/client/features/filters/filterModel.js'

describe('osmiumExpressions', () => {
  const exprs = osmiumExpressions(DEFAULT_FILTERS)

  it('groups primary conditions by element kinds + key', () => {
    expect(exprs).toContain('nwr/tourism=camp_pitch,caravan_site,camp_site')
    expect(exprs).toContain('nw/tourism=wilderness_hut,alpine_hut,hotel,guest_house,hostel')
    expect(exprs).toContain('nwr/sport=climbing')
    expect(exprs).toContain('n/man_made=water_tap')
    expect(exprs).toContain('n/natural=spring')
    expect(exprs).toContain('nwr/landuse=cemetery')
  })

  it('never uses a negated condition as the pre-filter', () => {
    const keys = exprs.map(e => e.split('=')[0]!.split('/')[1])
    for (const k of ['motorhome', 'shelter_type', 'access', 'bicycle', 'food', 'drinking_water']) expect(keys).not.toContain(k)
  })

  it('skips the personal (non-osm) filter', () => {
    const personal = DEFAULT_FILTERS.find(f => f.kind === 'personal')!
    expect(osmiumExpressions([personal])).toEqual([])
  })

  it('a key-only selector makes its group key-only instead of dropping it', () => {
    const f = (value: string): FilterDef => ({
      id: 'x', name: 'x', iconId: 'pin', color: '#000', enabled: true, kind: 'osm', builtin: false, order: 0,
      selectors: [{ elements: ['node'], tags: [{ key: 'shop', value }] }],
    })
    expect(osmiumExpressions([f('bakery'), f('')])).toEqual(['n/shop'])
    expect(osmiumExpressions([f(''), f('bakery')])).toEqual(['n/shop'])
  })

  it('snapshot — a filter change must show up in review', () => {
    // natural=spring / man_made=water_tap pre-filter ALL springs / taps; the
    // drinking_water=yes condition is applied later by classifyElement (superset is fine).
    expect(exprs).toEqual([
      'nw/amenity=parking,sanitary_dump_station,water_point,shelter,drinking_water,toilets,restaurant,fast_food,biergarten,pub,cafe,bicycle_repair_station,charging_station',
      'nwr/tourism=camp_pitch,caravan_site,camp_site',
      'nwr/sport=climbing',
      'nw/tourism=wilderness_hut,alpine_hut,hotel,guest_house,hostel',
      'n/man_made=water_tap',
      'n/natural=spring',
      'nwr/landuse=cemetery',
      'nwr/amenity=grave_yard',
      'nw/shop=supermarket,convenience,bakery,bicycle',
    ])
  })

  it('every built-in selector is covered by some expression (superset property)', () => {
    for (const f of DEFAULT_FILTERS.filter(x => x.kind === 'osm')) {
      for (const sel of f.selectors) {
        const p = sel.tags.find(c => !c.negate)!
        const kinds = sel.elements.map(k => k[0]!).join('')
        const hit = exprs.some(e => {
          const [head, vals] = e.split('=')
          const [ek, key] = head!.split('/')
          return key === p.key && ek === kinds && (vals === undefined || vals.split(',').includes(p.value))
        })
        expect(hit, `${f.id}: ${kinds}/${p.key}=${p.value}`).toBe(true)
      }
    }
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

describe('layersFor', () => {
  it('plain parking → parking', () => {
    expect(layersFor({ amenity: 'parking' }, 'way')).toEqual(['parking'])
  })

  it('parking + motorhome=yes → rest (it is a camper spot)', () => {
    expect(layersFor({ amenity: 'parking', motorhome: 'yes' }, 'node')).toEqual(['rest'])
  })

  it('parking that is also a campsite → rest only, so it shows without the parking layer', () => {
    expect(layersFor({ amenity: 'parking', tourism: 'camp_site' }, 'way')).toEqual(['rest'])
  })

  it('default-off filters (hut, shelter) are still tiled', () => {
    expect(layersFor({ tourism: 'alpine_hut' }, 'node')).toEqual(['rest'])
    expect(layersFor({ amenity: 'shelter' }, 'node')).toEqual(['rest'])
  })

  it('applies secondary conditions (bus shelter excluded)', () => {
    expect(layersFor({ amenity: 'shelter', shelter_type: 'public_transport' }, 'node')).toEqual([])
  })

  it('respects element kinds (parking relation is not a built-in match)', () => {
    expect(layersFor({ amenity: 'parking' }, 'relation')).toEqual([])
    expect(layersFor({ tourism: 'camp_site' }, 'relation')).toEqual(['rest'])
  })

  it('unrelated element → none', () => {
    expect(layersFor({ highway: 'residential' }, 'way')).toEqual([])
  })

  it('new categories go to their own layer, not rest', () => {
    expect(layersFor({ shop: 'bakery' }, 'node')).toEqual(['supply'])
    expect(layersFor({ amenity: 'restaurant' }, 'way')).toEqual(['food'])
    expect(layersFor({ tourism: 'hotel' }, 'node')).toEqual(['lodging'])
    expect(layersFor({ shop: 'bicycle' }, 'node')).toEqual(['bike'])
    expect(layersFor({ landuse: 'cemetery' }, 'relation')).toEqual(['supply'])
    expect(layersFor({ natural: 'spring', drinking_water: 'yes' }, 'node')).toEqual(['supply'])
    expect(layersFor({ natural: 'spring' }, 'node')).toEqual([])
  })

  it('an element claimed by several layers is written to all of them', () => {
    expect(layersFor({ tourism: 'hotel', amenity: 'restaurant' }, 'node')).toEqual(['food', 'lodging'])
    expect(layersFor({ shop: 'bakery', amenity: 'cafe' }, 'node')).toEqual(['supply', 'food'])
  })

  it('plain parking that a new layer also claims stays in parking AND that layer', () => {
    expect(layersFor({ amenity: 'parking', tourism: 'hotel' }, 'node')).toEqual(['parking', 'lodging'])
    expect(layersFor({ amenity: 'parking', shop: 'supermarket' }, 'way')).toEqual(['parking', 'supply'])
  })

  it('rest wins over parking even when a new layer claims it too', () => {
    expect(layersFor({ amenity: 'parking', tourism: 'camp_site', shop: 'convenience' }, 'way')).toEqual(['rest', 'supply'])
  })

  it('rest and parking content is stable for pre-existing inputs (regression pin)', () => {
    const cases: ReadonlyArray<readonly [Record<string, string>, 'node' | 'way' | 'relation', string[]]> = [
      [{ amenity: 'parking' }, 'way', ['parking']],
      [{ amenity: 'parking', access: 'private' }, 'node', ['parking']],
      [{ amenity: 'parking', motorhome: 'yes' }, 'node', ['rest']],
      [{ amenity: 'parking', tourism: 'camp_site' }, 'way', ['rest']],
      [{ amenity: 'parking', tourism: 'caravan_site' }, 'node', ['rest']],
      [{ tourism: 'camp_pitch' }, 'node', ['rest']],
      [{ tourism: 'camp_site' }, 'relation', ['rest']],
      [{ amenity: 'sanitary_dump_station' }, 'node', ['rest']],
      [{ amenity: 'water_point' }, 'way', ['rest']],
      [{ sport: 'climbing' }, 'relation', ['rest']],
      [{ tourism: 'wilderness_hut' }, 'node', ['rest']],
      [{ amenity: 'shelter' }, 'way', ['rest']],
      [{ amenity: 'shelter', shelter_type: 'basic_hut' }, 'node', ['rest']],
      [{ amenity: 'shelter', shelter_type: 'gazebo' }, 'node', []],
      [{ amenity: 'parking' }, 'relation', []],
      [{ highway: 'bus_stop' }, 'node', []],
    ]
    for (const [tags, kind, expected] of cases) {
      const got = layersFor(tags, kind).filter(l => l === 'parking' || l === 'rest')
      expect(got, JSON.stringify(tags)).toEqual(expected)
    }
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
    expect(placed).toEqual({ layers: ['rest'], key: '203_51', poi: ['w', 7, 50.85, 12.95, { amenity: 'parking', motorhome: 'yes', name: 'WoMo' }] })
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
    expect(placeFeature({ id: 'n1', properties: { highway: 'bus_stop' }, geometry: { type: 'Point', coordinates: [1, 1] } })).toBeNull()
  })

  it('places a bakery in the supply layer, not rest', () => {
    const placed = placeFeature({ id: 'n1', properties: { shop: 'bakery' }, geometry: { type: 'Point', coordinates: [1, 1] } })
    expect(placed).toEqual({ layers: ['supply'], key: '4_4', poi: ['n', 1, 1, 1, { shop: 'bakery' }] })
  })

  it('places a multi-layer element once with all its layers', () => {
    const placed = placeFeature({
      id: 'n2', properties: { tourism: 'hotel', amenity: 'restaurant' }, geometry: { type: 'Point', coordinates: [1, 1] },
    })
    expect(placed?.layers).toEqual(['food', 'lodging'])
  })
})

const allLayers = <T>(f: (l: typeof LAYERS[number]) => T) =>
  Object.fromEntries(LAYERS.map(l => [l, f(l)])) as Record<typeof LAYERS[number], T>

describe('buildManifest', () => {
  const tiles = { ...allLayers(() => [] as string[]), parking: ['2_1', '1_1'], rest: new Set(['5_5']), food: ['9_9', '3_3'] }
  const counts = { ...allLayers(() => 0), parking: 3, rest: 1, food: 2 }

  it('lists sorted tile keys per layer + attribution', () => {
    const m = buildManifest('2026-10-02', tiles, counts)
    expect(m).toMatchObject({
      version: '2026-10-02', date: '2026-10-02', cellDeg: 0.25,
      tiles: { parking: ['1_1', '2_1'], rest: ['5_5'], food: ['3_3', '9_9'], supply: [], lodging: [], bike: [] },
    })
    expect(m.counts).toEqual({ parking: 3, rest: 1, supply: 0, food: 2, lodging: 0, bike: 0 })
    expect(m.attribution).toContain('OpenStreetMap')
  })

  it('has all six layers in tiles, counts and filters', () => {
    const m = buildManifest('2026-10-02', tiles, counts)
    for (const part of [m.tiles, m.counts, m.filters]) expect(Object.keys(part).sort()).toEqual([...TILE_LAYER_IDS].sort())
  })

  it('filters: parking + the seven old rest filters stay as before, new ones per tileLayerOf', () => {
    const m = buildManifest('2026-10-02', tiles, counts)
    expect(m.filters).toEqual({
      parking: ['parking'],
      rest: ['camper', 'campsite', 'dump', 'water', 'climbing', 'hut', 'shelter'],
      supply: ['drinking_water', 'cemetery', 'toilets', 'supermarket', 'bakery'],
      food: ['restaurant', 'cafe'],
      lodging: ['hotel'],
      bike: ['bike_service', 'ebike_charging'],
    })
  })

  it('filters cover every built-in osm filter exactly once, in the layer tileLayerOf names', () => {
    const m = buildManifest('2026-10-02', tiles, counts)
    const osmIds = DEFAULT_FILTERS.filter(f => f.kind === 'osm').map(f => f.id)
    expect(Object.values(m.filters).flat().sort()).toEqual([...osmIds].sort())
    for (const [layer, ids] of Object.entries(m.filters)) for (const id of ids) expect(tileLayerOf(id)).toBe(layer)
  })
})

describe('belowMinimum', () => {
  it('flags layers under their floor, none by default', () => {
    const c = { ...allLayers(() => 0), parking: 42_000, rest: 104 }
    expect(belowMinimum(c, { rest: 1000 })).toEqual(['rest'])
    expect(belowMinimum(allLayers(() => 0), {})).toEqual([])
  })

  it('works for the new layers; a missing minimum means 0', () => {
    const c = { ...allLayers(() => 5000), food: 10, bike: 0 }
    expect(belowMinimum(c, { food: 100, bike: 1, supply: 5000 })).toEqual(['food', 'bike'])
    expect(belowMinimum(c, { lodging: 5001 })).toEqual(['lodging'])
  })
})
