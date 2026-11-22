import { describe, it, expect, beforeEach } from 'vitest'
import { LocalFilterStore } from './FilterStore.js'
import { DEFAULT_FILTERS, PERSONAL_FILTER_ID, type FilterDef } from './filterModel.js'

const userFilter = (id = 'u1'): FilterDef => ({
  id, name: 'Tankstelle', iconId: 'fuel', color: '#C62828',
  enabled: true, kind: 'osm', builtin: false, order: 100,
  selectors: [{ elements: ['node', 'way'], tags: [{ key: 'amenity', value: 'fuel' }] }],
})

beforeEach(() => localStorage.clear())

describe('LocalFilterStore', () => {
  it('seeds the default filters in order', () => {
    const s = new LocalFilterStore()
    expect(s.list().map(f => f.id)).toEqual(DEFAULT_FILTERS.map(f => f.id))
  })

  // Bestandsnutzer haben Overrides nur fuer die alten neun Filter im localStorage.
  it('lists new built-ins hidden+enabled and leaves existing overrides untouched', () => {
    const OLD = ['parking', 'camper', 'campsite', 'dump', 'water', 'climbing', PERSONAL_FILTER_ID, 'hut', 'shelter']
    const stored = OLD.map(id => {
      const d = DEFAULT_FILTERS.find(f => f.id === id)!
      return { ...d, color: '#123456', enabled: id !== 'parking', hidden: id === 'dump' ? true : undefined }
    })
    localStorage.setItem('stellplatz:filter-defs', JSON.stringify(stored))
    const s = new LocalFilterStore()
    for (const id of OLD) {
      const f = s.get(id)!
      expect(f.color, id).toBe('#123456')
      expect(f.enabled, id).toBe(id !== 'parking')
      expect(f.hidden === true, id).toBe(id === 'dump')
    }
    const added = DEFAULT_FILTERS.filter(f => !OLD.includes(f.id))
    expect(added).toHaveLength(10)
    for (const d of added) {
      const f = s.get(d.id)!
      expect(f.hidden, d.id).toBe(true)
      expect(f.enabled, d.id).toBe(true)
      expect(f.color, d.id).toBe(d.color)
    }
    expect(s.list().map(f => f.id)).toEqual(DEFAULT_FILTERS.map(f => f.id))
    // un-hiding activates immediately
    s.setHidden('cafe', false)
    expect(s.get('cafe')).toMatchObject({ enabled: true })
    expect(s.get('cafe')!.hidden).not.toBe(true)
  })

  it('toggles enabled and persists across reloads', () => {
    const s = new LocalFilterStore()
    s.setEnabled('parking', false)
    expect(s.get('parking')?.enabled).toBe(false)
    const reloaded = new LocalFilterStore()
    expect(reloaded.get('parking')?.enabled).toBe(false)
    expect(reloaded.get('camper')?.enabled).toBe(true)
  })

  it('adds a user filter that shows up in list + osmFilters', () => {
    const s = new LocalFilterStore()
    s.put(userFilter())
    expect(s.get('u1')?.name).toBe('Tankstelle')
    expect(s.osmFilters().some(f => f.id === 'u1')).toBe(true)
    expect(new LocalFilterStore().get('u1')?.iconId).toBe('fuel')
  })

  it('locks built-in selectors — editing tags is ignored', () => {
    const s = new LocalFilterStore()
    const parking = s.get('parking')!
    s.put({ ...parking, color: '#000000', selectors: [{ elements: ['node'], tags: [{ key: 'hacked', value: 'yes' }] }] })
    const after = s.get('parking')!
    expect(after.color).toBe('#000000') // appearance change applied
    expect(JSON.stringify(after.selectors)).toBe(JSON.stringify(parking.selectors)) // tags preserved
  })

  it('removes a user filter; resetting a built-in restores its default', () => {
    const s = new LocalFilterStore()
    s.put(userFilter())
    s.remove('u1')
    expect(s.get('u1')).toBeUndefined()

    s.put({ ...s.get('water')!, enabled: false, color: '#123456' })
    expect(s.get('water')?.enabled).toBe(false)
    s.remove('water') // reset
    const water = s.get('water')!
    expect(water.enabled).toBe(true)
    expect(water.color).toBe(DEFAULT_FILTERS.find(f => f.id === 'water')!.color)
  })

  it('osmSignature changes with selectors, not with enabled/colour', () => {
    const s = new LocalFilterStore()
    const sig0 = s.osmSignature()
    s.setEnabled('parking', false)
    expect(s.osmSignature()).toBe(sig0)
    s.put(userFilter())
    expect(s.osmSignature()).not.toBe(sig0)
  })

  it('rejects structurally invalid user filters', () => {
    const s = new LocalFilterStore()
    s.put({ ...userFilter('bad'), selectors: [] })
    expect(s.get('bad')).toBeUndefined()
    s.put({ ...userFilter('bad2'), name: '   ' })
    expect(s.get('bad2')).toBeUndefined()
  })

  it('keeps the personal group as kind=personal', () => {
    const s = new LocalFilterStore()
    expect(s.get(PERSONAL_FILTER_ID)?.kind).toBe('personal')
    expect(s.osmFilters().some(f => f.id === PERSONAL_FILTER_ID)).toBe(false)
  })

  it('applyRemote adopts unseen records but local wins ties', () => {
    const s = new LocalFilterStore()
    s.put({ ...userFilter('local'), name: 'LocalName' })
    s.applyRemote([
      { ...userFilter('local'), name: 'RemoteName' }, // tie → local wins
      { ...userFilter('remoteOnly'), name: 'Remote' }, // adopted
    ])
    expect(s.get('local')?.name).toBe('LocalName')
    expect(s.get('remoteOnly')?.name).toBe('Remote')
  })

  describe('umbenannter Standardname (Eigene POIs → Eigene Orte)', () => {
    const personal = (name: string): FilterDef => ({
      ...DEFAULT_FILTERS.find(f => f.id === PERSONAL_FILTER_ID)!, name,
    })

    it('zeigt für einen gespeicherten alten Standardnamen den neuen Namen', () => {
      localStorage.setItem('stellplatz:filter-defs', JSON.stringify([personal('Eigene POIs')]))
      expect(new LocalFilterStore().get(PERSONAL_FILTER_ID)?.name).toBe('Eigene Orte')
    })

    it('behält einen selbst gewählten Namen', () => {
      localStorage.setItem('stellplatz:filter-defs', JSON.stringify([personal('Meine Spots')]))
      expect(new LocalFilterStore().get(PERSONAL_FILTER_ID)?.name).toBe('Meine Spots')
    })

    it('migriert auch Records aus applyRemote und replaceAll', () => {
      const a = new LocalFilterStore()
      a.applyRemote([personal('Eigene POIs')])
      expect(a.get(PERSONAL_FILTER_ID)?.name).toBe('Eigene Orte')
      const b = new LocalFilterStore()
      b.replaceAll([personal('Eigene POIs')])
      expect(b.get(PERSONAL_FILTER_ID)?.name).toBe('Eigene Orte')
      const c = new LocalFilterStore()
      c.replaceAll([personal('Meine Spots')])
      expect(c.get(PERSONAL_FILTER_ID)?.name).toBe('Meine Spots')
    })
  })
})
