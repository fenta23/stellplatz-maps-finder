import { describe, it, expect, beforeEach, vi } from 'vitest'
import { LocalTrackStore } from './TrackStore.js'
import { MAX_CORRIDOR_M, MIN_CORRIDOR_M, type Track } from './trackTypes.js'

const KEY = 'stellplatz:track'
const sample = (over: Partial<Track> = {}): Track => ({
  name: 'Tour', source: 'gpx', points: [[50, 10], [50.1, 10.1]], lengthM: 13_000, corridorM: 500, ...over,
})

beforeEach(() => localStorage.clear())

describe('LocalTrackStore', () => {
  it('returns null when nothing is stored', () => {
    expect(new LocalTrackStore().get()).toBeNull()
  })

  it('persists in the documented format and survives a reload', () => {
    new LocalTrackStore().set(sample())
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ v: 1, ...sample() })
    expect(new LocalTrackStore().get()).toEqual(sample())
  })

  it.each([
    ['corrupt JSON', '{nope'],
    ['other version', JSON.stringify({ v: 2, ...sample() })],
    ['no version', JSON.stringify(sample())],
    ['null', 'null'],
    ['one point', JSON.stringify({ v: 1, ...sample({ points: [[1, 2]] }) })],
    ['string coordinate', JSON.stringify({ v: 1, ...sample(), points: [[1, 2], [3, '4']] })],
    ['null coordinate', JSON.stringify({ v: 1, ...sample(), points: [[1, 2], [3, null]] })],
    ['bad source', JSON.stringify({ v: 1, ...sample(), source: 'ftp' })],
    ['bad name', JSON.stringify({ v: 1, ...sample(), name: 5 })],
    ['bad length', JSON.stringify({ v: 1, ...sample(), lengthM: 'x' })],
  ])('returns null for %s', (_label, raw) => {
    localStorage.setItem(KEY, raw)
    expect(new LocalTrackStore().get()).toBeNull()
  })

  it('setCorridor clamps and notifies', () => {
    const s = new LocalTrackStore()
    const seen: Array<number | undefined> = []
    s.onChange(t => seen.push(t?.corridorM))
    s.set(sample())
    s.setCorridor(100)
    s.setCorridor(1)
    s.setCorridor(99_999)
    expect(seen).toEqual([500, 100, MIN_CORRIDOR_M, MAX_CORRIDOR_M])
    expect(new LocalTrackStore().get()?.corridorM).toBe(MAX_CORRIDOR_M)
  })

  it('setCorridor without a track does nothing', () => {
    const s = new LocalTrackStore()
    const cb = vi.fn()
    s.onChange(cb)
    s.setCorridor(300)
    expect(cb).not.toHaveBeenCalled()
    expect(s.get()).toBeNull()
  })

  it('clear removes the track and notifies with null', () => {
    const s = new LocalTrackStore()
    s.set(sample())
    const cb = vi.fn()
    s.onChange(cb)
    s.clear()
    expect(cb).toHaveBeenCalledWith(null)
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(s.get()).toBeNull()
  })

  it('unsubscribes listeners', () => {
    const s = new LocalTrackStore()
    const cb = vi.fn()
    const off = s.onChange(cb)
    off()
    s.set(sample())
    expect(cb).not.toHaveBeenCalled()
  })

  it('keeps the track in memory and still notifies when storage is full', () => {
    const full: Storage = {
      ...localStorage,
      getItem: (k: string) => localStorage.getItem(k),
      removeItem: (k: string) => localStorage.removeItem(k),
      setItem: () => { throw new DOMException('full', 'QuotaExceededError') },
    } as Storage
    const s = new LocalTrackStore(full)
    const cb = vi.fn()
    s.onChange(cb)
    expect(() => s.set(sample())).not.toThrow()
    expect(cb).toHaveBeenCalledTimes(1)
    expect(s.get()).toEqual(sample())
    s.setCorridor(900)
    expect(s.get()?.corridorM).toBe(900)
    s.clear()
    expect(s.get()).toBeNull()
  })

  it('a failed save does not resurrect an older persisted track', () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, ...sample({ name: 'alt' }) }))
    const full = {
      getItem: (k: string) => localStorage.getItem(k),
      removeItem: (k: string) => localStorage.removeItem(k),
      setItem: () => { throw new Error('quota') },
    } as unknown as Storage
    new LocalTrackStore(full).set(sample({ name: 'neu' }))
    expect(new LocalTrackStore().get()).toBeNull()
  })
})
