import { describe, it, expect } from 'vitest'
import { trackRowTexts } from './trackRows.js'

describe('trackRowTexts', () => {
  it('uses the name as title and the type label as subtitle', () => {
    expect(trackRowTexts('Camping Eifel', 'Campingplatz')).toEqual({ title: 'Camping Eifel', subtitle: 'Campingplatz' })
  })
  it('does not repeat the type label for unnamed POIs', () => {
    expect(trackRowTexts(undefined, 'Parkplatz')).toEqual({ title: 'Parkplatz', subtitle: '' })
    expect(trackRowTexts('  ', 'Parkplatz')).toEqual({ title: 'Parkplatz', subtitle: '' })
  })
  it('adds the winter hint only for cemeteries in winter', () => {
    const winter = new Date(2026, 0, 15), summer = new Date(2026, 6, 15)
    expect(trackRowTexts('Friedhof Nord', 'Friedhof', { type: 'cemetery', now: winter }))
      .toEqual({ title: 'Friedhof Nord', subtitle: 'Friedhof', hint: 'Wasser im Winter oft abgestellt' })
    expect(trackRowTexts('Friedhof Nord', 'Friedhof', { type: 'cemetery', now: summer })).not.toHaveProperty('hint')
    expect(trackRowTexts('Camp', 'Campingplatz', { type: 'campsite', now: winter })).not.toHaveProperty('hint')
  })
})
