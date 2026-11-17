import { describe, it, expect, vi } from 'vitest'
import { createNearbyWiring } from './nearbyWiring.js'
import type { NearbyItem } from '@/features/poi-detail/PoiDetailPanel.js'

const FUEL: NearbyItem = { kind: 'fuel', name: 'Aral', distance: 1100, lat: 48.1, lon: 9.2 }
const BAKERY: NearbyItem = { kind: 'bakery', name: 'Bäcker Müller', distance: 300, lat: 48.2, lon: 9.3 }

function setup() {
  const target = { show: vi.fn(), clear: vi.fn() }
  const centerOn = vi.fn()
  const flash = vi.fn()
  const iconFor = vi.fn((k: string) => (k === 'fuel' ? '<svg id="fuel"/>' : undefined))
  const wiring = createNearbyWiring({ target, centerOn, iconFor, flash })
  return { wiring, target, centerOn, flash, iconFor }
}

describe('createNearbyWiring', () => {
  it('selecting a nearby entry marks its position on the map', () => {
    const { wiring, target } = setup()
    wiring.select(FUEL)
    expect(target.show).toHaveBeenCalledTimes(1)
    expect(target.show).toHaveBeenCalledWith(
      expect.objectContaining({ lat: 48.1, lon: 9.2 }),
      { label: 'Aral', iconSvg: '<svg id="fuel"/>' },
    )
  })

  it('passes no icon when the kind has none', () => {
    const { wiring, target } = setup()
    wiring.select(BAKERY)
    expect(target.show).toHaveBeenCalledWith(expect.anything(), { label: 'Bäcker Müller' })
  })

  it('centres the map on the entry', () => {
    const { wiring, centerOn } = setup()
    wiring.select(FUEL)
    expect(centerOn).toHaveBeenCalledWith(expect.objectContaining({ lat: 48.1, lon: 9.2 }))
  })

  it('flashes the name and distance', () => {
    const { wiring, flash } = setup()
    wiring.select(FUEL)
    expect(flash).toHaveBeenCalledWith('Aral · 1.1 km Luftlinie')
  })

  it('selecting another entry shows the new target (replaces the old one)', () => {
    const { wiring, target } = setup()
    wiring.select(FUEL)
    wiring.select(BAKERY)
    expect(target.show).toHaveBeenCalledTimes(2)
    expect(target.show).toHaveBeenLastCalledWith(expect.objectContaining({ lat: 48.2 }), expect.objectContaining({ label: 'Bäcker Müller' }))
  })

  it('clear removes the target', () => {
    const { wiring, target } = setup()
    wiring.clear()
    expect(target.clear).toHaveBeenCalledTimes(1)
  })
})
