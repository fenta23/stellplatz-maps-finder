import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { FilterConfigPanel } from './FilterConfigPanel.js'
import { LocalFilterStore } from './FilterStore.js'
import { DEFAULT_FILTERS } from './filterModel.js'

beforeEach(() => localStorage.clear())
afterEach(() => { document.body.innerHTML = '' }) // panels append to body — keep tests isolated

function setup() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const store = new LocalFilterStore()
  const panel = new FilterConfigPanel(container, store)
  panel.open()
  return { container, store, panel }
}

const q = (c: HTMLElement, sel: string) => c.querySelector<HTMLElement>(sel)
const qa = (c: HTMLElement, sel: string) => [...c.querySelectorAll<HTMLElement>(sel)]

describe('FilterConfigPanel — list', () => {
  it('lists a row per filter with an add button', () => {
    const { container } = setup()
    expect(qa(container, '.fc-row')).toHaveLength(DEFAULT_FILTERS.length)
    expect(q(container, '.fc-add-btn')).toBeTruthy()
  })

  it('toggling a row switch hides/shows the filter in the chip bar', () => {
    const { container, store } = setup()
    const row = q(container, '.fc-row[data-filter-id="parking"]')!
    const cb = row.querySelector<HTMLInputElement>('.fc-switch input')!
    expect(cb.checked).toBe(true) // visible in bar by default
    cb.checked = false
    cb.dispatchEvent(new Event('change'))
    expect(store.get('parking')?.hidden).toBe(true)
    cb.checked = true
    cb.dispatchEvent(new Event('change'))
    expect(store.get('parking')?.hidden).toBeUndefined()
  })

  it('built-in rows show a reset button; the personal group has no delete', () => {
    const { container } = setup()
    const parking = q(container, '.fc-row[data-filter-id="parking"]')!
    expect(parking.querySelector('.fc-danger')?.getAttribute('title')).toMatch(/zurücksetzen/i)
  })
})

describe('FilterConfigPanel — editor', () => {
  it('opens the editor and creates a filter from a template', () => {
    const { container, store } = setup()
    q(container, '.fc-add-btn')!.click()
    expect(q(container, '.fc-editor')).toBeTruthy()
    expect(qa(container, '.fc-template').length).toBeGreaterThan(0)

    // pick the first template, then save
    qa(container, '.fc-template')[0]!.click()
    const nameInput = container.querySelector<HTMLInputElement>('#fc-name')!
    expect(nameInput.value.length).toBeGreaterThan(0)
    q(container, '.fc-btn-primary')!.click()

    const added = store.list().find(f => !f.builtin)
    expect(added).toBeTruthy()
    expect(added!.selectors[0]!.tags.length).toBeGreaterThan(0)
  })

  it('rejects an empty filter with an error', () => {
    const { container, store } = setup()
    q(container, '.fc-add-btn')!.click()
    q(container, '.fc-btn-primary')!.click() // no name, no tags
    expect(q(container, '.fc-error')!.hidden).toBe(false)
    expect(store.list().some(f => !f.builtin)).toBe(false)
  })

  it('editing a built-in changes appearance but not selectors', () => {
    const { container, store } = setup()
    const water = q(container, '.fc-row[data-filter-id="water"]')!
    water.querySelector<HTMLButtonElement>('.fc-icon-btn')!.click() // pencil (first icon-btn)
    // built-ins: no tag editor, just appearance
    expect(q(container, '.fc-note')).toBeTruthy()
    const nameInput = container.querySelector<HTMLInputElement>('#fc-name')!
    nameInput.value = 'Frischwasser'
    nameInput.dispatchEvent(new Event('input'))
    q(container, '.fc-btn-primary')!.click()
    expect(store.get('water')?.name).toBe('Frischwasser')
    expect(JSON.stringify(store.get('water')?.selectors))
      .toBe(JSON.stringify(DEFAULT_FILTERS.find(f => f.id === 'water')!.selectors))
  })

  it('renders color picker buttons in editor', () => {
    const { container } = setup()
    q(container, '.fc-add-btn')!.click()
    const colors = qa(container, '.fc-color')
    expect(colors.length).toBeGreaterThan(0)
    // first color should be pre-selected
    expect(colors[0]!.classList.contains('selected')).toBe(true)
    // clicking another color selects it
    colors[1]!.dispatchEvent(new Event('click'))
    expect(colors[1]!.classList.contains('selected')).toBe(true)
    expect(colors[0]!.classList.contains('selected')).toBe(false)
  })

  it('deletes a user filter after confirm', () => {
    const { container, store } = setup()
    // create one via template first
    q(container, '.fc-add-btn')!.click()
    qa(container, '.fc-template')[0]!.click()
    q(container, '.fc-btn-primary')!.click()
    const added = store.list().find(f => !f.builtin)!

    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const row = q(container, `.fc-row[data-filter-id="${added.id}"]`)!
    row.querySelector<HTMLButtonElement>('.fc-danger')!.click()
    expect(store.get(added.id)).toBeUndefined()
  })
})

describe('FilterConfigPanel — profile shortcut', () => {
  it('shows no profile button without the dep', () => {
    const { container } = setup()
    expect(q(container, '.fc-profile-btn')).toBeNull()
  })

  it('profile button closes the panel and calls onOpenProfiles', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const onOpenProfiles = vi.fn()
    const panel = new FilterConfigPanel(container, new LocalFilterStore(), { onOpenProfiles })
    panel.open()
    const btn = q(container, '.fc-profile-btn')!
    expect(btn.textContent).toMatch(/Profil wählen/)
    btn.click()
    expect(panel.isOpen()).toBe(false)
    expect(onOpenProfiles).toHaveBeenCalledOnce()
  })
})
