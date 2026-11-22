import { describe, it, expect } from 'vitest'
import { routeRowTexts } from './routeRows.js'

describe('trackRowTexts', () => {
  it('uses the name as title and the type label as subtitle', () => {
    expect(routeRowTexts('Camping Eifel', 'Campingplatz')).toEqual({ title: 'Camping Eifel', subtitle: 'Campingplatz' })
  })
  it('does not repeat the type label for unnamed POIs', () => {
    expect(routeRowTexts(undefined, 'Parkplatz')).toEqual({ title: 'Parkplatz', subtitle: '' })
    expect(routeRowTexts('  ', 'Parkplatz')).toEqual({ title: 'Parkplatz', subtitle: '' })
  })
  it('adds the winter hint only for cemeteries in winter', () => {
    const winter = new Date(2026, 0, 15), summer = new Date(2026, 6, 15)
    expect(routeRowTexts('Friedhof Nord', 'Friedhof', { type: 'cemetery', now: winter }))
      .toEqual({ title: 'Friedhof Nord', subtitle: 'Friedhof', hint: 'Wasser im Winter oft abgestellt' })
    expect(routeRowTexts('Friedhof Nord', 'Friedhof', { type: 'cemetery', now: summer })).not.toHaveProperty('hint')
    expect(routeRowTexts('Camp', 'Campingplatz', { type: 'campsite', now: winter })).not.toHaveProperty('hint')
  })
})
