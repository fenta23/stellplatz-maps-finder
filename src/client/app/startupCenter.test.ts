import { describe, it, expect } from 'vitest'
import { shouldCenterOnUser } from './startupCenter.js'

describe('shouldCenterOnUser', () => {
  it('centres when nothing speaks against it', () => {
    expect(shouldCenterOnUser({ userMovedMap: false, routeActive: false })).toBe(true)
  })
  it('does not centre while a route is active', () => {
    expect(shouldCenterOnUser({ userMovedMap: false, routeActive: true })).toBe(false)
  })
  it('does not centre after the user moved the map', () => {
    expect(shouldCenterOnUser({ userMovedMap: true, routeActive: false })).toBe(false)
  })
})
