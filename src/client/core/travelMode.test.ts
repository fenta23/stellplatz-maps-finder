import { describe, it, expect } from 'vitest'
import { TRAVEL_MODES, TRAVEL_MODE_LABEL, isTravelMode } from './travelMode.js'

describe('isTravelMode', () => {
  it('accepts the three modes', () => {
    for (const m of ['foot', 'bike', 'car']) expect(isTravelMode(m)).toBe(true)
  })
  it('rejects everything else', () => {
    for (const v of [null, undefined, 'walk', 'plane', '', 1, {}]) expect(isTravelMode(v)).toBe(false)
  })
})

describe('TRAVEL_MODE_LABEL', () => {
  it('has a German label for every mode', () => {
    expect(TRAVEL_MODE_LABEL).toEqual({ foot: 'Fuß', bike: 'Rad', car: 'Auto' })
    expect(Object.keys(TRAVEL_MODE_LABEL).sort()).toEqual([...TRAVEL_MODES].sort())
  })
})
