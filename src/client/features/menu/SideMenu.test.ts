import { describe, it, expect, vi } from 'vitest'
import { SideMenu, type MenuItem } from './SideMenu.js'

function setup(items: MenuItem[]) {
  const container = document.createElement('div')
  const menu = new SideMenu(container, items)
  return { container, menu }
}

describe('SideMenu', () => {
  it('renders one button per item with icon and label', () => {
    const { container } = setup([
      { icon: '🗑️', label: 'Cache leeren', onSelect: vi.fn() },
      { icon: '⚙️', label: 'Einstellungen', onSelect: vi.fn() },
    ])
    const buttons = container.querySelectorAll('.side-menu-item')
    expect(buttons).toHaveLength(2)
    expect(buttons[0]?.textContent).toContain('Cache leeren')
    expect(buttons[0]?.textContent).toContain('🗑️')
  })

  it('starts closed and toggles open/closed', () => {
    const { container, menu } = setup([{ icon: '🗑️', label: 'X', onSelect: vi.fn() }])
    const panel = container.querySelector('.side-menu')!
    expect(menu.isOpen()).toBe(false)
    menu.toggle()
    expect(menu.isOpen()).toBe(true)
    expect(panel.classList.contains('open')).toBe(true)
    menu.toggle()
    expect(menu.isOpen()).toBe(false)
  })

  it('runs the item action and closes on click', () => {
    const onSelect = vi.fn()
    const { container, menu } = setup([{ icon: '🗑️', label: 'Cache leeren', onSelect }])
    menu.open()
    container.querySelector<HTMLButtonElement>('.side-menu-item')!.click()
    expect(onSelect).toHaveBeenCalledOnce()
    expect(menu.isOpen()).toBe(false)
  })

  it('renders no footer without footer links', () => {
    const { container } = setup([{ icon: '🗑️', label: 'X', onSelect: vi.fn() }])
    expect(container.querySelector('.side-menu-footer')).toBeNull()
  })

  it('renders footer links that run their action and close the menu', () => {
    const onDatenschutz = vi.fn()
    const onImpressum = vi.fn()
    const container = document.createElement('div')
    const menu = new SideMenu(container, [{ icon: '🗑️', label: 'X', onSelect: vi.fn() }], {
      footerLinks: [
        { label: 'Datenschutz', onSelect: onDatenschutz },
        { label: 'Impressum', onSelect: onImpressum },
      ],
    })
    const links = container.querySelectorAll<HTMLButtonElement>('.side-menu-footer .side-menu-footer-link')
    expect([...links].map(l => l.textContent)).toEqual(['Datenschutz', 'Impressum'])
    // Fußzeilen-Links sind keine normalen Menüeinträge
    expect(container.querySelectorAll('.side-menu-item')).toHaveLength(1)

    menu.open()
    links[1]!.click()
    expect(onImpressum).toHaveBeenCalledOnce()
    expect(onDatenschutz).not.toHaveBeenCalled()
    expect(menu.isOpen()).toBe(false)
  })

  it('closes when the backdrop is clicked', () => {
    const { container, menu } = setup([{ icon: '🗑️', label: 'X', onSelect: vi.fn() }])
    menu.open()
    container.querySelector<HTMLElement>('.side-menu-backdrop')!.click()
    expect(menu.isOpen()).toBe(false)
  })
})
