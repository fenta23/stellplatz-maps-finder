import { describe, expect, it } from 'vitest'
import { isRouteSource, sourceLabel } from './routeTypes.js'

describe('isRouteSource', () => {
  it.each(['gpx', 'komoot', 'planned'])('accepts %s', (v) => expect(isRouteSource(v)).toBe(true))
  it.each(['ftp', '', 'GPX', null, undefined, 3, {}])('rejects %j', (v) => expect(isRouteSource(v)).toBe(false))
})

describe('sourceLabel', () => {
  it('names every source in German', () => {
    expect(sourceLabel('gpx')).toBe('GPX')
    expect(sourceLabel('komoot')).toBe('Komoot')
    expect(sourceLabel('planned')).toBe('Geplant')
  })
})
