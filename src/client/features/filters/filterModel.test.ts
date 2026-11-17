import { describe, it, expect } from 'vitest'
import {
  DEFAULT_FILTERS, PERSONAL_FILTER_ID, FILTER_ICONS, FILTER_TEMPLATES, FILTER_COLORS,
  buildOverpassQuery, buildOverpassAroundQuery, classifyElement, filterIconPath,
  tileLayerOf, TILE_LAYER_IDS, isFilterActive, activeFirst,
  isValidTagToken, isValidCondition, isValidSelector, MAX_SELECTOR_CONDITIONS,
  type FilterDef, type OsmSelector,
} from './filterModel.js'
import type { LatLngBounds } from '@/features/pois/OverpassClient.js'

const BOUNDS: LatLngBounds = { south: 48.0, west: 11.0, north: 48.5, east: 11.5 }
const byId = (id: string): FilterDef => DEFAULT_FILTERS.find(f => f.id === id)!

describe('DEFAULT_FILTERS', () => {
  it('has the 8 OSM types plus a personal group', () => {
    expect(DEFAULT_FILTERS.map(f => f.id)).toEqual(
      ['parking', 'camper', 'campsite', 'dump', 'water', 'climbing', PERSONAL_FILTER_ID, 'hut', 'shelter',
        'drinking_water', 'cemetery', 'toilets', 'supermarket', 'bakery', 'hotel', 'restaurant', 'cafe',
        'bike_service', 'ebike_charging'],
    )
    expect(DEFAULT_FILTERS.map(f => f.order)).toEqual(DEFAULT_FILTERS.map((_, i) => i))
  })

  it('marks the personal group as kind=personal with no selectors and its own colour', () => {
    const p = byId(PERSONAL_FILTER_ID)
    expect(p.kind).toBe('personal')
    expect(p.selectors).toHaveLength(0)
    expect(FILTER_COLORS.includes(p.color) || p.color === '#D81B60').toBe(true)
    // distinct from the 6 OSM colours
    const osmColors = DEFAULT_FILTERS.filter(f => f.kind === 'osm').map(f => f.color)
    expect(osmColors).not.toContain(p.color)
  })

  it('all defaults are builtin', () => {
    expect(DEFAULT_FILTERS.every(f => f.builtin)).toBe(true)
  })

  it('enables everything except the two opt-in newcomers', () => {
    const off = DEFAULT_FILTERS.filter(f => !f.enabled).map(f => f.id)
    expect(off).toEqual(['hut', 'shelter'])
  })

  const NEW_IDS = ['drinking_water', 'cemetery', 'toilets', 'supermarket', 'bakery', 'hotel', 'restaurant', 'cafe', 'bike_service', 'ebike_charging']

  it('ships the ten hiking/cycling filters hidden but enabled (un-hiding activates them)', () => {
    for (const id of NEW_IDS) {
      const f = byId(id)
      expect(f.kind, id).toBe('osm')
      expect(f.builtin, id).toBe(true)
      expect(f.hidden, id).toBe(true)
      expect(f.enabled, id).toBe(true)
      expect(isFilterActive(f), id).toBe(false)
      expect(isFilterActive({ ...f, hidden: false }), id).toBe(true)
      expect(FILTER_ICONS.some(i => i.id === f.iconId), `${id} icon`).toBe(true)
    }
  })

  it('gives every built-in a unique colour', () => {
    const colors = DEFAULT_FILTERS.map(f => f.color.toLowerCase())
    expect(new Set(colors).size).toBe(colors.length)
  })

  it('puts the selective tag first in each new selector (osmium pre-filter)', () => {
    for (const id of NEW_IDS) {
      for (const sel of byId(id).selectors) {
        expect(sel.tags[0]!.negate, id).toBeUndefined()
        expect(['amenity', 'shop', 'tourism', 'landuse', 'man_made', 'natural']).toContain(sel.tags[0]!.key)
      }
    }
  })

  it('matches the specified tags and element kinds', () => {
    const all = DEFAULT_FILTERS
    expect(classifyElement({ amenity: 'drinking_water' }, 'way', all)).toBe('drinking_water')
    expect(classifyElement({ man_made: 'water_tap', drinking_water: 'yes' }, 'node', all)).toBe('drinking_water')
    expect(classifyElement({ man_made: 'water_tap' }, 'node', all)).toBeNull()
    expect(classifyElement({ natural: 'spring', drinking_water: 'yes' }, 'node', all)).toBe('drinking_water')
    expect(classifyElement({ natural: 'spring', drinking_water: 'yes' }, 'way', all)).toBeNull()
    expect(classifyElement({ landuse: 'cemetery' }, 'relation', all)).toBe('cemetery')
    expect(classifyElement({ amenity: 'grave_yard' }, 'way', all)).toBe('cemetery')
    expect(classifyElement({ amenity: 'toilets' }, 'node', all)).toBe('toilets')
    expect(classifyElement({ amenity: 'toilets', access: 'private' }, 'node', all)).toBeNull()
    expect(classifyElement({ shop: 'convenience' }, 'node', all)).toBe('supermarket')
    expect(classifyElement({ tourism: 'hostel' }, 'way', all)).toBe('hotel')
    expect(classifyElement({ amenity: 'pub', food: 'yes' }, 'node', all)).toBe('restaurant')
    expect(classifyElement({ amenity: 'pub' }, 'node', all)).toBeNull()
    expect(classifyElement({ amenity: 'bicycle_repair_station' }, 'node', all)).toBe('bike_service')
    expect(classifyElement({ amenity: 'charging_station', bicycle: 'yes' }, 'node', all)).toBe('ebike_charging')
    expect(classifyElement({ amenity: 'charging_station' }, 'node', all)).toBeNull()
  })

  // Overlaps: classifyElement nimmt den ersten Treffer, die Reihenfolge ist Absicht.
  it('resolves overlapping tags by order', () => {
    const all = DEFAULT_FILTERS
    expect(classifyElement({ shop: 'bakery', amenity: 'cafe' }, 'node', all)).toBe('bakery')
    expect(classifyElement({ tourism: 'hotel', amenity: 'restaurant' }, 'node', all)).toBe('hotel')
    expect(classifyElement({ tourism: 'camp_site', amenity: 'restaurant' }, 'way', all)).toBe('campsite')
    expect(classifyElement({ tourism: 'alpine_hut', amenity: 'restaurant' }, 'node', all)).toBe('hut')
    expect(classifyElement({ shop: 'supermarket', amenity: 'cafe' }, 'node', all)).toBe('supermarket')
    expect(classifyElement({ landuse: 'cemetery', amenity: 'drinking_water' }, 'node', all)).toBe('drinking_water')
  })

  // Regression: enabled:false darf nicht hidden:true bedeuten — sonst
  // verschwinden die Chips ganz statt nur inaktiv zu sein.
  it('leaves the opt-in filters visible in the chip row (not hidden)', () => {
    for (const id of ['hut', 'shelter']) {
      expect(byId(id).hidden).toBeUndefined()
    }
  })
})

describe('buildOverpassAroundQuery', () => {
  const LINE = [[48.123456, 11.0], [48.2, 11.987654], [48.3, 12.5]] as const
  const mk = (selectors: OsmSelector[], over: Partial<FilterDef> = {}): FilterDef => ({
    id: 'x', name: 'X', iconId: 'pin', color: '#000', enabled: true, kind: 'osm', builtin: false, order: 9,
    selectors, ...over,
  })
  const AROUND = 'around:500,48.12346,11,48.2,11.98765,48.3,12.5'

  it('emits one statement per element kind with the polyline clause', () => {
    const q = buildOverpassAroundQuery(LINE, 500, [byId('climbing')])
    expect(q).toContain(`node["sport"="climbing"](${AROUND});`)
    expect(q).toContain(`way["sport"="climbing"](${AROUND});`)
    expect(q).toContain(`relation["sport"="climbing"](${AROUND});`)
  })

  it('uses a 60s timeout and the bbox-style frame', () => {
    const q = buildOverpassAroundQuery(LINE, 500, [byId('dump')])
    expect(q.startsWith('[out:json][timeout:60];\n(\n  ')).toBe(true)
    expect(q.endsWith('\n);\nout center tags;')).toBe(true)
  })

  it('renders negated and key-presence conditions like the bbox variant', () => {
    const f = mk([{ elements: ['node'], tags: [{ key: 'amenity', value: '' }, { key: 'access', value: 'private', negate: true }] }])
    expect(buildOverpassAroundQuery(LINE, 500, [f]))
      .toContain(`node["amenity"]["access"!="private"](${AROUND});`)
  })

  it('shares tag syntax with the bbox query', () => {
    const f = byId('parking')
    const bbox = buildOverpassQuery(BOUNDS, [f]).match(/way(\[.*\])\(/)![1]
    expect(buildOverpassAroundQuery(LINE, 500, [f])).toContain(`way${bbox}(${AROUND});`)
  })

  it('covers multiple filters and selectors', () => {
    const q = buildOverpassAroundQuery(LINE, 500, [byId('camper'), byId('water')])
    expect(q.match(/\(around:/g)).toHaveLength(10) // camper: 3+2+3, water: 2
    expect(q).toContain('"amenity"="water_point"')
    expect(q).toContain('"tourism"="caravan_site"')
  })

  it('rounds coordinates to 5 decimals, keeps lat before lon and order', () => {
    const q = buildOverpassAroundQuery([[1.0000049, -2.123456], [3, 4]], 10, [byId('dump')])
    expect(q).toContain('(around:10,1,-2.12346,3,4)')
  })

  it('formats the radius as an integer', () => {
    expect(buildOverpassAroundQuery(LINE, 249.6, [byId('dump')])).toContain('(around:250,')
  })

  it('skips non-osm filters, invalid selectors and filters without selectors', () => {
    const personal = byId(PERSONAL_FILTER_ID)
    const bad = mk([{ elements: ['node'], tags: [{ key: 'a b', value: 'x' }] }])
    const q = buildOverpassAroundQuery(LINE, 500, [personal, bad, byId('dump')])
    expect(q).not.toContain('a b')
    expect(q).toContain('amenity"="sanitary_dump_station')
  })

  it('returns an empty string when there is nothing to query', () => {
    expect(buildOverpassAroundQuery(LINE, 500, [])).toBe('')
    expect(buildOverpassAroundQuery(LINE, 500, [byId(PERSONAL_FILTER_ID)])).toBe('')
    expect(buildOverpassAroundQuery([], 500, [byId('dump')])).toBe('')
    expect(buildOverpassAroundQuery([[48, 11]], 500, [byId('dump')])).toBe('')
    expect(buildOverpassAroundQuery(LINE, 0, [byId('dump')])).toBe('')
    expect(buildOverpassAroundQuery(LINE, Number.NaN, [byId('dump')])).toBe('')
  })
})

describe('buildOverpassQuery', () => {
  it('builds parking with motorhome exclusion', () => {
    const q = buildOverpassQuery(BOUNDS, [byId('parking')])
    expect(q).toContain('"amenity"="parking"')
    expect(q).toContain('"motorhome"!="yes"')
    expect(q).toContain('48,11,48.5,11.5')
  })

  it('builds camper with all three selectors', () => {
    const q = buildOverpassQuery(BOUNDS, [byId('camper')])
    expect(q).toContain('"tourism"="camp_pitch"')
    expect(q).toContain('"motorhome"="yes"')
    expect(q).toContain('"tourism"="caravan_site"')
  })

  it('builds campsite with relation statement', () => {
    const q = buildOverpassQuery(BOUNDS, [byId('campsite')])
    expect(q).toContain('relation["tourism"="camp_site"]')
  })

  it('emits node/way/relation for NWR selectors', () => {
    const q = buildOverpassQuery(BOUNDS, [byId('climbing')])
    expect(q).toContain('node["sport"="climbing"]')
    expect(q).toContain('way["sport"="climbing"]')
    expect(q).toContain('relation["sport"="climbing"]')
  })

  it('ignores the personal group (no selectors)', () => {
    const q = buildOverpassQuery(BOUNDS, [byId(PERSONAL_FILTER_ID)])
    expect(q).not.toContain('amenity')
    expect(q).not.toContain('tourism')
  })

  it('renders key-presence and negated conditions', () => {
    const f: FilterDef = {
      id: 'x', name: 'X', iconId: 'pin', color: '#000', enabled: true, kind: 'osm', builtin: false, order: 9,
      selectors: [{ elements: ['node'], tags: [{ key: 'amenity', value: '' }, { key: 'access', value: 'private', negate: true }] }],
    }
    const q = buildOverpassQuery(BOUNDS, [f])
    expect(q).toContain('["amenity"]')
    expect(q).toContain('["access"!="private"]')
  })

  it('skips structurally invalid selectors', () => {
    const f: FilterDef = {
      id: 'bad', name: 'Bad', iconId: 'pin', color: '#000', enabled: true, kind: 'osm', builtin: false, order: 9,
      selectors: [{ elements: [], tags: [{ key: 'amenity', value: 'fuel' }] }],
    }
    const q = buildOverpassQuery(BOUNDS, [f])
    expect(q).not.toContain('amenity')
  })
})

describe('classifyElement', () => {
  const all = DEFAULT_FILTERS
  it('classifies camp_site as campsite', () => {
    expect(classifyElement({ tourism: 'camp_site' }, 'way', all)).toBe('campsite')
  })
  it('classifies camp_pitch as camper', () => {
    expect(classifyElement({ tourism: 'camp_pitch' }, 'node', all)).toBe('camper')
  })
  it('classifies motorhome parking as camper, not parking', () => {
    expect(classifyElement({ amenity: 'parking', motorhome: 'yes' }, 'node', all)).toBe('camper')
  })
  it('classifies plain parking as parking', () => {
    expect(classifyElement({ amenity: 'parking' }, 'node', all)).toBe('parking')
  })
  it('classifies caravan_site / dump / water / climbing', () => {
    expect(classifyElement({ tourism: 'caravan_site' }, 'node', all)).toBe('camper')
    expect(classifyElement({ amenity: 'sanitary_dump_station' }, 'node', all)).toBe('dump')
    expect(classifyElement({ amenity: 'water_point' }, 'node', all)).toBe('water')
    expect(classifyElement({ sport: 'climbing' }, 'relation', all)).toBe('climbing')
  })
  it('returns null for unknown tags', () => {
    expect(classifyElement({ shop: 'books' }, 'node', all)).toBeNull()
  })
  it('respects element-kind restriction (dump only node/way)', () => {
    expect(classifyElement({ amenity: 'sanitary_dump_station' }, 'relation', all)).toBeNull()
  })
})

describe('validation', () => {
  it('accepts grammar-conform tokens', () => {
    expect(isValidTagToken('amenity')).toBe(true)
    expect(isValidTagToken('camp_site')).toBe(true)
    expect(isValidTagToken('addr:city')).toBe(true)
    expect(isValidTagToken('drive-through')).toBe(true)
  })
  it('rejects tokens with spaces/quotes', () => {
    expect(isValidTagToken('fast food')).toBe(false)
    expect(isValidTagToken('a"b')).toBe(false)
    expect(isValidTagToken('')).toBe(false)
  })
  it('isValidCondition allows key-presence (empty value)', () => {
    expect(isValidCondition({ key: 'amenity', value: '' })).toBe(true)
    expect(isValidCondition({ key: 'bad key', value: '' })).toBe(false)
    expect(isValidCondition({ key: 'amenity', value: 'fast food' })).toBe(false)
  })
  it('isValidSelector requires elements + 1..6 valid tags', () => {
    const ok: OsmSelector = { elements: ['node'], tags: [{ key: 'amenity', value: 'fuel' }] }
    expect(isValidSelector(ok)).toBe(true)
    expect(isValidSelector({ elements: [], tags: ok.tags })).toBe(false)
    expect(isValidSelector({ elements: ['node'], tags: [] })).toBe(false)
  })
})

describe('icons & templates', () => {
  it('FILTER_ICONS includes climbing and is deduped', () => {
    const ids = FILTER_ICONS.map(i => i.id)
    expect(ids).toContain('climbing')
    expect(ids).toContain('parking')
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('filterIconPath falls back to the first icon for unknown id', () => {
    expect(filterIconPath('does-not-exist')).toBe(FILTER_ICONS[0]!.path)
  })
  it('has no template whose selectors a built-in already covers', () => {
    const names = FILTER_TEMPLATES.map(x => x.name)
    for (const n of ['Supermarkt', 'Bäckerei', 'Restaurant', 'Trinkwasser']) expect(names).not.toContain(n)
    // Ladestation (alle Ladestationen) und Toilette (inkl. access=private) sind breiter als die Built-ins.
    expect(names).toContain('Ladestation')
  })
  it('every template is structurally valid', () => {
    expect(FILTER_TEMPLATES.length).toBeGreaterThan(8)
    for (const t of FILTER_TEMPLATES) {
      expect(t.selectors.every(isValidSelector)).toBe(true)
      expect(FILTER_ICONS.some(i => i.id === t.iconId)).toBe(true)
    }
  })
})

describe('shelter filter (Bushaltestellen-Ausschluss)', () => {
  const all = DEFAULT_FILTERS
  const shelter = byId('shelter')

  it('claims a plain shelter without shelter_type', () => {
    expect(classifyElement({ amenity: 'shelter' }, 'way', all)).toBe('shelter')
  })

  it('claims the shelter types that matter for hikers', () => {
    for (const t of ['basic_hut', 'lean_to', 'weather_shelter', 'rock_shelter']) {
      expect(classifyElement({ amenity: 'shelter', shelter_type: t }, 'way', all)).toBe('shelter')
    }
  })

  // Regression: ~90 % aller amenity=shelter in DE sind Bushaltestellen-Wartehäuschen.
  it('rejects bus-stop shelters and the other loud types', () => {
    for (const t of ['public_transport', 'gazebo', 'picnic_shelter']) {
      expect(classifyElement({ amenity: 'shelter', shelter_type: t }, 'way', all)).toBeNull()
    }
  })

  it('excludes the three loudest types, not the rare ones', () => {
    const excluded = shelter.selectors[0]!.tags.filter(t => t.negate).map(t => t.value)
    expect(excluded).toEqual(['public_transport', 'picnic_shelter', 'gazebo'])
    // sun_shelter/pergola/field_shelter passen nicht mehr rein (Backend-Limit)
    expect(classifyElement({ amenity: 'shelter', shelter_type: 'sun_shelter' }, 'way', all)).toBe('shelter')
  })

  it('emits the exclusions as Overpass != conditions', () => {
    const q = buildOverpassQuery(BOUNDS, [shelter])
    expect(q).toContain('["amenity"="shelter"]')
    expect(q).toContain('["shelter_type"!="public_transport"]')
    expect(q).toContain('["shelter_type"!="gazebo"]')
    expect(q).not.toContain('["shelter_type"="public_transport"]')
  })
})

describe('hut filter', () => {
  const all = DEFAULT_FILTERS

  it('claims both unstaffed and staffed huts', () => {
    expect(classifyElement({ tourism: 'wilderness_hut' }, 'way', all)).toBe('hut')
    expect(classifyElement({ tourism: 'alpine_hut' }, 'node', all)).toBe('hut')
  })

  it('does not claim a campsite or a caravan site', () => {
    expect(classifyElement({ tourism: 'camp_site' }, 'way', all)).toBe('campsite')
    expect(classifyElement({ tourism: 'caravan_site' }, 'way', all)).toBe('camper')
  })

  // Ordering: 'hut' (order 7) muss vor 'shelter' (order 8) greifen, sonst
  // landet eine Hütte mit zusätzlichem amenity=shelter im Schutzhütten-Filter.
  it('wins over shelter when an element carries both tags', () => {
    expect(classifyElement({ tourism: 'wilderness_hut', amenity: 'shelter' }, 'way', all)).toBe('hut')
    expect(byId('hut').order).toBeLessThan(byId('shelter').order)
  })

  it('ORs its two selectors instead of ANDing them', () => {
    const q = buildOverpassQuery(BOUNDS, [byId('hut')])
    expect(q).toContain('["tourism"="wilderness_hut"]')
    expect(q).toContain('["tourism"="alpine_hut"]')
    expect(q).not.toContain('["tourism"="wilderness_hut"]["tourism"="alpine_hut"]')
  })
})

describe('new filter icons', () => {
  it('registers a distinct icon for hut and shelter — not the campsite tent', () => {
    for (const id of ['hut', 'shelter']) {
      const f = byId(id)
      expect(f.iconId).toBe(id)
      expect(FILTER_ICONS.some(i => i.id === id)).toBe(true)
      expect(filterIconPath(id)).not.toBe(filterIconPath('campsite'))
      expect(filterIconPath(id).length).toBeGreaterThan(0)
    }
  })

  it('gives them colours no other built-in uses', () => {
    const others = DEFAULT_FILTERS.filter(f => f.id !== 'hut' && f.id !== 'shelter').map(f => f.color)
    expect(others).not.toContain(byId('hut').color)
    expect(others).not.toContain(byId('shelter').color)
    expect(byId('hut').color).not.toBe(byId('shelter').color)
  })
})

// Regression: das Backend akzeptiert pro Statement nur {1,4} Tag-Filter
// (supabase/functions/_shared/utils.ts, STATEMENT). Ein Selector mit 5+
// Bedingungen gibt 400 "Unsupported query shape" — und weil alle aktiven Filter
// in EINER Overpass-Query landen, bricht damit der komplette POI-Abruf.
// Die Schutzhütte hatte genau diesen Fehler und liess die Karte leer.
describe('backend condition limit', () => {
  const conds = (n: number): OsmSelector => ({
    elements: ['node'],
    tags: Array.from({ length: n }, (_, i) => ({ key: `k${i}`, value: `v${i}` })),
  })

  it('caps selectors at the shape the backend allowlist accepts', () => {
    expect(MAX_SELECTOR_CONDITIONS).toBe(4)
    expect(isValidSelector(conds(MAX_SELECTOR_CONDITIONS))).toBe(true)
    expect(isValidSelector(conds(MAX_SELECTOR_CONDITIONS + 1))).toBe(false)
  })

  it('keeps every built-in selector within the limit', () => {
    for (const f of DEFAULT_FILTERS) {
      for (const sel of f.selectors) {
        expect(sel.tags.length, `${f.id} hat ${sel.tags.length} Bedingungen`)
          .toBeLessThanOrEqual(MAX_SELECTOR_CONDITIONS)
      }
    }
  })

  it('keeps every curated template within the limit', () => {
    for (const t of FILTER_TEMPLATES) {
      for (const sel of t.selectors) {
        expect(sel.tags.length, `Template ${t.name}`).toBeLessThanOrEqual(MAX_SELECTOR_CONDITIONS)
      }
    }
  })

  it('never emits a statement with more tag filters than the backend allows', () => {
    const q = buildOverpassQuery(BOUNDS, DEFAULT_FILTERS)
    for (const stmt of q.split('\n').filter(l => /^\s*(node|way|relation)\[/.test(l))) {
      const n = (stmt.match(/\["[\w:-]+"!?="[\w:-]+"\]/g) ?? []).length
      expect(n, stmt.trim()).toBeLessThanOrEqual(MAX_SELECTOR_CONDITIONS)
      expect(n).toBeGreaterThan(0)
    }
  })
})

describe('tileLayerOf', () => {
  it('maps built-in filters to their tile layer', () => {
    expect(tileLayerOf('parking')).toBe('parking')
    for (const id of ['drinking_water', 'cemetery', 'toilets', 'supermarket', 'bakery']) expect(tileLayerOf(id)).toBe('supply')
    for (const id of ['restaurant', 'cafe']) expect(tileLayerOf(id)).toBe('food')
    expect(tileLayerOf('hotel')).toBe('lodging')
    for (const id of ['bike_service', 'ebike_charging']) expect(tileLayerOf(id)).toBe('bike')
    for (const id of ['camper', 'campsite', 'dump', 'water', 'climbing', 'hut', 'shelter', PERSONAL_FILTER_ID]) {
      expect(tileLayerOf(id)).toBe('rest')
    }
  })

  it('falls back to rest for unknown ids, including prototype keys', () => {
    expect(tileLayerOf('does-not-exist')).toBe('rest')
    expect(tileLayerOf('constructor')).toBe('rest')
    expect(tileLayerOf('toString')).toBe('rest')
  })

  it('lists the layers in order and covers every built-in', () => {
    expect(TILE_LAYER_IDS).toEqual(['parking', 'rest', 'supply', 'food', 'lodging', 'bike'])
    for (const f of DEFAULT_FILTERS) expect(TILE_LAYER_IDS).toContain(tileLayerOf(f.id))
  })
})

describe('activeFirst / classification of multi-category elements', () => {
  const vis = (on: string[], off: string[]): FilterDef[] => DEFAULT_FILTERS
    .filter(f => on.includes(f.id) || off.includes(f.id))
    .map(f => ({ ...f, hidden: false, enabled: on.includes(f.id) }))
  const BAKERY_CAFE = { shop: 'bakery', amenity: 'cafe' }

  it('puts active filters first, both groups in original order (stable)', () => {
    const fs = vis(['camper', 'cafe', 'parking'], ['bakery', 'hotel'])
    expect(activeFirst(fs).map(f => f.id)).toEqual(['parking', 'camper', 'cafe', 'bakery', 'hotel'])
  })

  it('counts hidden filters as inactive and does not mutate the input', () => {
    const fs = [{ ...byId('parking'), hidden: true }, byId('camper')]
    const before = fs.map(f => f.id)
    expect(activeFirst(fs).map(f => f.id)).toEqual(['camper', 'parking'])
    expect(fs.map(f => f.id)).toEqual(before)
  })

  it('bakery-café with bakery off and café on → café', () => {
    expect(classifyElement(BAKERY_CAFE, 'node', activeFirst(vis(['cafe'], ['bakery'])))).toBe('cafe')
  })

  it('both active → filter order wins (bakery)', () => {
    expect(classifyElement(BAKERY_CAFE, 'node', activeFirst(vis(['bakery', 'cafe'], [])))).toBe('bakery')
  })

  it('neither active → first inactive match (bakery), so it stays known', () => {
    expect(classifyElement(BAKERY_CAFE, 'node', activeFirst(vis([], ['bakery', 'cafe'])))).toBe('bakery')
  })
})

describe('bus icon', () => {
  // A filter for bus stops used to get an unrelated icon because none existed.
  it('exists and is used by the bus-stop template', () => {
    expect(FILTER_ICONS.some(i => i.id === 'bus')).toBe(true)
    expect(filterIconPath('bus')).not.toBe(FILTER_ICONS[0]!.path)
    const t = FILTER_TEMPLATES.find(x => x.name === 'Bushaltestelle')!
    expect(t.iconId).toBe('bus')
    expect(t.selectors).toEqual([{ elements: ['node', 'way'], tags: [{ key: 'highway', value: 'bus_stop' }] }])
  })
})
