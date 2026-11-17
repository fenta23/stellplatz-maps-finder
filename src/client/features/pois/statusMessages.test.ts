import { describe, it, expect } from 'vitest'
import { overpassErrorMessage, poiCountMessage, trackPoiCountMessage } from './statusMessages.js'

describe('overpassErrorMessage', () => {
  it('maps 429 to a rate-limit hint', () => {
    expect(overpassErrorMessage(new Error('Overpass proxy error: 429'))).toContain('überlastet')
  })
  it('maps 503 to an unreachable hint', () => {
    expect(overpassErrorMessage(new Error('Overpass proxy error: 503'))).toContain('nicht erreichbar')
  })
  it('maps a network fetch failure to the unreachable hint', () => {
    expect(overpassErrorMessage(new TypeError('Failed to fetch'))).toContain('nicht erreichbar')
  })
  it('falls back to a generic message', () => {
    expect(overpassErrorMessage(new Error('weird'))).toBe('Fehler beim Laden der Daten')
  })
  it('handles non-Error values', () => {
    expect(overpassErrorMessage(null)).toBe('Fehler beim Laden der Daten')
  })
})

describe('poiCountMessage', () => {
  it('reports a count', () => expect(poiCountMessage(5)).toBe('5 Orte gefunden'))
  it('reports empty', () => expect(poiCountMessage(0)).toBe('Keine Orte in diesem Bereich'))
})

describe('trackPoiCountMessage', () => {
  it('uses singular and plural', () => {
    expect(trackPoiCountMessage(1)).toBe('1 Ort entlang der Route')
    expect(trackPoiCountMessage(42)).toBe('42 Orte entlang der Route')
    expect(trackPoiCountMessage(0)).toBe('0 Orte entlang der Route')
  })
})
