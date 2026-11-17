import { describe, it, expect } from 'vitest'
import { formatRouteOffset } from './format.js'

describe('formatRouteOffset', () => {
  it('says "an der Route" for offsets rounding below 10 m', () => {
    for (const m of [0, 4, 4.9]) expect(formatRouteOffset(m)).toBe('an der Route')
  })
  it('rounds to 10 m steps below 1 km', () => {
    expect(formatRouteOffset(5)).toBe('10 m abseits')
    expect(formatRouteOffset(14)).toBe('10 m abseits')
    expect(formatRouteOffset(15)).toBe('20 m abseits')
    expect(formatRouteOffset(65)).toBe('70 m abseits')
    expect(formatRouteOffset(994)).toBe('990 m abseits')
  })
  it('switches to km with a German decimal comma from 995 m', () => {
    expect(formatRouteOffset(995)).toBe('1,0 km abseits')
    expect(formatRouteOffset(1000)).toBe('1,0 km abseits')
    expect(formatRouteOffset(1234)).toBe('1,2 km abseits')
    expect(formatRouteOffset(2000)).toBe('2,0 km abseits')
  })
})
