import { describe, it, expect } from 'vitest'
import { TravelModeStore } from './TravelModeStore.js'

function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: k => m.get(k) ?? null,
    key: i => [...m.keys()][i] ?? null,
    removeItem: k => { m.delete(k) },
    setItem: (k, v) => { m.set(k, v) },
  }
}

describe('TravelModeStore', () => {
  it('returns null when nothing is stored', () => {
    expect(new TravelModeStore(memoryStorage()).get()).toBeNull()
  })

  it('round-trips each mode under the documented key', () => {
    const storage = memoryStorage()
    const store = new TravelModeStore(storage)
    for (const mode of ['foot', 'bike', 'car'] as const) {
      store.set(mode)
      expect(store.get()).toBe(mode)
      expect(storage.getItem('stellplatz:route-mode')).toBe(mode)
    }
  })

  it('treats an invalid stored value as null', () => {
    const storage = memoryStorage()
    storage.setItem('stellplatz:route-mode', 'plane')
    expect(new TravelModeStore(storage).get()).toBeNull()
    storage.setItem('stellplatz:route-mode', '')
    expect(new TravelModeStore(storage).get()).toBeNull()
  })

  it('does not throw when the storage throws', () => {
    const broken = {
      getItem() { throw new Error('denied') },
      setItem() { throw new Error('quota') },
    } as unknown as Storage
    const store = new TravelModeStore(broken)
    expect(store.get()).toBeNull()
    expect(() => store.set('bike')).not.toThrow()
  })
})
