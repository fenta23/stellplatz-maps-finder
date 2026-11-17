import { describe, it, expect, vi } from 'vitest'
import {
  PROFILES, PROFILE_FILTERS, isProfile, presetFor, planProfileChange, applyProfilePlan, profileOptions,
} from './profileModel.js'
import { DEFAULT_FILTERS, FILTER_ICONS, isFilterActive, type FilterDef } from '@/features/filters/filterModel.js'
import { LocalFilterStore } from '@/features/filters/FilterStore.js'

const user: FilterDef = {
  id: 'user-1', name: 'Eigener', iconId: 'pin', color: '#000', enabled: true, kind: 'osm', builtin: false,
  order: 100, selectors: [{ elements: ['node'], tags: [{ key: 'a', value: 'b' }] }],
}
const personal: FilterDef = { ...user, id: 'personal', kind: 'personal', builtin: true, selectors: [] }

describe('PROFILES / presets', () => {
  it('lists hiker, cyclist, camper in order with labels', () => {
    expect(PROFILES.map(p => p.id)).toEqual(['hiker', 'cyclist', 'camper'])
    expect(PROFILES.map(p => p.label)).toEqual(['Wandern', 'Radfahren', 'Camping'])
    for (const p of PROFILES) expect(p.description.length).toBeGreaterThan(10)
  })
  it('uses icon ids that exist', () => {
    for (const p of PROFILES) expect(FILTER_ICONS.some(i => i.id === p.iconId)).toBe(true)
  })
  it('every preset id is a built-in OSM filter', () => {
    for (const [profile, ids] of Object.entries(PROFILE_FILTERS)) {
      expect(new Set(ids).size, profile).toBe(ids.length)
      for (const id of ids) {
        const f = DEFAULT_FILTERS.find(d => d.id === id)
        expect(f, `${profile}:${id}`).toBeDefined()
        expect(f!.builtin && f!.kind === 'osm').toBe(true)
      }
    }
  })
  it('isProfile', () => {
    expect(isProfile('hiker')).toBe(true)
    expect(isProfile('x')).toBe(false)
    expect(isProfile(1)).toBe(false)
  })
  it('presetFor unions and handles empty', () => {
    expect(presetFor([]).size).toBe(0)
    const u = presetFor(['hiker', 'camper'])
    expect(u.has('hut') && u.has('dump')).toBe(true)
    expect(u.has('bike_service')).toBe(false)
  })
})

describe('planProfileChange', () => {
  it('is empty without profiles', () => {
    expect(planProfileChange(DEFAULT_FILTERS, [])).toEqual({ show: [], hide: [] })
  })
  it('never touches user or personal filters', () => {
    const plan = planProfileChange([...DEFAULT_FILTERS, user, personal], ['camper'])
    const all = [...plan.show, ...plan.hide]
    expect(all).not.toContain('user-1')
    expect(all).not.toContain('personal')
  })
  it('shows inactive preset filters and hides non-preset visible ones, in filter order', () => {
    const filters = DEFAULT_FILTERS.map((f): FilterDef =>
      f.id === 'hut' ? { ...f, enabled: true, hidden: true }
        : f.id === 'shelter' ? { ...f, enabled: false, hidden: false }
          : f.id === 'toilets' ? { ...f, enabled: true, hidden: false }
            : f)
    const plan = planProfileChange(filters, ['hiker'])
    expect(plan.show).toContain('hut')
    expect(plan.show).toContain('shelter')
    expect(plan.show).not.toContain('toilets')
    const order = (ids: readonly string[]) => ids.map(id => DEFAULT_FILTERS.findIndex(f => f.id === id))
    expect(order(plan.show)).toEqual([...order(plan.show)].sort((a, b) => a - b))
    expect(plan.hide).toContain('parking')
    expect(plan.hide).not.toContain('hut')
  })
  it('does not hide already hidden filters', () => {
    const filters = DEFAULT_FILTERS.map(f => (f.id === 'parking' ? { ...f, hidden: true } : f))
    expect(planProfileChange(filters, ['hiker']).hide).not.toContain('parking')
  })
  it('is empty when everything already matches', () => {
    const preset = presetFor(['camper'])
    const filters = DEFAULT_FILTERS.map((f): FilterDef =>
      preset.has(f.id) ? { ...f, enabled: true, hidden: false } : { ...f, hidden: true })
    expect(planProfileChange(filters, ['camper'])).toEqual({ show: [], hide: [] })
  })
})

describe('applyProfilePlan', () => {
  it('un-hides + enables shown filters, hides the others, one notification per changed filter', () => {
    localStorage.clear()
    const store = new LocalFilterStore()
    const plan = planProfileChange(store.list(), ['hiker'])
    expect(plan.show.length).toBeGreaterThan(0)
    const cb = vi.fn()
    store.onChange(cb)
    applyProfilePlan(store, plan)
    expect(cb).toHaveBeenCalledTimes(plan.show.length + plan.hide.length)
    for (const id of plan.show) expect(isFilterActive(store.get(id)!)).toBe(true)
    for (const id of plan.hide) expect(store.get(id)!.hidden).toBe(true)
    expect(planProfileChange(store.list(), ['hiker'])).toEqual({ show: [], hide: [] })
  })
  it('leaves the chip state of hidden filters alone and is idempotent', () => {
    localStorage.clear()
    const store = new LocalFilterStore()
    applyProfilePlan(store, { show: [], hide: ['parking'] })
    expect(store.get('parking')!.enabled).toBe(true)
    const cb = vi.fn()
    store.onChange(cb)
    applyProfilePlan(store, { show: [], hide: ['parking'] })
    expect(cb).not.toHaveBeenCalled()
  })
  it('ignores unknown ids', () => {
    const put = vi.fn()
    applyProfilePlan({ get: () => undefined, put }, { show: ['nope'], hide: ['nope2'] })
    expect(put).not.toHaveBeenCalled()
  })
})

describe('profileOptions', () => {
  it('returns id, label, description and an svg per profile', () => {
    const o = profileOptions()
    expect(o.map(x => x.id)).toEqual(['hiker', 'cyclist', 'camper'])
    for (const x of o) {
      expect(x.iconSvg.startsWith('<svg')).toBe(true)
      expect(x.label.length).toBeGreaterThan(0)
    }
  })
})
