import { describe, it, expect, beforeEach } from 'vitest'
import { LocalFilterStore } from '@/features/filters/FilterStore.js'
import { PERSONAL_FILTER_ID, type FilterDef } from '@/features/filters/filterModel.js'
import {
  planAiFilterApply, applyAiFilterPlan, restoreAiFilters, AiFilterUndoStore,
  type AiFilterRequest,
} from './aiFilterApply.js'

beforeEach(() => localStorage.clear())

const aiFilter = (slug: string): FilterDef => ({
  id: `ai:${slug}`, name: slug, iconId: 'fuel', color: '#C62828',
  enabled: true, kind: 'osm', builtin: false, order: 100,
  selectors: [{ elements: ['node'], tags: [{ key: 'amenity', value: slug }] }],
})
const req = (enableFilters: string[] = [], adHocFilters: FilterDef[] = []): AiFilterRequest => ({ enableFilters, adHocFilters })
const run = (store: LocalFilterStore, r: AiFilterRequest, prev = null as ReturnType<AiFilterUndoStore['get']>) => {
  const plan = planAiFilterApply(store.list(), r, prev)
  if (plan) applyAiFilterPlan(store, plan)
  return plan
}
const osmState = (s: LocalFilterStore) =>
  s.list().filter(f => f.kind === 'osm').map(f => [f.id, f.enabled, f.hidden === true])

describe('planAiFilterApply / applyAiFilterPlan', () => {
  it('replaces active filters: enables the wanted (even hidden), disables the rest, deletes nothing', () => {
    const s = new LocalFilterStore()
    const before = s.list().map(f => f.id)
    expect(s.get('bakery')?.hidden).toBe(true)
    const plan = run(s, req(['bakery']))!
    expect(plan.enable).toEqual(['bakery'])
    expect(plan.disable).toEqual(expect.arrayContaining(['parking', 'camper']))
    expect(plan.remove).toEqual([])
    expect(s.get('bakery')).toMatchObject({ enabled: true })
    expect(s.get('bakery')?.hidden).toBeFalsy()
    expect(s.get('parking')?.enabled).toBe(false)
    expect(s.get('camper')?.enabled).toBe(false)
    expect(s.list().map(f => f.id)).toEqual(before)
  })

  it('puts ad-hoc filters and removes earlier ai: filters, keeping re-wanted ones', () => {
    const s = new LocalFilterStore()
    s.put(aiFilter('old'))
    s.put(aiFilter('keep'))
    const plan = run(s, req([], [aiFilter('keep'), aiFilter('new')]))!
    expect(plan.remove).toEqual(['ai:old'])
    expect(plan.put.map(f => f.id)).toEqual(['ai:keep', 'ai:new'])
    expect(s.get('ai:old')).toBeUndefined()
    expect(s.get('ai:keep')?.enabled).toBe(true)
    expect(s.get('ai:new')?.enabled).toBe(true)
    expect(plan.snapshot.removed.map(f => f.id)).toEqual(['ai:old'])
  })

  it('leaves the personal (non-osm) filter alone and out of the snapshot', () => {
    const s = new LocalFilterStore()
    const plan = run(s, req(['bakery']))!
    expect(plan.disable).not.toContain(PERSONAL_FILTER_ID)
    expect(plan.snapshot.states.map(x => x.id)).not.toContain(PERSONAL_FILTER_ID)
    expect(s.get(PERSONAL_FILTER_ID)?.enabled).toBe(true)
  })

  it('returns null without filters, or with only unknown ids', () => {
    const s = new LocalFilterStore()
    expect(planAiFilterApply(s.list(), req(), null)).toBeNull()
    expect(planAiFilterApply(s.list(), req(['nope']), null)).toBeNull()
  })

  it('ignores unknown ids next to known ones', () => {
    const s = new LocalFilterStore()
    const plan = planAiFilterApply(s.list(), req(['nope', 'bakery']), null)!
    expect(plan.enable).toEqual(['bakery'])
  })

  it('does not list an already visible+active wanted filter in enable', () => {
    const s = new LocalFilterStore()
    const plan = planAiFilterApply(s.list(), req(['parking']), null)!
    expect(plan.enable).toEqual([])
    expect(plan.disable).not.toContain('parking')
  })

  it('keeps the first snapshot on a second AI search in a row', () => {
    const s = new LocalFilterStore()
    const first = run(s, req(['bakery']))!
    const second = run(s, req(['supermarket']), first.snapshot)!
    expect(second.snapshot).toBe(first.snapshot)
    expect(second.snapshot.states.find(x => x.id === 'parking')?.enabled).toBe(true)
  })
})

describe('restoreAiFilters', () => {
  it('restores enabled/hidden, removes new ai: filters, re-adds old ones', () => {
    const s = new LocalFilterStore()
    s.put(aiFilter('old'))
    s.setHidden('parking', true)
    const plan = run(s, req(['bakery'], [aiFilter('new')]))!
    expect(s.get('ai:old')).toBeUndefined()
    restoreAiFilters(s, plan.snapshot)
    expect(s.get('ai:new')).toBeUndefined()
    expect(s.get('ai:old')?.enabled).toBe(true)
    expect(s.get('parking')).toMatchObject({ enabled: true, hidden: true })
    expect(s.get('camper')?.enabled).toBe(true)
    expect(s.get('bakery')?.hidden).toBe(true)
  })

  it('keeps a filter the user created afterwards', () => {
    const s = new LocalFilterStore()
    const plan = run(s, req(['bakery']))!
    s.put({ ...aiFilter('x'), id: 'u1' })
    restoreAiFilters(s, plan.snapshot)
    expect(s.get('u1')).toBeDefined()
  })

  it('skips snapshot entries whose filter was deleted meanwhile', () => {
    const s = new LocalFilterStore()
    s.put({ ...aiFilter('x'), id: 'u1' })
    const plan = run(s, req(['bakery']))!
    s.remove('u1')
    expect(() => restoreAiFilters(s, plan.snapshot)).not.toThrow()
    expect(s.get('u1')).toBeUndefined()
  })

  it('round trip restores existence, enabled and hidden of all OSM filters', () => {
    const s = new LocalFilterStore()
    s.put(aiFilter('old'))
    s.setEnabled('camper', false)
    s.setHidden('dump', true)
    const before = osmState(s)
    const plan = run(s, req(['bakery', 'cafe'], [aiFilter('new')]))!
    expect(osmState(s)).not.toEqual(before)
    restoreAiFilters(s, plan.snapshot)
    expect(osmState(s)).toEqual(before)
  })
})

describe('AiFilterUndoStore', () => {
  const snap = { states: [{ id: 'parking', enabled: true, hidden: false }], removed: [aiFilter('a')] }

  it('round-trips and removes with null', () => {
    const u = new AiFilterUndoStore()
    expect(u.get()).toBeNull()
    u.set(snap)
    expect(u.get()).toEqual(snap)
    u.set(null)
    expect(localStorage.getItem(AiFilterUndoStore.KEY)).toBeNull()
    expect(u.get()).toBeNull()
  })

  it('treats malformed JSON as null', () => {
    localStorage.setItem(AiFilterUndoStore.KEY, '{nope')
    expect(new AiFilterUndoStore().get()).toBeNull()
    localStorage.setItem(AiFilterUndoStore.KEY, '{"x":1}')
    expect(new AiFilterUndoStore().get()).toBeNull()
  })

  it('swallows storage errors', () => {
    const bad = {
      getItem: () => { throw new Error('x') },
      setItem: () => { throw new Error('x') },
      removeItem: () => { throw new Error('x') },
    } as unknown as Storage
    const u = new AiFilterUndoStore(bad)
    expect(() => u.set(snap)).not.toThrow()
    expect(() => u.set(null)).not.toThrow()
    expect(u.get()).toBeNull()
  })
})
