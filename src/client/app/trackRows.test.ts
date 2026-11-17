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
})
