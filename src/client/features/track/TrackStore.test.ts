import { describe, it, expect, beforeEach, vi } from 'vitest'
import { LocalTrackStore } from './TrackStore.js'
import { MAX_CORRIDOR_M, MIN_CORRIDOR_M, MAX_SAVED_TRACKS, type RoutePlan, type Track } from './trackTypes.js'

const KEY = 'stellplatz:tracks'
const OLD_KEY = 'stellplatz:track'
const sample = (over: Partial<Track> = {}): Track => ({
  name: 'Tour', source: 'gpx', points: [[50, 10], [50.1, 10.1]], lengthM: 13_000, corridorM: 500, ...over,
})

/** Deterministic clock + ids. */
function make(storage: Storage = localStorage) {
  let t = 1000
  let n = 0
  const store = new LocalTrackStore(storage, { now: () => ++t, newId: () => `id${++n}` })
  return store
}
const named = (name: string) => sample({ name })

beforeEach(() => localStorage.clear())

describe('LocalTrackStore', () => {
  it('is empty when nothing is stored', () => {
    const s = make()
    expect(s.get()).toBeNull()
    expect(s.list()).toEqual([])
  })

  it('persists in the documented format and survives a reload', () => {
    const saved = make().set(sample())
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ v: 2, activeId: saved.id, tracks: [saved] })
    const again = new LocalTrackStore()
    expect(again.get()).toEqual(saved)
    expect(again.list()).toEqual([saved])
  })

  it('keeps a planned route across a reload', () => {
    const saved = make().set(sample({ name: 'Dresden → Pirna (Rad)', source: 'planned' }))
    const again = new LocalTrackStore()
    expect(again.get()).toEqual(saved)
    expect(again.get()?.source).toBe('planned')
  })

  it('uses a generated id when none is injected', () => {
    const a = new LocalTrackStore().set(named('a'))
    const b = new LocalTrackStore().set(named('b'))
    expect(a.id).toBeTruthy()
    expect(a.id).not.toBe(b.id)
  })

  describe('migration from the single-route key', () => {
    it('turns a valid v1 route into an active library entry and removes the old key', () => {
      localStorage.setItem(OLD_KEY, JSON.stringify({ v: 1, ...sample({ name: 'alt' }) }))
      const s = make()
      expect(s.get()).toMatchObject({ ...sample({ name: 'alt' }), id: 'id1' })
      expect(s.list()).toHaveLength(1)
      expect(localStorage.getItem(OLD_KEY)).toBeNull()
      expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({ v: 2, activeId: 'id1' })
      expect(new LocalTrackStore().get()?.name).toBe('alt')
    })

    it.each([
      ['corrupt JSON', '{nope'],
      ['wrong version', JSON.stringify({ v: 2, ...sample() })],
      ['one point', JSON.stringify({ v: 1, ...sample({ points: [[1, 2]] }) })],
      ['null', 'null'],
    ])('ignores invalid old data (%s)', (_l, raw) => {
      localStorage.setItem(OLD_KEY, raw)
      const s = make()
      expect(s.get()).toBeNull()
      expect(s.list()).toEqual([])
    })

    it('does not migrate when the new key already exists', () => {
      localStorage.setItem(OLD_KEY, JSON.stringify({ v: 1, ...sample({ name: 'alt' }) }))
      localStorage.setItem(KEY, JSON.stringify({ v: 2, activeId: null, tracks: [] }))
      expect(make().list()).toEqual([])
    })
  })

  describe('validation', () => {
    const entry = (id: string, over: Record<string, unknown> = {}) => ({ id, addedAt: 1, ...sample(), ...over })

    it.each([
      ['corrupt JSON', '{nope'],
      ['other version', JSON.stringify({ v: 1, activeId: null, tracks: [] })],
      ['null', 'null'],
      ['tracks not an array', JSON.stringify({ v: 2, activeId: null, tracks: 5 })],
    ])('yields an empty library for %s', (_l, raw) => {
      localStorage.setItem(KEY, raw)
      expect(make().list()).toEqual([])
    })

    it('keeps valid entries when others are broken', () => {
      localStorage.setItem(KEY, JSON.stringify({
        v: 2, activeId: 'b',
        tracks: [
          entry('a', { points: [[1, 2]] }),
          entry('b', { name: 'gut', addedAt: 2 }),
          entry('c', { source: 'ftp' }),
          entry('', {}),
          entry('d', { points: [[1, 2], [3, '4']] }),
          { ...entry('e'), lengthM: 'x' },
          entry('f', { name: 'auch gut', addedAt: 3 }),
        ],
      }))
      const s = make()
      expect(s.list().map(t => t.id)).toEqual(['f', 'b'])
      expect(s.get()?.name).toBe('gut')
    })

    it('drops an activeId that points to a missing or broken entry', () => {
      localStorage.setItem(KEY, JSON.stringify({ v: 2, activeId: 'zzz', tracks: [entry('a')] }))
      const s = make()
      expect(s.list()).toHaveLength(1)
      expect(s.get()).toBeNull()
    })
  })

  describe('set / activate / dedupe / order', () => {
    it('saves, activates and lists newest first', () => {
      const s = make()
      const a = s.set(named('a'))
      const b = s.set(named('b'))
      expect(s.get()?.id).toBe(b.id)
      expect(s.list().map(t => t.name)).toEqual(['b', 'a'])
      s.activate(a.id)
      expect(s.get()?.id).toBe(a.id)
      expect(s.list().map(t => t.name)).toEqual(['b', 'a']) // activating does not reorder
    })

    it('re-activates an equal route instead of duplicating it', () => {
      const s = make()
      const a = s.set(sample({ points: [[50, 10], [50.1, 10.1]] }))
      s.set(named('b'))
      s.setCorridor(700) // of b
      const again = s.set(sample({ points: [[50, 10], [50.1, 10.1]] }))
      expect(again.id).toBe(a.id)
      expect(s.list().map(t => t.name)).toEqual(['Tour', 'b'])
      expect(s.get()?.id).toBe(a.id)
    })

    it('re-activates the same planned route instead of duplicating it', () => {
      const s = make()
      const a = s.set(sample({ source: 'planned' }))
      s.set(named('b'))
      const again = s.set(sample({ source: 'planned' }))
      expect(again.id).toBe(a.id)
      expect(s.list().map(t => t.name)).toEqual(['Tour', 'b'])
      expect(s.get()?.id).toBe(a.id)
    })

    it('treats a different name, source, length or point as a different route', () => {
      const s = make()
      s.set(sample())
      s.set(sample({ name: 'x' }))
      s.set(sample({ source: 'komoot' }))
      s.set(sample({ lengthM: 1 }))
      s.set(sample({ points: [[50, 10], [50.1, 10.2]] }))
      expect(s.list()).toHaveLength(5)
    })

    it('activate ignores unknown ids and the already active one', () => {
      const s = make()
      const a = s.set(sample())
      const cb = vi.fn()
      s.onChange(cb)
      s.activate('nope')
      s.activate(a.id)
      expect(cb).not.toHaveBeenCalled()
    })
  })

  describe('corridor', () => {
    it('clamps, notifies and only touches the active route', () => {
      const s = make()
      const a = s.set(named('a'))
      s.set(named('b'))
      const seen: Array<number | undefined> = []
      s.onChange(t => seen.push(t?.corridorM))
      s.setCorridor(100)
      s.setCorridor(1)
      s.setCorridor(99_999)
      expect(seen).toEqual([100, MIN_CORRIDOR_M, MAX_CORRIDOR_M])
      expect(s.list().find(t => t.id === a.id)?.corridorM).toBe(500)
      expect(new LocalTrackStore().get()?.corridorM).toBe(MAX_CORRIDOR_M)
    })

    it('does nothing without an active route, for NaN or an unchanged value', () => {
      const s = make()
      const cb = vi.fn()
      s.onChange(cb)
      s.setCorridor(300)
      s.set(sample())
      cb.mockClear()
      s.setCorridor(NaN)
      s.setCorridor(500)
      expect(cb).not.toHaveBeenCalled()
    })
  })

  describe('clear vs remove', () => {
    it('clear deactivates but keeps the route saved', () => {
      const s = make()
      const a = s.set(sample())
      const cb = vi.fn()
      s.onChange(cb)
      s.clear()
      expect(cb).toHaveBeenCalledWith(null)
      expect(s.get()).toBeNull()
      expect(s.list()).toEqual([a])
      expect(new LocalTrackStore().list()).toHaveLength(1)
      s.clear()
      expect(cb).toHaveBeenCalledTimes(1)
    })

    it('remove deletes an inactive route and keeps the active one (notifies with it)', () => {
      const s = make()
      const a = s.set(named('a'))
      const b = s.set(named('b'))
      const cb = vi.fn()
      s.onChange(cb)
      s.remove(a.id)
      expect(cb).toHaveBeenCalledWith(b)
      expect(s.list()).toEqual([b])
      expect(s.get()).toEqual(b)
    })

    it('remove of the active route deactivates it and deletes it', () => {
      const s = make()
      const a = s.set(named('a'))
      const b = s.set(named('b'))
      const cb = vi.fn()
      s.onChange(cb)
      s.remove(b.id)
      expect(cb).toHaveBeenCalledWith(null)
      expect(s.get()).toBeNull()
      expect(s.list()).toEqual([a])
    })

    it('remove of an unknown id is a no-op', () => {
      const s = make()
      s.set(sample())
      const cb = vi.fn()
      s.onChange(cb)
      s.remove('nope')
      expect(cb).not.toHaveBeenCalled()
    })
  })

  describe('limit', () => {
    it('drops the oldest inactive routes beyond the limit', () => {
      const s = make()
      for (let i = 0; i < MAX_SAVED_TRACKS + 3; i++) s.set(named(`t${i}`))
      expect(s.list()).toHaveLength(MAX_SAVED_TRACKS)
      expect(s.list()[0]?.name).toBe(`t${MAX_SAVED_TRACKS + 2}`)
      expect(s.list().some(t => t.name === 't0')).toBe(false)
    })

    it('never evicts the active route, even when it is the oldest', () => {
      const s = make()
      const first = s.set(named('first'))
      for (let i = 0; i < MAX_SAVED_TRACKS - 1; i++) s.set(named(`t${i}`))
      s.activate(first.id) // oldest, active
      s.set(named('new')) // becomes active; first is now inactive+oldest → evicted
      expect(s.list()).toHaveLength(MAX_SAVED_TRACKS)
      s.activate(s.list()[s.list().length - 1]!.id) // oldest is active
      s.set(sample({ name: 'dup' })) // active again = new route; previous oldest evicted if over limit
      expect(s.get()?.name).toBe('dup')
      expect(s.list().length).toBeLessThanOrEqual(MAX_SAVED_TRACKS)
    })

    it('an oldest ACTIVE route survives eviction triggered by a re-activated equal route', () => {
      const s = make()
      const old = s.set(named('old'))
      for (let i = 0; i < MAX_SAVED_TRACKS - 1; i++) s.set(named(`t${i}`))
      s.activate(old.id)
      expect(s.list()).toHaveLength(MAX_SAVED_TRACKS)
      s.set(named('old')) // dedupe, moves to the front
      expect(s.get()?.id).toBe(old.id)
      expect(s.list()).toHaveLength(MAX_SAVED_TRACKS)
    })
  })

  describe('quota', () => {
    /** Storage whose setItem throws while the payload holds more than `max` routes. */
    const limited = (max: number) => ({
      getItem: (k: string) => localStorage.getItem(k),
      removeItem: (k: string) => localStorage.removeItem(k),
      setItem: (k: string, v: string) => {
        if ((JSON.parse(v).tracks as unknown[]).length > max) throw new DOMException('full', 'QuotaExceededError')
        localStorage.setItem(k, v)
      },
    }) as unknown as Storage

    it('drops the oldest inactive routes one by one until it fits', () => {
      const s = make(limited(2))
      s.set(named('a'))
      s.set(named('b'))
      expect(() => s.set(named('c'))).not.toThrow()
      expect(s.list().map(t => t.name)).toEqual(['c', 'b'])
      expect(JSON.parse(localStorage.getItem(KEY)!).tracks).toHaveLength(2)
    })

    it('keeps the active route (in memory) when nothing more can be dropped', () => {
      const full = {
        getItem: (k: string) => localStorage.getItem(k),
        removeItem: (k: string) => localStorage.removeItem(k),
        setItem: () => { throw new DOMException('full', 'QuotaExceededError') },
      } as unknown as Storage
      const s = make(full)
      const cb = vi.fn()
      s.onChange(cb)
      let saved!: ReturnType<typeof s.set>
      expect(() => { saved = s.set(sample()) }).not.toThrow()
      expect(cb).toHaveBeenCalledTimes(1)
      expect(s.get()).toEqual(saved)
      s.setCorridor(900)
      expect(s.get()?.corridorM).toBe(900)
      s.clear()
      expect(s.get()).toBeNull()
      expect(s.list()).toHaveLength(1)
    })
  })

  it('notifies on every change and unsubscribes', () => {
    const s = make()
    const cb = vi.fn()
    const off = s.onChange(cb)
    const a = s.set(named('a'))
    s.set(named('b'))
    s.remove(a.id)
    expect(cb).toHaveBeenCalledTimes(3)
    off()
    s.clear()
    expect(cb).toHaveBeenCalledTimes(3)
  })
})

describe('LocalTrackStore: plan of a planned route', () => {
  const plan: RoutePlan = {
    mode: 'bike',
    waypoints: [{ lat: 50, lon: 10, label: 'A' }, { lat: 50.05, lon: 10.05 }, { lat: 50.1, lon: 10.1, label: 'B' }],
  }
  const planned = (over: Partial<Track> = {}): Track => sample({ name: 'A → B (Rad)', source: 'planned', plan, ...over })
  /** Writes one stored entry with the given raw `plan` and reads it back with a fresh store. */
  const reloadWithPlan = (raw: unknown, source = 'planned') => {
    const entry = { ...planned(), source, plan: raw, id: 'x', addedAt: 1 }
    localStorage.setItem(KEY, JSON.stringify({ v: 2, activeId: 'x', tracks: [entry] }))
    return new LocalTrackStore().get()
  }

  it('saves the plan and reads it back after a reload', () => {
    const saved = make().set(planned())
    expect(saved.plan).toEqual(plan)
    expect(new LocalTrackStore().get()).toEqual(saved)
  })

  it('a route stored without a plan still loads (not editable)', () => {
    make().set(sample({ source: 'planned' }))
    const again = new LocalTrackStore().get()
    expect(again?.source).toBe('planned')
    expect(again).not.toHaveProperty('plan')
  })

  it.each([
    ['not an object', 'nope'],
    ['unknown mode', { ...plan, mode: 'plane' }],
    ['one waypoint only', { mode: 'bike', waypoints: [plan.waypoints[0]] }],
    ['waypoints not an array', { mode: 'bike', waypoints: {} }],
    ['latitude out of range', { mode: 'bike', waypoints: [{ lat: 91, lon: 10 }, plan.waypoints[2]] }],
    ['coordinate not a number', { mode: 'bike', waypoints: [{ lat: '50', lon: 10 }, plan.waypoints[2]] }],
    ['label not a string', { mode: 'bike', waypoints: [{ lat: 50, lon: 10, label: 7 }, plan.waypoints[2]] }],
  ])('drops a broken plan (%s) but keeps the route', (_what, raw) => {
    const got = reloadWithPlan(raw)
    expect(got?.name).toBe('A → B (Rad)')
    expect(got).not.toHaveProperty('plan')
  })

  it('reads a valid stored plan', () => {
    expect(reloadWithPlan(plan)?.plan).toEqual(plan)
  })

  it('ignores a plan on an imported route', () => {
    expect(reloadWithPlan(plan, 'gpx')).not.toHaveProperty('plan')
  })

  it('planning the same route again keeps the id and takes the new plan', () => {
    const s = make()
    const first = s.set(planned())
    const other: RoutePlan = { ...plan, waypoints: [plan.waypoints[0]!, plan.waypoints[2]!] }
    const second = s.set(planned({ plan: other }))
    expect(second.id).toBe(first.id)
    expect(s.list()).toHaveLength(1)
    expect(s.get()?.plan).toEqual(other)
    // …and saving it again without a plan does not wipe the stored one.
    expect(s.set(sample({ name: 'A → B (Rad)', source: 'planned' })).plan).toEqual(other)
  })
})

describe('LocalTrackStore: replace', () => {
  const plan: RoutePlan = { mode: 'foot', waypoints: [{ lat: 50, lon: 10 }, { lat: 50.2, lon: 10.2 }] }
  const edited = (): Track => ({
    name: 'Neu', source: 'planned', points: [[50, 10], [50.3, 10.4], [50.2, 10.2]], lengthM: 42_000, corridorM: 50, plan,
  })

  it('swaps name, points, length and plan — id, age, corridor and the active state stay', () => {
    const s = make()
    const old = s.set(sample({ source: 'planned', corridorM: 900 }))
    const seen = vi.fn()
    s.onChange(seen)
    s.replace(old.id, edited())
    const now = s.get()!
    expect(now).toEqual({ ...edited(), corridorM: 900, id: old.id, addedAt: old.addedAt })
    expect(seen).toHaveBeenCalledTimes(1)
    expect(seen).toHaveBeenCalledWith(now)
    expect(new LocalTrackStore().get()).toEqual(now) // persisted
  })

  it('keeps the position in the list and leaves the other routes alone', () => {
    const s = make()
    const a = s.set(named('A'))
    const b = s.set(named('B'))
    s.replace(a.id, edited())
    expect(s.list().map(t => t.id)).toEqual([b.id, a.id])
    expect(s.list()[0]).toEqual(b)
    expect(s.get()?.id).toBe(b.id) // replacing an inactive route does not activate it
  })

  it('drops the plan when the new track has none', () => {
    const s = make()
    const old = s.set(sample({ source: 'planned', plan }))
    s.replace(old.id, sample({ source: 'planned', name: 'Ohne' }))
    expect(s.get()?.name).toBe('Ohne')
    expect(s.get()).not.toHaveProperty('plan')
  })

  it('does not merge with an equal saved route (no dedupe)', () => {
    const s = make()
    const a = s.set(named('A'))
    const b = s.set(named('B'))
    s.replace(b.id, named('A'))
    expect(s.list().map(t => [t.id, t.name])).toEqual([[b.id, 'A'], [a.id, 'A']])
  })

  it('an unknown id changes nothing and does not notify', () => {
    const s = make()
    const old = s.set(sample())
    const seen = vi.fn()
    s.onChange(seen)
    s.replace('nope', edited())
    expect(seen).not.toHaveBeenCalled()
    expect(s.list()).toEqual([old])
  })
})
