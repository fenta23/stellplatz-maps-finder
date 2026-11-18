import { describe, expect, it } from 'vitest'
import { isTrackSource, sourceLabel } from './trackTypes.js'

describe('isTrackSource', () => {
  it.each(['gpx', 'komoot', 'planned'])('accepts %s', (v) => expect(isTrackSource(v)).toBe(true))
  it.each(['ftp', '', 'GPX', null, undefined, 3, {}])('rejects %j', (v) => expect(isTrackSource(v)).toBe(false))
})

describe('sourceLabel', () => {
  it('names every source in German', () => {
    expect(sourceLabel('gpx')).toBe('GPX')
    expect(sourceLabel('komoot')).toBe('Komoot')
    expect(sourceLabel('planned')).toBe('Geplant')
  })
})
