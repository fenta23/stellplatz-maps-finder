import './profile.css'
import { clone, ref } from '@/core/template.js'
import { createEventScope, type EventScope } from '@/core/events.js'
import type { FilterDef } from '@/features/filters/filterModel.js'
import { planProfileChange, profileOptions, type Profile, type ProfilePlan } from './profileModel.js'
import panelHtml from './profileDialog.html?raw'

export interface ProfileDialogDeps {
  readonly getSelected: () => readonly Profile[]
  readonly getFilters: () => readonly FilterDef[]
  readonly onApply: (profiles: readonly Profile[], plan: ProfilePlan) => void
}

/** Modal to pick usage profiles (hiking / cycling / camping) with a live preview of the filter changes. */
export class ProfileDialog {
  private readonly panel: HTMLElement
  private readonly applyBtn: HTMLButtonElement
  private readonly showEl: HTMLElement
  private readonly hideEl: HTMLElement
  private readonly noneEl: HTMLElement
  private readonly cards = new Map<Profile, HTMLButtonElement>()
  private readonly events: EventScope = createEventScope()
  private selected = new Set<Profile>()

  constructor(container: HTMLElement, private readonly deps: ProfileDialogDeps) {
    this.panel = clone(panelHtml)
    this.applyBtn = ref(this.panel, 'apply')
    this.showEl = ref(this.panel, 'previewShow')
    this.hideEl = ref(this.panel, 'previewHide')
    this.noneEl = ref(this.panel, 'previewNone')

    const cardsEl = ref(this.panel, 'cards')
    for (const o of profileOptions()) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'profile-card'
      btn.dataset.profile = o.id
      btn.setAttribute('aria-pressed', 'false')
      // iconSvg is a static, app-internal string (filterIconSvg); label/description are set as text.
      const icon = document.createElement('span')
      icon.className = 'profile-card-icon'
      icon.setAttribute('aria-hidden', 'true')
      icon.innerHTML = o.iconSvg
      const text = document.createElement('span')
      text.className = 'profile-card-text'
      const label = document.createElement('span')
      label.className = 'profile-card-label'
      label.textContent = o.label
      const desc = document.createElement('span')
      desc.className = 'profile-card-desc'
      desc.textContent = o.description
      text.append(label, desc)
      const check = document.createElement('span')
      check.className = 'profile-card-check'
      check.setAttribute('aria-hidden', 'true')
      check.textContent = '✓'
      btn.append(icon, text, check)
      btn.addEventListener('click', () => this.toggle(o.id))
      this.cards.set(o.id, btn)
      cardsEl.appendChild(btn)
    }

    this.panel.querySelector('.fav-close')?.addEventListener('click', () => this.close())
    this.panel.addEventListener('click', e => { if (e.target === this.panel) this.close() })
    ref(this.panel, 'cancel').addEventListener('click', () => this.close())
    this.applyBtn.addEventListener('click', () => this.apply())
    container.appendChild(this.panel)

    this.events.on(document, 'keydown', e => { if (e.key === 'Escape' && this.isOpen()) this.close() })
  }

  isOpen(): boolean { return this.panel.classList.contains('open') }
  destroy(): void { this.events.dispose(); this.panel.remove() }

  open(): void {
    this.selected = new Set(this.deps.getSelected())
    this.render()
    this.panel.classList.add('open')
  }

  close(): void { this.panel.classList.remove('open') }

  private selection(): Profile[] {
    return profileOptions().map(o => o.id).filter(id => this.selected.has(id))
  }

  private toggle(id: Profile): void {
    if (this.selected.has(id)) this.selected.delete(id)
    else this.selected.add(id)
    this.render()
  }

  private apply(): void {
    const profiles = this.selection()
    if (profiles.length === 0) return
    const plan = planProfileChange(this.deps.getFilters(), profiles)
    this.close()
    this.deps.onApply(profiles, plan)
  }

  private render(): void {
    for (const [id, btn] of this.cards) btn.setAttribute('aria-pressed', String(this.selected.has(id)))
    const profiles = this.selection()
    this.applyBtn.disabled = profiles.length === 0
    this.showEl.hidden = this.hideEl.hidden = this.noneEl.hidden = true
    if (profiles.length === 0) {
      this.noneEl.textContent = 'Wähle mindestens ein Profil.'
      this.noneEl.hidden = false
      return
    }
    const filters = this.deps.getFilters()
    const plan = planProfileChange(filters, profiles)
    if (plan.show.length === 0 && plan.hide.length === 0) {
      this.noneEl.textContent = 'Deine Filter passen schon.'
      this.noneEl.hidden = false
      return
    }
    const names = (ids: readonly string[]) =>
      ids.map(id => filters.find(f => f.id === id)?.name ?? id).join(', ')
    if (plan.show.length > 0) {
      this.showEl.textContent = `Blendet ein: ${names(plan.show)}`
      this.showEl.hidden = false
    }
    if (plan.hide.length > 0) {
      this.hideEl.textContent = `Blendet aus: ${names(plan.hide)}`
      this.hideEl.hidden = false
    }
  }
}
