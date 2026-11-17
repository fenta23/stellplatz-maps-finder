import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LocalProfileStore } from './ProfileStore.js'

beforeEach(() => localStorage.clear())

describe('LocalProfileStore', () => {
  it('starts empty', () => { expect(new LocalProfileStore().get()).toEqual([]) })
  it('round-trips in PROFILES order, de-duplicated', () => {
    const s = new LocalProfileStore()
    s.set(['camper', 'hiker', 'camper'])
    expect(s.get()).toEqual(['hiker', 'camper'])
    expect(JSON.parse(localStorage.getItem('stellplatz:profiles')!)).toEqual(['hiker', 'camper'])
  })
  it('drops unknown values on read', () => {
    localStorage.setItem('stellplatz:profiles', JSON.stringify(['x', 'cyclist', 3, 'cyclist']))
    expect(new LocalProfileStore().get()).toEqual(['cyclist'])
  })
  it('returns [] for corrupt or non-array data', () => {
    localStorage.setItem('stellplatz:profiles', '{nope')
    expect(new LocalProfileStore().get()).toEqual([])
    localStorage.setItem('stellplatz:profiles', '"hiker"')
    expect(new LocalProfileStore().get()).toEqual([])
  })
  it('swallows storage errors', () => {
    const s = new LocalProfileStore()
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(() => s.set(['hiker'])).not.toThrow()
    spy.mockRestore()
    const spy2 = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    expect(s.get()).toEqual([])
    spy2.mockRestore()
  })
  it('notifies listeners until unsubscribed', () => {
    const s = new LocalProfileStore()
    const l = vi.fn()
    const off = s.onChange(l)
    s.set(['camper'])
    expect(l).toHaveBeenCalledWith(['camper'])
    off()
    s.set(['hiker'])
    expect(l).toHaveBeenCalledTimes(1)
  })
})
