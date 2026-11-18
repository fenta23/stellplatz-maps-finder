import { describe, it, expect } from 'vitest'
import {
  KNOWN_FILTER_IDS, validateIntent, intentHasActions, parseChatResponse,
} from './intentSchema.js'

describe('KNOWN_FILTER_IDS', () => {
  it('contains the built-in OSM filters', () => {
    expect(KNOWN_FILTER_IDS).toContain('camper')
    expect(KNOWN_FILTER_IDS).toContain('dump')
    expect(KNOWN_FILTER_IDS).toContain('water')
  })
  it('does not contain the personal filter', () => {
    expect(KNOWN_FILTER_IDS).not.toContain('personal')
  })
})

describe('validateIntent — enableFilters allowlist', () => {
  it('keeps known ids and drops unknown / injected ones', () => {
    const intent = validateIntent({ enableFilters: ['camper', 'dump', 'nonsense', '__proto__'] })
    expect(intent?.enableFilters).toEqual(['camper', 'dump'])
  })
  it('dedupes repeated ids', () => {
    const intent = validateIntent({ enableFilters: ['water', 'water', 'water'] })
    expect(intent?.enableFilters).toEqual(['water'])
  })
  it('ignores non-string entries', () => {
    const intent = validateIntent({ enableFilters: ['camper', 42, null, { id: 'dump' }] })
    expect(intent?.enableFilters).toEqual(['camper'])
  })
})

describe('validateIntent — place', () => {
  it('trims a place string, or null when empty/missing', () => {
    expect(validateIntent({ place: '  Bodensee ' })?.place).toBe('Bodensee')
    expect(validateIntent({ place: '   ' })?.place).toBeNull()
    expect(validateIntent({})?.place).toBeNull()
  })
})

describe('validateIntent — adHocFilters', () => {
  it('builds a valid filter from a real OSM tag selector', () => {
    const intent = validateIntent({
      adHocFilters: [{ name: 'Dusche', iconId: 'shower', selectors: [
        { elements: ['node'], tags: [{ key: 'amenity', value: 'shower' }] },
      ] }],
    })
    const f = intent?.adHocFilters[0]
    expect(f).toBeDefined()
    expect(f?.name).toBe('Dusche')
    expect(f?.kind).toBe('osm')
    expect(f?.builtin).toBe(false)
    expect(f?.enabled).toBe(true)
    expect(f?.id).toBe('ai:dusche')
    expect(f?.selectors[0]?.tags[0]).toMatchObject({ key: 'amenity', value: 'shower' })
  })

  it('falls back to a known iconId when an unknown one is given', () => {
    const intent = validateIntent({
      adHocFilters: [{ name: 'X', iconId: 'definitely-not-an-icon', selectors: [
        { elements: ['node'], tags: [{ key: 'amenity', value: 'fuel' }] },
      ] }],
    })
    expect(intent?.adHocFilters[0]?.iconId).toBe('pin')
  })

  it('drops filters with no name or no valid selector', () => {
    const intent = validateIntent({
      adHocFilters: [
        { name: '', selectors: [{ elements: ['node'], tags: [{ key: 'amenity', value: 'fuel' }] }] },
        { name: 'NoTags', selectors: [{ elements: ['node'], tags: [] }] },
        { name: 'BadValue', selectors: [{ elements: ['node'], tags: [{ key: 'amenity', value: 'fast food' }] }] },
      ],
    })
    expect(intent?.adHocFilters).toEqual([])
  })

  it('defaults missing elements to all kinds', () => {
    const intent = validateIntent({
      adHocFilters: [{ name: 'Toilette', selectors: [{ tags: [{ key: 'amenity', value: 'toilets' }] }] }],
    })
    expect(intent?.adHocFilters[0]?.selectors[0]?.elements).toEqual(['node', 'way', 'relation'])
  })
})

describe('validateIntent — route', () => {
  const route = (r: unknown) => validateIntent({ route: r })?.route
  it('accepts a full route and trims', () => {
    expect(route({ from: ' Konstanz ', to: ' Lindau', mode: 'bike' }))
      .toEqual({ from: 'Konstanz', to: 'Lindau', mode: 'bike' })
  })
  it('allows from null / missing (own location)', () => {
    expect(route({ from: null, to: 'Lindau', mode: 'foot' })?.from).toBeNull()
    expect(route({ to: 'Lindau' })).toEqual({ from: null, to: 'Lindau', mode: null })
  })
  it('drops unknown modes to null', () => {
    expect(route({ to: 'Lindau', mode: 'rocket' })?.mode).toBeNull()
    expect(route({ to: 'Lindau', mode: 5 })?.mode).toBeNull()
  })
  it('is null without a usable "to"', () => {
    expect(route({ from: 'Konstanz' })).toBeNull()
    expect(route({ from: 'Konstanz', to: '  ' })).toBeNull()
    expect(route({ from: 'Konstanz', to: 42 })).toBeNull()
  })
  it('is null when route is not an object', () => {
    expect(route('Lindau')).toBeNull()
    expect(route(['Lindau'])).toBeNull()
    expect(route(null)).toBeNull()
  })
  it('is null when from equals to (case-insensitive)', () => {
    expect(route({ from: 'lindau ', to: 'Lindau' })).toBeNull()
  })
  it('is null when the route field is missing', () => {
    expect(validateIntent({ place: 'X' })?.route).toBeNull()
  })
  it('leaves place untouched', () => {
    expect(validateIntent({ place: 'Lindau', route: { to: 'Lindau' } })?.place).toBe('Lindau')
  })
})

describe('intentHasActions', () => {
  it('is false for null or an empty intent', () => {
    expect(intentHasActions(null)).toBe(false)
    expect(intentHasActions(validateIntent({}))).toBe(false)
  })
  it('is true when any action is present', () => {
    expect(intentHasActions(validateIntent({ place: 'Köln' }))).toBe(true)
    expect(intentHasActions(validateIntent({ enableFilters: ['camper'] }))).toBe(true)
    expect(intentHasActions(validateIntent({ route: { to: 'Lindau' } }))).toBe(true)
  })
})

describe('parseChatResponse', () => {
  it('passes a valid ready response with a usable intent', () => {
    const res = parseChatResponse({
      status: 'ready',
      reply: 'Zeige Camper-Stellplätze am Bodensee.',
      intent: { place: 'Bodensee', enableFilters: ['camper'] },
    })
    expect(res.status).toBe('ready')
    expect(res.intent?.enableFilters).toEqual(['camper'])
    expect(res.intent?.place).toBe('Bodensee')
  })

  it('keeps ready when only a route is present', () => {
    const res = parseChatResponse({ status: 'ready', reply: 'Ok', intent: { route: { from: 'Konstanz', to: 'Lindau', mode: 'bike' } } })
    expect(res.status).toBe('ready')
    expect(res.intent?.route).toEqual({ from: 'Konstanz', to: 'Lindau', mode: 'bike' })
  })

  it('downgrades ready→clarify when the intent has no real actions', () => {
    const res = parseChatResponse({ status: 'ready', reply: 'Ok', intent: { enableFilters: ['bogus'] } })
    expect(res.status).toBe('clarify')
    expect(res.intent).toBeNull()
  })

  it('strips any intent on offtopic and keeps the reply', () => {
    const res = parseChatResponse({
      status: 'offtopic',
      reply: 'Ich helfe nur bei der Ortssuche.',
      intent: { enableFilters: ['camper'] },
    })
    expect(res.status).toBe('offtopic')
    expect(res.intent).toBeNull()
  })

  it('falls back to clarify with a default reply for garbage input', () => {
    const res = parseChatResponse('not even an object')
    expect(res.status).toBe('clarify')
    expect(res.reply.length).toBeGreaterThan(0)
  })

  it('supplies a German fallback reply per status when reply is missing', () => {
    expect(parseChatResponse({ status: 'offtopic' }).reply).toMatch(/Karte|Ortssuche|Orten/i)
    expect(parseChatResponse({ status: 'error' }).reply).toMatch(/erreichbar|nicht/i)
  })
})
