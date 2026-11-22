import { clone } from '@/core/template.js'
import { createEventScope, type EventScope } from '@/core/events.js'
import menuHtml from './sideMenu.html?raw'

export interface MenuItem {
  readonly icon: string
  readonly label: string
  readonly onSelect: () => void
}

export interface MenuDivider { readonly kind: 'divider' }
export interface MenuSection { readonly kind: 'section'; readonly label: string }
export type MenuEntry = MenuItem | MenuDivider | MenuSection

/** Kleiner Textlink am Menüende (z. B. Datenschutz, Impressum). */
export interface MenuFooterLink {
  readonly label: string
  readonly onSelect: () => void
}

export interface SideMenuOptions {
  readonly footerLinks?: readonly MenuFooterLink[]
}

function isMenuItem(entry: MenuEntry): entry is MenuItem {
  return !('kind' in entry)
}

/** Slide-in drawer menu with a backdrop. Items are data — add more later. */
export class SideMenu {
  private readonly panel: HTMLElement
  private readonly backdrop: HTMLElement
  private readonly events: EventScope = createEventScope()

  constructor(container: HTMLElement, items: readonly MenuEntry[], options: SideMenuOptions = {}) {
    this.backdrop = clone('<div class="side-menu-backdrop"></div>')
    this.backdrop.addEventListener('click', () => this.close())

    this.panel = clone(menuHtml)
    this.panel.querySelector('.side-menu-close')?.addEventListener('click', () => this.close())

    const list = this.panel.querySelector('.side-menu-list')!
    for (const entry of items) {
      if (!isMenuItem(entry) && entry.kind === 'divider') {
        const hr = document.createElement('hr')
        hr.className = 'side-menu-divider'
        list.appendChild(hr)
      } else if (!isMenuItem(entry) && entry.kind === 'section') {
        const li = document.createElement('li')
        const span = document.createElement('span')
        span.className = 'side-menu-section-label'
        span.textContent = entry.label
        li.appendChild(span)
        list.appendChild(li)
      } else {
        const item = entry as MenuItem
        const li = document.createElement('li')
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'side-menu-item'
        const iconSpan = document.createElement('span')
        iconSpan.className = 'side-menu-icon'
        iconSpan.innerHTML = item.icon
        const labelSpan = document.createElement('span')
        labelSpan.textContent = item.label
        btn.appendChild(iconSpan)
        btn.appendChild(labelSpan)
        btn.addEventListener('click', () => { this.close(); item.onSelect() })
        li.appendChild(btn)
        list.appendChild(li)
      }
    }

    const footerLinks = options.footerLinks ?? []
    if (footerLinks.length > 0) {
      const footer = document.createElement('nav')
      footer.className = 'side-menu-footer'
      for (const link of footerLinks) {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'side-menu-footer-link'
        btn.textContent = link.label
        btn.addEventListener('click', () => { this.close(); link.onSelect() })
        footer.appendChild(btn)
      }
      this.panel.appendChild(footer)
    }

    container.append(this.backdrop, this.panel)

    this.events.on(document, 'keydown', e => {
      if (e.key === 'Escape' && this.isOpen()) this.close()
    })
  }

  isOpen(): boolean { return this.panel.classList.contains('open') }
  open(): void { this.panel.classList.add('open'); this.backdrop.classList.add('open') }
  close(): void { this.panel.classList.remove('open'); this.backdrop.classList.remove('open') }
  toggle(): void { this.isOpen() ? this.close() : this.open() }
  destroy(): void { this.events.dispose() }
}
