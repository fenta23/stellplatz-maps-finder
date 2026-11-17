import { describe, it, expect } from 'vitest'
import { haversineMeters } from './geo.js'

describe('haversineMeters', () => {
  it('returns ~0 for identical points', () => {
    expect(haversineMeters({ lat: 48, lon: 11 }, { lat: 48, lon: 11 })).toBeCloseTo(0)
  })

  it('returns ~111km per degree latitude', () => {
    const d = haversineMeters({ lat: 48, lon: 11 }, { lat: 49, lon: 11 })
    expect(d).toBeGreaterThan(110_000)
    expect(d).toBeLessThan(113_000)
  })

  it('is symmetric', () => {
    const a = { lat: 48.1, lon: 11.5 }
    const b = { lat: 48.5, lon: 11.1 }
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 0)
  })
})
