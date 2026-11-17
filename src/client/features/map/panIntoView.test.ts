import { describe, it, expect } from 'vitest'
import { computePan, computeCenterPan, freeMapArea, PANEL_WIDTH, MIN_FREE_PX } from './panIntoView.js'

const base = { mapWidth: 1000, mapTop: 160, viewportHeight: 800 }

describe('computePan — mobile (bottom sheet)', () => {
  it('pans a POI hidden behind the sheet upward (dy > 0)', () => {
    const { dx, dy } = computePan({ ...base, isMobile: true, poi: { x: 180, y: 620 } })
    expect(dx).toBe(0)
    expect(dy).toBeGreaterThan(0)
  })

  it('leaves a POI already above the sheet untouched (dy = 0)', () => {
    const { dx, dy } = computePan({ ...base, isMobile: true, poi: { x: 180, y: 30 } })
    expect(dx).toBe(0)
    expect(dy).toBe(0)
  })
})

describe('computePan — desktop (side panel)', () => {
  it('pans a POI behind the right-side panel leftward (dx > 0)', () => {
    const { dx, dy } = computePan({ ...base, isMobile: false, poi: { x: 950, y: 400 } })
    expect(dy).toBe(0)
    expect(dx).toBeGreaterThan(0)
  })

  it('leaves a POI already in the visible left strip untouched (dx = 0)', () => {
    const { dx, dy } = computePan({ ...base, isMobile: false, poi: { x: 100, y: 400 } })
    expect(dx).toBe(0)
    expect(dy).toBe(0)
  })
})

describe('freeMapArea', () => {
  const size = { mapWidth: 1400, mapHeight: 900, containerTop: 0, viewportHeight: 900 }

  it('desktop: between the track panel on the left and the detail panel on the right, below the header', () => {
    expect(freeMapArea({ ...size, isMobile: false, covered: { left: 300, top: 100 } }))
      .toEqual({ left: 300, top: 100, right: 1400 - PANEL_WIDTH, bottom: 900 })
  })

  it('desktop without other UI: everything left of the detail panel', () => {
    expect(freeMapArea({ ...size, isMobile: false }))
      .toEqual({ left: 0, top: 0, right: 1400 - PANEL_WIDTH, bottom: 900 })
  })

  it('mobile: the strip above the 60 % bottom sheet, full width', () => {
    const area = freeMapArea({ ...size, mapWidth: 390, isMobile: true, covered: { left: 300, top: 100, bottom: 56 } })
    expect(area.left).toBe(0)
    expect(area.right).toBe(390)
    expect(area.top).toBe(100)
    expect(area.bottom).toBeCloseTo(360, 5) // 40 % of 900
  })
})

describe('computeCenterPan', () => {
  const map = { width: 1400, height: 900 }
  const area = { left: 300, top: 100, right: 1080, bottom: 900 } // centre (690, 500)

  it('moves the POI to the middle of the free area from any side', () => {
    expect(computeCenterPan({ x: 1000, y: 800 }, area, map)).toEqual({ dx: 310, dy: 300 })
    expect(computeCenterPan({ x: 400, y: 200 }, area, map)).toEqual({ dx: -290, dy: -300 })
  })

  it('does not move a POI that is already there', () => {
    expect(computeCenterPan({ x: 690, y: 500 }, area, map)).toEqual({ dx: 0, dy: 0 })
  })

  it('aims for the map centre on an axis with too little free room', () => {
    const narrow = { left: 300, top: 100, right: 300 + MIN_FREE_PX - 1, bottom: 900 }
    expect(computeCenterPan({ x: 700, y: 500 }, narrow, map)).toEqual({ dx: 0, dy: 0 })
  })
})
