import { describe, it, expect } from 'vitest'
import { typeLabel, bool, formatMeters, trackInfoText, esc, safeUrl, TYPE_LABELS, ACCESS_LABELS } from './poiLabels.js'

describe('typeLabel', () => {
  it('returns the German label for known types', () => {
    expect(typeLabel('parking')).toBe('Parkplatz')
    expect(typeLabel('camper')).toBe('Camper-Stellplatz')
    expect(typeLabel('campsite')).toBe('Campingplatz')
    expect(typeLabel('dump')).toBe('Entsorgungsstation')
    expect(typeLabel('water')).toBe('Wasserstelle')
  })

  it('falls back to Ort for unknown types', () => {
    expect(typeLabel('whatever' as never)).toBe('Ort')
  })

  // Regression: the panel showed the generic "Ort" for every category outside
  // the five hard-coded ones (climbing, huts, and all newer filters).
  it('uses the filter name for categories without a panel-specific label', () => {
    expect(typeLabel('hut')).toBe('Hütte')
    expect(typeLabel('climbing')).toBe('Klettergebiet')
    expect(typeLabel('cemetery')).toBe('Friedhof (Wasser)')
    expect(typeLabel('hotel')).toBe('Unterkunft')
    expect(typeLabel('restaurant')).toBe('Restaurant')
  })

  it('is not fooled by inherited object keys', () => {
    expect(typeLabel('constructor' as never)).toBe('Ort')
  })
})

describe('bool', () => {
  it('maps yes/no/limited', () => {
    expect(bool('yes')).toBe('Ja')
    expect(bool('no')).toBe('Nein')
    expect(bool('limited')).toBe('Begrenzt')
  })

  it('returns undefined for undefined', () => {
    expect(bool(undefined)).toBeUndefined()
  })

  it('passes through unknown values', () => {
    expect(bool('maybe')).toBe('maybe')
  })
})

describe('formatMeters', () => {
  it('formats under 1000 m as meters', () => {
    expect(formatMeters(500)).toBe('500 m')
    expect(formatMeters(0)).toBe('0 m')
  })

  it('formats 1000+ m as km', () => {
    expect(formatMeters(1000)).toBe('1.0 km')
    expect(formatMeters(1520)).toBe('1.5 km')
    expect(formatMeters(25000)).toBe('25.0 km')
  })
})

describe('esc', () => {
  it('escapes HTML special characters', () => {
    expect(esc('<script>&&"</script>')).toBe('&lt;script&gt;&amp;&amp;&quot;&lt;/script&gt;')
  })

  it('passes through safe strings', () => {
    expect(esc('Hello World')).toBe('Hello World')
  })
})

describe('safeUrl', () => {
  it('allows http and https', () => {
    expect(safeUrl('http://example.com')).toBe('http://example.com')
    expect(safeUrl('https://example.com')).toBe('https://example.com')
  })

  it('allows tel: and mailto:', () => {
    expect(safeUrl('tel:+4912345')).toBe('tel:+4912345')
    expect(safeUrl('mailto:test@example.com')).toBe('mailto:test@example.com')
  })

  it('blocks javascript: protocol', () => {
    expect(safeUrl('javascript:alert(1)')).toBe('#')
  })

  it('returns # for invalid URLs', () => {
    expect(safeUrl('')).toBe('#')
  })
})

describe('label maps', () => {
  it('ACCESS_LABELS contains expected keys', () => {
    expect(ACCESS_LABELS['public']).toBe('Öffentlich')
  })

  it('TYPE_LABELS has all types', () => {
    expect(Object.keys(TYPE_LABELS)).toEqual(['parking', 'camper', 'campsite', 'dump', 'water'])
  })
})

describe('trackInfoText', () => {
  it('formats km with German decimal comma and offset in metres', () => {
    expect(trackInfoText({ kmAlong: 12.4, kmToEnd: 73.6, offsetM: 180 }))
      .toBe('Route: km 12,4 · noch 73,6 km · 180 m abseits')
  })
  it('rounds metres and switches to km from 1000 m', () => {
    expect(trackInfoText({ kmAlong: 0, kmToEnd: 5, offsetM: 10.4 })).toBe('Route: km 0,0 · noch 5,0 km · 10 m abseits')
    expect(trackInfoText({ kmAlong: 1, kmToEnd: 2, offsetM: 1234 })).toBe('Route: km 1,0 · noch 2,0 km · 1,2 km abseits')
  })
  it('says "an der Route" below 10 m', () => {
    expect(trackInfoText({ kmAlong: 3.04, kmToEnd: 1, offsetM: 9.9 })).toBe('Route: km 3,0 · noch 1,0 km · an der Route')
    expect(trackInfoText({ kmAlong: 3, kmToEnd: 1, offsetM: 0 })).toContain('an der Route')
  })
})
