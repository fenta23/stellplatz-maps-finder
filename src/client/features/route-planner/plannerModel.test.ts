import { describe, it, expect } from 'vitest'
import { shortPlaceLabel, defaultTravelMode, isTravelMode } from './plannerModel.js'

describe('shortPlaceLabel', () => {
  it('takes the part before the first comma, trimmed', () => {
    expect(shortPlaceLabel('Eifel, Rheinland-Pfalz, Deutschland')).toBe('Eifel')
    expect(shortPlaceLabel('  Köln  , NRW')).toBe('Köln')
  })
  it('returns names without comma unchanged', () => {
    expect(shortPlaceLabel('Berlin')).toBe('Berlin')
  })
  it('falls back to the whole name when the head is empty', () => {
    expect(shortPlaceLabel(', Irgendwo')).toBe(', Irgendwo')
    expect(shortPlaceLabel('')).toBe('')
  })
})

describe('defaultTravelMode', () => {
  it('lets the stored mode win over profiles', () => {
    expect(defaultTravelMode('foot', ['camper'])).toBe('foot')
    expect(defaultTravelMode('bike', [])).toBe('bike')
  })
  it('maps single profiles', () => {
    expect(defaultTravelMode(null, ['camper'])).toBe('car')
    expect(defaultTravelMode(null, ['cyclist'])).toBe('bike')
    expect(defaultTravelMode(null, ['hiker'])).toBe('foot')
  })
  it('prefers car over bike over foot, independent of order', () => {
    expect(defaultTravelMode(null, ['hiker', 'cyclist', 'camper'])).toBe('car')
    expect(defaultTravelMode(null, ['hiker', 'cyclist'])).toBe('bike')
    expect(defaultTravelMode(null, ['cyclist', 'hiker'])).toBe('bike')
  })
  it('defaults to car without or with unknown profiles', () => {
    expect(defaultTravelMode(null, [])).toBe('car')
    expect(defaultTravelMode(null, ['unknown'])).toBe('car')
  })
})

describe('isTravelMode', () => {
  it('accepts exactly the three modes', () => {
    expect(isTravelMode('foot') && isTravelMode('bike') && isTravelMode('car')).toBe(true)
    expect(isTravelMode('plane')).toBe(false)
    expect(isTravelMode(null)).toBe(false)
  })
})
