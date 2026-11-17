import { describe, it, expect } from 'vitest'
import { nearbyMessage } from './nearbyMessage.js'
import type { NearbyItem } from './PoiDetailPanel.js'

const item: NearbyItem = { kind: 'fuel', name: 'Esso', distance: 545, lat: 48.1, lon: 11.5 }

describe('nearbyMessage', () => {
  it('shows name · distance Luftlinie', () => {
    expect(nearbyMessage(item)).toBe('Esso · 545 m Luftlinie')
  })

  it('formats distances >= 1 km in km', () => {
    expect(nearbyMessage({ ...item, distance: 1250 })).toBe('Esso · 1.3 km Luftlinie')
  })

  it('never contains "undefined" (regression: the old item.icon bug)', () => {
    expect(nearbyMessage(item)).not.toContain('undefined')
  })
})
