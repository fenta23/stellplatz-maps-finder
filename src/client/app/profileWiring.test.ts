import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createProfileWiring } from './profileWiring.js'
import { LocalProfileStore } from '@/features/profile/ProfileStore.js'
import { LocalFilterStore } from '@/features/filters/FilterStore.js'
import { presetFor } from '@/features/profile/profileModel.js'

beforeEach(() => localStorage.clear())
afterEach(() => { document.body.innerHTML = '' })

function setup() {
  const dialogContainer = document.createElement('div')
  document.body.appendChild(dialogContainer)
  const store = new LocalProfileStore()
  const filterStore = new LocalFilterStore()
  const flash = vi.fn()
  const wiring = createProfileWiring({ store, filterStore, dialogContainer, flash })
  const card = (id: string) => dialogContainer.querySelector<HTMLButtonElement>(`.profile-card[data-profile="${id}"]`)!
  const applyBtn = () => dialogContainer.querySelector<HTMLButtonElement>('[data-ref="apply"]')!
  return { wiring, store, filterStore, flash, card, applyBtn }
}

describe('createProfileWiring — dialog', () => {
  it('opens and closes the dialog', () => {
    const { wiring } = setup()
    expect(wiring.isOpen()).toBe(false)
    wiring.open()
    expect(wiring.isOpen()).toBe(true)
    wiring.close()
    expect(wiring.isOpen()).toBe(false)
  })

  it('apply updates the filter store, remembers the profiles and flashes the labels', () => {
    const { wiring, store, filterStore, flash, card, applyBtn } = setup()
    wiring.open()
    card('hiker').click()
    card('cyclist').click()
    applyBtn().click()
    expect(store.get()).toEqual(['hiker', 'cyclist'])
    expect(flash).toHaveBeenCalledWith('Profil übernommen: Wandern, Radfahren')
    expect(wiring.isOpen()).toBe(false)
    // hut is wanted by hiker -> visible; parking is not -> hidden
    expect(filterStore.get('hut')?.hidden).toBeFalsy()
    expect(filterStore.get('parking')?.hidden).toBe(true)
  })

  it('preselects the stored profiles when opened', () => {
    const { wiring, store, card } = setup()
    store.set(['camper'])
    wiring.open()
    expect(card('camper').getAttribute('aria-pressed')).toBe('true')
    expect(card('hiker').getAttribute('aria-pressed')).toBe('false')
  })
})

describe('createProfileWiring — helpProfiles', () => {
  it('exposes the three profile options', () => {
    expect(setup().wiring.helpProfiles.options.map(o => o.id)).toEqual(['hiker', 'cyclist', 'camper'])
  })

  it('getSelected reads the store', () => {
    const { wiring, store } = setup()
    store.set(['cyclist'])
    expect(wiring.helpProfiles.getSelected()).toEqual(['cyclist'])
  })

  it('presetFor passes through and ignores unknown ids', () => {
    const { wiring } = setup()
    expect(wiring.helpProfiles.presetFor(['camper', 'bogus'])).toEqual(presetFor(['camper']))
    expect(wiring.helpProfiles.presetFor([]).size).toBe(0)
  })

  it('onChosen stores only known ids and does not touch the filters', () => {
    const { wiring, store, filterStore } = setup()
    const before = JSON.stringify(filterStore.list())
    wiring.helpProfiles.onChosen(['hiker', 'nope', 'camper'])
    expect(store.get()).toEqual(['hiker', 'camper'])
    expect(JSON.stringify(filterStore.list())).toBe(before)
  })
})
