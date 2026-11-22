import { describe, it, expect, vi, afterEach } from 'vitest'
import { ProfileDialog, type ProfileDialogDeps } from './ProfileDialog.js'
import { DEFAULT_FILTERS, type FilterDef } from '@/features/filters/filterModel.js'
import type { Profile } from './profileModel.js'

function setup(selected: Profile[] = [], filters: readonly FilterDef[] = DEFAULT_FILTERS, over: Partial<ProfileDialogDeps> = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const deps = {
    getSelected: vi.fn(() => selected as readonly Profile[]),
    getFilters: vi.fn(() => filters),
    onApply: vi.fn(),
    ...over,
  }
  const dialog = new ProfileDialog(container, deps)
  const card = (id: Profile) => container.querySelector<HTMLButtonElement>(`[data-profile="${id}"]`)!
  const q = (r: string) => container.querySelector<HTMLElement>(`[data-ref="${r}"]`)!
  return { container, deps, dialog, card, q, apply: () => q('apply') as HTMLButtonElement }
}

afterEach(() => { document.body.innerHTML = '' })

describe('ProfileDialog', () => {
  it('shows title, three cards, note and opens/closes', () => {
    const { container, dialog } = setup()
    expect(container.textContent).toContain('Wofür nutzt du die App?')
    expect(container.querySelectorAll('.profile-card')).toHaveLength(3)
    expect(container.textContent).toContain('Eigene Filter und eigene Orte bleiben unverändert.')
    expect(dialog.isOpen()).toBe(false)
    dialog.open()
    expect(dialog.isOpen()).toBe(true)
    dialog.close()
    expect(dialog.isOpen()).toBe(false)
  })

  it('preselects from getSelected on every open', () => {
    let sel: Profile[] = ['cyclist']
    const { dialog, card } = setup([], DEFAULT_FILTERS, { getSelected: () => sel })
    dialog.open()
    expect(card('cyclist').getAttribute('aria-pressed')).toBe('true')
    expect(card('hiker').getAttribute('aria-pressed')).toBe('false')
    dialog.close()
    sel = ['camper']
    dialog.open()
    expect(card('camper').getAttribute('aria-pressed')).toBe('true')
    expect(card('cyclist').getAttribute('aria-pressed')).toBe('false')
  })

  it('toggles cards', () => {
    const { dialog, card } = setup()
    dialog.open()
    card('hiker').click()
    expect(card('hiker').getAttribute('aria-pressed')).toBe('true')
    card('hiker').click()
    expect(card('hiker').getAttribute('aria-pressed')).toBe('false')
  })

  it('without selection: hint and disabled apply', () => {
    const { dialog, q, apply, deps } = setup()
    dialog.open()
    expect(q('previewNone').textContent).toBe('Wähle mindestens ein Profil.')
    expect(apply().disabled).toBe(true)
    apply().click()
    expect(deps.onApply).not.toHaveBeenCalled()
  })

  it('previews show and hide lists', () => {
    const { dialog, card, q, apply } = setup()
    dialog.open()
    card('hiker').click()
    expect(apply().disabled).toBe(false)
    expect(q('previewShow').textContent).toMatch(/^Blendet ein: .*Trinkwasser/)
    expect(q('previewShow').hidden).toBe(false)
    expect(q('previewHide').textContent).toMatch(/^Blendet aus: .*Parkplatz/)
    expect(q('previewNone').hidden).toBe(true)
  })

  it('says filters already fit when nothing would change', () => {
    const preset = new Set(['parking', 'camper', 'campsite', 'dump', 'water', 'cemetery', 'supermarket', 'bakery'])
    const filters = DEFAULT_FILTERS.map((f): FilterDef => (preset.has(f.id) ? { ...f, enabled: true, hidden: false } : { ...f, hidden: true }))
    const { dialog, q, apply } = setup(['camper'], filters)
    dialog.open()
    expect(q('previewNone').textContent).toBe('Deine Filter passen schon.')
    expect(q('previewShow').hidden && q('previewHide').hidden).toBe(true)
    expect(apply().disabled).toBe(false)
  })

  it('apply passes selection and plan, then closes', () => {
    const { dialog, card, deps, apply } = setup()
    dialog.open()
    card('camper').click()
    card('hiker').click()
    apply().click()
    expect(deps.onApply).toHaveBeenCalledTimes(1)
    const [profiles, plan] = (deps.onApply as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(profiles).toEqual(['hiker', 'camper'])
    expect(plan.show).toContain('hut')
    expect(plan.show).toContain('shelter')
    expect(dialog.isOpen()).toBe(false)
  })

  it('cancel, close button and Escape do not apply', () => {
    const { dialog, card, q, container, deps } = setup()
    dialog.open()
    card('hiker').click()
    q('cancel').click()
    expect(dialog.isOpen()).toBe(false)
    dialog.open()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(dialog.isOpen()).toBe(false)
    dialog.open()
    container.querySelector<HTMLElement>('.fav-close')!.click()
    expect(dialog.isOpen()).toBe(false)
    expect(deps.onApply).not.toHaveBeenCalled()
  })

  it('renders renamed filter names as text, not markup', () => {
    const evil = '<img src=x onerror=alert(1)>'
    const filters = DEFAULT_FILTERS.map(f => (f.id === 'hut' ? { ...f, name: evil, hidden: true } : f))
    const { dialog, card, q, container } = setup([], filters)
    dialog.open()
    card('hiker').click()
    expect(q('previewShow').textContent).toContain(evil)
    expect(container.querySelector('.profile-preview img')).toBeNull()
  })

  it('destroy removes Escape handling', () => {
    const { dialog } = setup()
    dialog.open()
    dialog.destroy()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(dialog.isOpen()).toBe(true)
  })
})
