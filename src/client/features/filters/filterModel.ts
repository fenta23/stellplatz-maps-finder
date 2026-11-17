import type { LatLngBounds, OsmTags } from '@/features/pois/OverpassClient.js'
import { CUSTOM_POI_ICONS, type CustomPoiIcon } from '@/features/custom-pois/CustomPoi.js'

// ── Types ──────────────────────────────────────────────────────────────────

export type OsmElementKind = 'node' | 'way' | 'relation'
export type FilterKind = 'osm' | 'personal'

/** One tag condition inside a selector. value '' means key-presence only (`["k"]`). */
export interface TagCondition {
  readonly key: string
  readonly value: string
  readonly negate?: boolean
}

/**
 * One Overpass statement group: matches the chosen element kinds where ALL tag
 * conditions hold. Multiple selectors inside a filter are ORed (separate statements).
 */
export interface OsmSelector {
  readonly elements: readonly OsmElementKind[]
  readonly tags: readonly TagCondition[]
}

/** A configurable POI group — built-in defaults, user-defined, or the personal group. */
export interface FilterDef {
  readonly id: string
  readonly name: string
  readonly iconId: string
  readonly color: string
  readonly enabled: boolean
  readonly hidden?: boolean
  readonly kind: FilterKind
  readonly builtin: boolean
  readonly order: number
  readonly selectors: readonly OsmSelector[]
}

/** True if a filter is active and should contribute to the visible POI set. */
export function isFilterActive(f: FilterDef): boolean {
  return !f.hidden && f.enabled
}

export const PERSONAL_FILTER_ID = 'personal'
export const ALL_ELEMENT_KINDS: readonly OsmElementKind[] = ['node', 'way', 'relation']

// ── Icon registry (shared with custom-POI editor) ───────────────────────────

const CLIMBING_ICON: CustomPoiIcon = {
  id: 'climbing',
  label: 'Klettern',
  path: '<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>',
}
const PERSONAL_ICON: CustomPoiIcon = {
  id: 'pin',
  label: 'Eigener Punkt',
  path: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
}

/** Union of the custom-POI icons + the climbing + personal pin, deduped by id. */
export const FILTER_ICONS: readonly CustomPoiIcon[] = (() => {
  const seen = new Set<string>()
  const out: CustomPoiIcon[] = []
  for (const ic of [...CUSTOM_POI_ICONS, CLIMBING_ICON, PERSONAL_ICON]) {
    if (seen.has(ic.id)) continue
    seen.add(ic.id)
    out.push(ic)
  }
  return out
})()

export function filterIconPath(iconId: string): string {
  return (FILTER_ICONS.find(i => i.id === iconId) ?? FILTER_ICONS[0]!).path
}

/** Full inline `<svg>` using currentColor — for chips, lists, the editor picker. */
export function filterIconSvg(iconId: string): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${filterIconPath(iconId)}</svg>`
}

// ── Colour palette for the picker ────────────────────────────────────────────

export const FILTER_COLORS: readonly string[] = [
  '#1565C0', '#2E7D32', '#E65100', '#795548', '#0277BD', '#7B1FA2',
  '#D81B60', '#00838F', '#558B2F', '#F9A825', '#455A64', '#C62828',
]

// ── Default (built-in) filters ───────────────────────────────────────────────

const N: readonly OsmElementKind[] = ['node']
const NW: readonly OsmElementKind[] = ['node', 'way']
const NWR: readonly OsmElementKind[] = ['node', 'way', 'relation']

export const DEFAULT_FILTERS: readonly FilterDef[] = [
  {
    id: 'parking', name: 'Parkplatz', iconId: 'parking', color: '#1565C0',
    enabled: true, kind: 'osm', builtin: true, order: 0,
    selectors: [{ elements: NW, tags: [{ key: 'amenity', value: 'parking' }, { key: 'motorhome', value: 'yes', negate: true }] }],
  },
  {
    id: 'camper', name: 'Camper-Stellplatz', iconId: 'camper', color: '#2E7D32',
    enabled: true, kind: 'osm', builtin: true, order: 1,
    selectors: [
      { elements: NWR, tags: [{ key: 'tourism', value: 'camp_pitch' }] },
      { elements: NW, tags: [{ key: 'amenity', value: 'parking' }, { key: 'motorhome', value: 'yes' }] },
      { elements: NWR, tags: [{ key: 'tourism', value: 'caravan_site' }] },
    ],
  },
  {
    id: 'campsite', name: 'Campingplatz', iconId: 'campsite', color: '#E65100',
    enabled: true, kind: 'osm', builtin: true, order: 2,
    selectors: [{ elements: NWR, tags: [{ key: 'tourism', value: 'camp_site' }] }],
  },
  {
    id: 'dump', name: 'Entsorgung', iconId: 'dump', color: '#795548',
    enabled: true, kind: 'osm', builtin: true, order: 3,
    selectors: [{ elements: NW, tags: [{ key: 'amenity', value: 'sanitary_dump_station' }] }],
  },
  {
    id: 'water', name: 'Wasser', iconId: 'water', color: '#0277BD',
    enabled: true, kind: 'osm', builtin: true, order: 4,
    selectors: [{ elements: NW, tags: [{ key: 'amenity', value: 'water_point' }] }],
  },
  {
    id: 'climbing', name: 'Klettergebiet', iconId: 'climbing', color: '#7B1FA2',
    enabled: true, kind: 'osm', builtin: true, order: 5,
    selectors: [{ elements: NWR, tags: [{ key: 'sport', value: 'climbing' }] }],
  },
  {
    id: PERSONAL_FILTER_ID, name: 'Eigene POIs', iconId: 'pin', color: '#D81B60',
    enabled: true, kind: 'personal', builtin: true, order: 6,
    selectors: [],
  },
  {
    // Bewirtschaftete + unbewirtschaftete Hütten. Steht VOR 'shelter', damit eine
    // Hütte, die zusätzlich amenity=shelter trägt, hier landet (classifyElement
    // nimmt den ersten Treffer in Store-Reihenfolge).
    // enabled: false — die Chips sind sichtbar (nur !hidden zaehlt fuer die
    // Leiste), aber inaktiv: bestehende Nutzer bekommen nicht ungefragt zwei
    // neue POI-Typen auf die Karte, ein Tap auf den Chip schaltet sie an.
    id: 'hut', name: 'Hütte', iconId: 'hut', color: '#00838F',
    enabled: false, kind: 'osm', builtin: true, order: 7,
    selectors: [
      { elements: NW, tags: [{ key: 'tourism', value: 'wilderness_hut' }] },
      { elements: NW, tags: [{ key: 'tourism', value: 'alpine_hut' }] },
    ],
  },
  {
    // amenity=shelter ist zu ~90 % (DE) mit shelter_type=public_transport getaggt,
    // also Bushaltestellen-Wartehäuschen. Ohne die Ausschlüsse ist die Karte
    // unbrauchbar (Raum München: 2733 -> 242 Treffer). Overpass' != matcht auch
    // Objekte OHNE den Key — Shelter ohne shelter_type bleiben also drin, das
    // sind oft die interessanten Waldhütten.
    //
    // Genau MAX_SELECTOR_CONDITIONS (4) Bedingungen: das Backend akzeptiert pro
    // Statement nur {1,4} Tag-Filter (_shared/utils.ts, STATEMENT), alles darüber
    // gibt 400 "Unsupported query shape" — und weil alle Filter in einer Query
    // landen, killt das den kompletten POI-Abruf. Deshalb nur die drei häufigsten
    // Störtypen (public_transport 49 %, picnic_shelter 21 %, gazebo 11 %);
    // sun_shelter/pergola/field_shelter bleiben als Restrauschen drin.
    id: 'shelter', name: 'Schutzhütte', iconId: 'shelter', color: '#455A64',
    enabled: false, kind: 'osm', builtin: true, order: 8,
    selectors: [{
      elements: NW,
      tags: [
        { key: 'amenity', value: 'shelter' },
        { key: 'shelter_type', value: 'public_transport', negate: true },
        { key: 'shelter_type', value: 'picnic_shelter', negate: true },
        { key: 'shelter_type', value: 'gazebo', negate: true },
      ],
    }],
  },
]

/** The set of built-in ids whose OSM tags must not be edited/deleted. */
export const BUILTIN_FILTER_IDS: ReadonlySet<string> = new Set(DEFAULT_FILTERS.map(f => f.id))

// ── Curated templates for "new filter" ───────────────────────────────────────

export interface FilterTemplate {
  readonly name: string
  readonly iconId: string
  readonly color: string
  readonly selectors: readonly OsmSelector[]
}

const tmpl = (name: string, iconId: string, color: string, key: string, value: string, elements = NW): FilterTemplate =>
  ({ name, iconId, color, selectors: [{ elements, tags: [{ key, value }] }] })

export const FILTER_TEMPLATES: readonly FilterTemplate[] = [
  tmpl('Tankstelle', 'fuel', '#C62828', 'amenity', 'fuel'),
  tmpl('Supermarkt', 'supermarket', '#558B2F', 'shop', 'supermarket'),
  tmpl('Bäckerei', 'bakery', '#F9A825', 'shop', 'bakery'),
  tmpl('Apotheke', 'pharmacy', '#D81B60', 'amenity', 'pharmacy'),
  tmpl('Restaurant', 'restaurant', '#6A1B9A', 'amenity', 'restaurant'),
  tmpl('Toilette', 'toilet', '#455A64', 'amenity', 'toilets'),
  tmpl('Trinkwasser', 'water', '#0277BD', 'amenity', 'drinking_water'),
  tmpl('Ladestation', 'charging', '#00838F', 'amenity', 'charging_station'),
  tmpl('Aussichtspunkt', 'viewpoint', '#2E7D32', 'tourism', 'viewpoint', NWR),
  tmpl('Picknickplatz', 'bbq', '#795548', 'tourism', 'picnic_site', NWR),
  tmpl('Spielplatz', 'playground', '#E65100', 'leisure', 'playground', NWR),
  tmpl('Badestelle', 'swimming', '#1565C0', 'leisure', 'swimming_area', NWR),
  tmpl('Dusche', 'shower', '#00838F', 'amenity', 'shower'),
  tmpl('Wohnmobil-Service', 'service', '#5D4037', 'shop', 'caravan'),
]

// ── Query building ───────────────────────────────────────────────────────────

const TAG_TOKEN_RE = /^[\w:-]+$/

/** A tag token is grammar-valid for the backend query allowlist (`[\w:-]+`). */
export function isValidTagToken(s: string): boolean {
  return TAG_TOKEN_RE.test(s)
}

function tagConditionToString(c: TagCondition): string {
  if (c.value === '') return `["${c.key}"]`
  return c.negate ? `["${c.key}"!="${c.value}"]` : `["${c.key}"="${c.value}"]`
}

/** `area` is the content of the trailing clause: a bbox (`s,w,n,e`) or `around:R,lat,lon,…`. */
function selectorToStatements(sel: OsmSelector, area: string): string[] {
  const tagStr = sel.tags.map(tagConditionToString).join('')
  return sel.elements.map(el => `${el}${tagStr}(${area});`)
}

/** Statements for all usable (osm, valid-selector) filters, in filter/selector order. */
function filtersToStatements(filters: readonly FilterDef[], area: string): string[] {
  const parts: string[] = []
  for (const f of filters) {
    if (f.kind !== 'osm') continue
    for (const sel of f.selectors) {
      if (!isValidSelector(sel)) continue
      parts.push(...selectorToStatements(sel, area))
    }
  }
  return parts
}

/** True if a tag condition is structurally valid (keys/values grammar-conform). */
export function isValidCondition(c: TagCondition): boolean {
  if (!isValidTagToken(c.key)) return false
  if (c.value === '') return true // key-presence
  return isValidTagToken(c.value)
}

/**
 * Max. Tag-Bedingungen pro Selector. Muss zum Backend passen: die Query-Allowlist
 * in `supabase/functions/_shared/utils.ts` erlaubt pro Statement `{1,4}` Tag-Filter
 * (`STATEMENT`). Mehr gibt 400 "Unsupported query shape" — und da alle aktiven
 * Filter in EINER Overpass-Query landen, bricht damit der komplette POI-Abruf,
 * nicht nur der eine Filter. Wer hier hochgeht, muss das Backend mit-deployen.
 */
export const MAX_SELECTOR_CONDITIONS = 4

export function isValidSelector(sel: OsmSelector): boolean {
  if (sel.elements.length === 0) return false
  if (sel.tags.length === 0 || sel.tags.length > MAX_SELECTOR_CONDITIONS) return false
  return sel.tags.every(isValidCondition)
}

/** Build an Overpass query from the enabled OSM filters' selectors. */
export function buildOverpassQuery(bounds: LatLngBounds, filters: readonly FilterDef[]): string {
  const { south, west, north, east } = bounds
  const bbox = `${south},${west},${north},${east}`
  const parts = filtersToStatements(filters, bbox)
  return `[out:json][timeout:30];\n(\n  ${parts.join('\n  ')}\n);\nout center tags;`
}

const roundCoord = (n: number): string => String(Number(n.toFixed(5)))

/**
 * Overpass query for POIs within `radiusM` metres of a polyline (route corridor),
 * using the polyline form `(around:R,lat1,lon1,lat2,lon2,…)` (Overpass >= 0.7.55).
 * The coordinate list is repeated in every statement: Overpass QL has no way to
 * reference a polyline by name, and collecting all objects near the line first
 * (`nwr(around…)->.a; node.a[…]`) would pull in everything, not just matches.
 *
 * Returns '' ("nothing to query", callers must skip the request) when the line
 * has fewer than 2 points, the radius is not a positive number, or no filter
 * contributes a statement. (The bbox variant has no such guard; its caller checks.)
 */
export function buildOverpassAroundQuery(
  line: readonly (readonly [lat: number, lon: number])[],
  radiusM: number,
  filters: readonly FilterDef[],
): string {
  const r = Math.round(radiusM)
  if (line.length < 2 || !(r > 0)) return ''
  const coords = line.map(([lat, lon]) => `${roundCoord(lat)},${roundCoord(lon)}`).join(',')
  const parts = filtersToStatements(filters, `around:${r},${coords}`)
  if (parts.length === 0) return ''
  return `[out:json][timeout:60];\n(\n  ${parts.join('\n  ')}\n);\nout center tags;`
}

// ── Classification (OSM element → filter id) ─────────────────────────────────

function conditionMatches(tags: OsmTags, c: TagCondition): boolean {
  const actual = tags[c.key]
  if (c.value === '') return actual !== undefined // key-presence
  if (c.negate) return actual !== c.value
  return actual === c.value
}

function selectorMatches(tags: OsmTags, elementType: OsmElementKind, sel: OsmSelector): boolean {
  if (!sel.elements.includes(elementType)) return false
  return sel.tags.every(c => conditionMatches(tags, c))
}

/**
 * Return the id of the first OSM filter (in given order) that claims this element,
 * or null if none match. `filters` should be ordered (use store order).
 */
export function classifyElement(
  tags: OsmTags,
  elementType: OsmElementKind,
  filters: readonly FilterDef[],
): string | null {
  for (const f of filters) {
    if (f.kind !== 'osm') continue
    if (f.selectors.some(sel => selectorMatches(tags, elementType, sel))) return f.id
  }
  return null
}
