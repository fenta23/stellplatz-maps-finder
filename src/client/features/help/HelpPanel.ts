import './help.css'
import { clone, ref } from '@/core/template.js'
import { createEventScope, type EventScope } from '@/core/events.js'
import { DEFAULT_FILTERS, filterIconSvg, isFilterActive, PERSONAL_FILTER_ID } from '@/features/filters/filterModel.js'
import type { IFilterStore } from '@/features/filters/FilterStore.js'
import panelHtml from './helpPanel.html?raw'

const WIZARD_FILTERS = DEFAULT_FILTERS.filter(f => f.id !== PERSONAL_FILTER_ID && f.kind === 'osm')
const TOTAL_STEPS = 4

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (className) e.className = className
  return e
}

export interface HelpPanelDeps {
  readonly filterStore: IFilterStore
  readonly onDismiss: () => void
  readonly onOpenAuth?: () => void
  readonly profiles?: HelpProfiles
}

export interface HelpProfileOption {
  readonly id: string
  readonly label: string
  readonly description: string
  /** Vertrauenswuerdiges Markup aus dem eigenen Icon-Set der App. */
  readonly iconSvg: string
}

export interface HelpProfiles {
  readonly options: readonly HelpProfileOption[]
  readonly getSelected: () => readonly string[]
  /** Filter-IDs, die die gegebenen Profile sichtbar haben wollen. */
  readonly presetFor: (ids: readonly string[]) => ReadonlySet<string>
  /** Wird beim Uebernehmen von Schritt 2 mit der endgueltigen Auswahl aufgerufen. */
  readonly onChosen: (ids: readonly string[]) => void
}

export class HelpPanel {
  private readonly panel: HTMLElement
  private readonly scroll: HTMLElement
  private readonly events: EventScope = createEventScope()
  private step = 1
  private filterEnabled = new Map<string, boolean>()
  private selectedProfiles: string[] = []
  private lastChosen: string | null = null
  private manualOpen = false

  constructor(container: HTMLElement, private readonly deps: HelpPanelDeps) {
    this.panel = clone(panelHtml)
    this.scroll = ref(this.panel, 'scroll')
    container.appendChild(this.panel)
    this.events.on(document, 'keydown', e => {
      if (e.key === 'Escape' && this.isOpen()) this.dismiss()
    })
  }

  isOpen(): boolean { return this.panel.classList.contains('open') }

  open(): void {
    this.step = 1
    this.resetFilterState()
    this.selectedProfiles = this.deps.profiles ? [...this.deps.profiles.getSelected()] : []
    this.lastChosen = null
    this.manualOpen = false
    this.render()
    this.panel.classList.add('open')
    this.scroll.scrollTop = 0
  }

  close(): void { this.panel.classList.remove('open') }

  destroy(): void { this.events.dispose() }

  private resetFilterState(): void {
    this.filterEnabled.clear()
    for (const f of WIZARD_FILTERS) {
      const stored = this.deps.filterStore.get(f.id)
      // "Selected" = tatsaechlich sichtbar auf der Karte, also !hidden && enabled.
      // Nur auf hidden zu schauen wuerde opt-in-Filter (enabled:false, nicht
      // hidden) als ausgewaehlt anzeigen, obwohl die Karte nichts zeigt.
      this.filterEnabled.set(f.id, stored ? isFilterActive(stored) : f.enabled)
    }
  }

  private dismiss(): void {
    this.panel.classList.remove('open')
    this.deps.onDismiss()
  }

  private advance(): void {
    if (this.step === 2) {
      this.applyFilters()
      this.notifyChosen()
    }
    if (this.step < TOTAL_STEPS) {
      this.step++
      this.render()
      this.scroll.scrollTop = 0
    }
  }

  private back(): void {
    if (this.step > 1) {
      this.step--
      this.render()
      this.scroll.scrollTop = 0
    }
  }

  private applyFilters(): void {
    for (const [id, visible] of this.filterEnabled) {
      const cur = this.deps.filterStore.get(id)
      if (!cur) continue
      const isHidden = cur.hidden ?? false
      if (visible && isHidden) {
        this.deps.filterStore.setHidden(id, false)
      } else if (!visible && !isHidden) {
        this.deps.filterStore.setHidden(id, true)
      }
      // Sichtbarkeit heisst !hidden && enabled — ein opt-in-Filter muss beim
      // Auswaehlen auch eingeschaltet werden, sonst bleibt die Karte leer.
      // Bewusst asymmetrisch: der Wizard hebt `enabled` nur an, senkt es nie.
      // `hidden` ist die Achse des Wizards, `enabled` die des Chips — Abwaehlen
      // blendet aus und laesst den Chip-Zustand in Ruhe.
      if (visible && !cur.enabled) this.deps.filterStore.setEnabled(id, true)
    }
  }

  /**
   * Meldet die Profilwahl genau dann, wenn Schritt 2 uebernommen wird — im
   * Gleichschritt mit applyFilters(). Ueberspringen/Schliessen vorher meldet
   * nichts (Filter bleiben ja auch unangetastet). Zurueck und erneut uebernehmen
   * meldet nur bei geaenderter Auswahl.
   */
  private notifyChosen(): void {
    const profiles = this.deps.profiles
    if (!profiles) return
    const key = this.selectedProfiles.join(',')
    if (key === this.lastChosen) return
    this.lastChosen = key
    profiles.onChosen([...this.selectedProfiles])
  }

  private handleSignIn(): void {
    this.panel.classList.remove('open')
    this.deps.onDismiss()
    this.deps.onOpenAuth?.()
  }

  private render(): void {
    this.scroll.innerHTML = ''
    this.scroll.appendChild(this.buildTopBar())
    this.scroll.appendChild(this.buildStepContent())
    this.scroll.appendChild(this.buildNav())
  }

  private buildTopBar(): HTMLElement {
    const bar = el('div', `help-top-bar${this.step === 1 ? ' help-top-bar--hero' : ''}`)

    const progress = el('div', 'help-progress')
    for (let i = 1; i <= TOTAL_STEPS; i++) {
      const dot = el('span', `help-progress-dot${i === this.step ? ' active' : ''}`)
      dot.setAttribute('aria-label', `Schritt ${i} von ${TOTAL_STEPS}`)
      progress.appendChild(dot)
    }

    const skip = el('button', 'help-skip')
    skip.type = 'button'
    skip.textContent = 'Überspringen'
    skip.setAttribute('aria-label', 'Einführung überspringen')
    skip.addEventListener('click', () => this.dismiss())

    bar.appendChild(progress)
    bar.appendChild(skip)
    return bar
  }

  private buildStepContent(): HTMLElement {
    switch (this.step) {
      case 1: return this.buildStep1()
      case 2: return this.buildStep2()
      case 3: return this.buildStep3()
      case 4: return this.buildStep4()
      default: return el('div')
    }
  }

  private buildStep1(): HTMLElement {
    const wrap = el('div', 'help-step')
    wrap.innerHTML = `
      <div class="help-hero">
        <div class="help-hero-icon" aria-hidden="true">
          <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M6 38 L24 10 L42 38 Z"/><path d="M18 38 L18 28 L30 28 L30 38"/>
            <path d="M24 28 L24 38"/><path d="M3 38 L45 38"/>
          </svg>
        </div>
        <div class="help-hero-title-row">
          <h1 class="help-title">Camp Finder</h1>
          <span class="help-badge">Beta</span>
        </div>
        <p class="help-tagline">Wasser, Einkehr, Unterkunft und Stellplätze – für Wanderer, Radfahrer und Camper. Kostenlos auf einer Karte.</p>
      </div>
      <section class="help-section">
        <h2 class="help-section-title">Was du findest</h2>
        <div class="help-features">
          <div class="help-feature">
            <span class="help-feature-icon" style="background:#e6f0f5;color:#2d6a8a">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 C8 6 4 9 4 13a8 8 0 0 0 16 0c0-4-4-7-8-11z"/></svg>
            </span>
            <span class="help-feature-label">Wasser &amp; Toiletten</span>
          </div>
          <div class="help-feature">
            <span class="help-feature-icon" style="background:#f0ebe0;color:#7a6846">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
            </span>
            <span class="help-feature-label">Einkehr &amp; Einkaufen</span>
          </div>
          <div class="help-feature">
            <span class="help-feature-icon" style="background:#edf2e6;color:#4b5640">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 21 14 3"/><path d="M20.5 21 10 3"/><path d="M15.5 21 12 15l-3.5 6"/><path d="M2 21h20"/></svg>
            </span>
            <span class="help-feature-label">Unterkunft &amp; Camping</span>
          </div>
          <div class="help-feature">
            <span class="help-feature-icon" style="background:var(--accent-soft);color:var(--accent)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 6v5a1 1 0 0 0 1 1h6.102a1 1 0 0 1 .712.298l.898.91a1 1 0 0 1 .288.702V17a1 1 0 0 1-1 1h-3"/><path d="M5 18H3a1 1 0 0 1-1-1V8a2 2 0 0 1 2-2h12c1.1 0 2.1.8 2.4 1.8l1.176 4.2"/><path d="M9 18h5"/><circle cx="16" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>
            </span>
            <span class="help-feature-label">Stellplätze &amp; Parkplätze</span>
          </div>
          <div class="help-feature">
            <span class="help-feature-icon" style="background:#f0e8e6;color:#8a3d2d">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg>
            </span>
            <span class="help-feature-label">Fahrrad-Service &amp; E-Bike</span>
          </div>
          <div class="help-feature">
            <span class="help-feature-icon" style="background:#ede8f5;color:#5c3d8a">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 3 4 8 5-5 5 15H2L8 3z"/></svg>
            </span>
            <span class="help-feature-label">Klettergebiete</span>
          </div>
        </div>
        <div class="help-extras">
          <span class="help-extra-chip">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/></svg>
            Orte entlang deiner Route (planen, Komoot, GPX)
          </span>
          <span class="help-extra-chip">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h18"/><path d="m15 6 6 6-6 6"/></svg>
            Navigation per Google/Apple Maps
          </span>
          <span class="help-extra-chip">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.122 2.122 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/></svg>
            Favoriten &amp; Notizen
          </span>
          <span class="help-extra-chip">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z"/><circle cx="12" cy="10" r="3"/></svg>
            Eigene POIs
          </span>
        </div>
      </section>
      <div class="help-beta-notice">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>
        <span>App in aktiver Entwicklung (Beta). Funktionen können sich noch ändern. POI-Daten kommen von OpenStreetMap und können unvollständig sein.</span>
      </div>
    `
    return wrap
  }

  private buildStep2(): HTMLElement {
    const wrap = el('div', 'help-step')
    const profiles = this.deps.profiles

    const hdr = el('div', 'help-step-header')
    hdr.innerHTML = profiles
      ? `
      <h2 class="help-step-title">Wofür nutzt du die App?</h2>
      <p class="help-step-desc">Wähle ein oder mehrere Profile – wir zeigen dir dazu passende Orte. Du kannst das jederzeit ändern.</p>
    `
      : `
      <h2 class="help-step-title">Was willst du sehen?</h2>
      <p class="help-step-desc">Wähle deine Standard-Ansicht. Du kannst Filter jederzeit über die Leiste unten an- und abschalten.</p>
    `
    wrap.appendChild(hdr)

    const cards = new Map<string, HTMLButtonElement>()
    const grid = this.buildFilterGrid(cards)

    if (profiles) {
      wrap.appendChild(this.buildProfileCards(profiles, cards))
      const disclosure = el('button', 'help-disclosure')
      disclosure.type = 'button'
      disclosure.dataset['ref'] = 'manual-toggle'
      disclosure.setAttribute('aria-controls', 'help-manual-filters')
      const setOpen = (open: boolean): void => {
        this.manualOpen = open
        disclosure.setAttribute('aria-expanded', String(open))
        grid.hidden = !open
        hint.hidden = !open
        disclosure.classList.toggle('open', open)
      }
      disclosure.innerHTML = `<span>Einzeln anpassen</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`
      grid.id = 'help-manual-filters'
      const hint = this.buildFilterHint()
      disclosure.addEventListener('click', () => setOpen(!this.manualOpen))
      wrap.appendChild(disclosure)
      wrap.appendChild(grid)
      wrap.appendChild(hint)
      setOpen(this.manualOpen)
    } else {
      wrap.appendChild(grid)
      wrap.appendChild(this.buildFilterHint())
    }

    return wrap
  }

  private buildProfileCards(profiles: HelpProfiles, filterCards: ReadonlyMap<string, HTMLButtonElement>): HTMLElement {
    const list = el('div', 'help-profile-list')
    list.setAttribute('role', 'group')
    list.setAttribute('aria-label', 'Profile')
    for (const opt of profiles.options) {
      const isOn = this.selectedProfiles.includes(opt.id)
      const card = el('button', `help-profile-card${isOn ? ' selected' : ''}`)
      card.type = 'button'
      card.dataset['profileId'] = opt.id
      card.setAttribute('aria-pressed', String(isOn))

      const icon = el('span', 'help-profile-card-icon')
      icon.setAttribute('aria-hidden', 'true')
      icon.innerHTML = opt.iconSvg

      const text = el('span', 'help-profile-card-text')
      const label = el('strong', 'help-profile-card-label')
      label.textContent = opt.label
      const desc = el('span', 'help-profile-card-desc')
      desc.textContent = opt.description
      text.append(label, desc)

      const check = el('span', 'help-filter-card-check')
      check.setAttribute('aria-hidden', 'true')
      check.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`

      card.append(icon, text, check)
      card.addEventListener('click', () => {
        const next = !this.selectedProfiles.includes(opt.id)
        // Reihenfolge der Optionen beibehalten, unabhaengig von der Klickreihenfolge.
        this.selectedProfiles = profiles.options.map(o => o.id)
          .filter(id => id === opt.id ? next : this.selectedProfiles.includes(id))
        card.classList.toggle('selected', next)
        card.setAttribute('aria-pressed', String(next))
        this.reseedFromProfiles(profiles, filterCards)
      })
      list.appendChild(card)
    }
    return list
  }

  /** Setzt das Raster auf das Preset der Profile; ohne Profil bleibt es wie es ist. */
  private reseedFromProfiles(profiles: HelpProfiles, cards: ReadonlyMap<string, HTMLButtonElement>): void {
    if (this.selectedProfiles.length === 0) return
    const preset = profiles.presetFor(this.selectedProfiles)
    for (const f of WIZARD_FILTERS) {
      const on = preset.has(f.id)
      this.filterEnabled.set(f.id, on)
      const card = cards.get(f.id)
      if (!card) continue
      card.classList.toggle('selected', on)
      card.setAttribute('aria-pressed', String(on))
    }
  }

  private buildFilterGrid(cards: Map<string, HTMLButtonElement>): HTMLElement {
    const grid = el('div', 'help-filter-grid')
    for (const f of WIZARD_FILTERS) {
      const isOn = this.filterEnabled.get(f.id) ?? f.enabled
      const card = el('button', `help-filter-card${isOn ? ' selected' : ''}`)
      card.type = 'button'
      card.dataset['filterId'] = f.id
      card.style.setProperty('--card-color', f.color)
      card.setAttribute('aria-pressed', String(isOn))

      const icon = el('span', 'help-filter-card-icon')
      icon.innerHTML = filterIconSvg(f.iconId)
      icon.setAttribute('aria-hidden', 'true')

      const name = el('span', 'help-filter-card-name')
      name.textContent = f.name

      const check = el('span', 'help-filter-card-check')
      check.setAttribute('aria-hidden', 'true')
      check.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`

      card.appendChild(icon)
      card.appendChild(name)
      card.appendChild(check)
      card.addEventListener('click', () => {
        const next = !this.filterEnabled.get(f.id)
        this.filterEnabled.set(f.id, next)
        card.classList.toggle('selected', next)
        card.setAttribute('aria-pressed', String(next))
      })
      cards.set(f.id, card)
      grid.appendChild(card)
    }
    return grid
  }

  private buildFilterHint(): HTMLElement {
    const hint = el('p', 'help-filter-hint')
    hint.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
      Eigene Filter (z. B. Toiletten, Duschen) lassen sich über das ⚙-Symbol in der Filter-Leiste anlegen.
    `
    return hint
  }

  private buildStep3(): HTMLElement {
    const wrap = el('div', 'help-step')
    wrap.innerHTML = `
      <div class="help-step-header">
        <h2 class="help-step-title">Verantwortungsvoll unterwegs</h2>
        <p class="help-step-desc">Stellplätze und Natur sind ein gemeinsames Gut. Besser gehen, als du kamst.</p>
      </div>

      <p class="help-resp-intro">
        Ob es die schönsten Orte morgen noch gibt, entscheidet sich daran, wie wir uns heute verhalten.
        Diese App hilft dir, sie zu finden – den Respekt davor bringst du mit.
      </p>

      <section class="help-resp-section">
        <h3 class="help-resp-section-title">Unser Kodex</h3>
        <ul class="help-resp-kodex">
          <li class="help-resp-item">
            <span class="help-resp-icon" style="background:#edf2e6;color:#4b5640" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </span>
            <div><strong>Spuren</strong><p>Ich hinterlasse jeden Ort sauberer, als ich ihn vorfand – und nehme auch fremden Müll mit.</p></div>
          </li>
          <li class="help-resp-item">
            <span class="help-resp-icon" style="background:#e6f0f5;color:#2d6a8a" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/></svg>
            </span>
            <div><strong>Wasser</strong><p>Grau- und Schwarzwasser entsorge ich nur an dafür vorgesehenen Stationen, niemals in die Natur.</p></div>
          </li>
          <li class="help-resp-item">
            <span class="help-resp-icon" style="background:#ede8f5;color:#5c3d8a" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
            </span>
            <div><strong>Ruhe</strong><p>Ich bin leise, besonders zwischen 22 und 7 Uhr, und nehme Rücksicht auf Anwohner und andere Reisende.</p></div>
          </li>
          <li class="help-resp-item">
            <span class="help-resp-icon" style="background:#f0ebe0;color:#7a6846" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg>
            </span>
            <div><strong>Respekt</strong><p>Auf Privatgrund frage ich freundlich um Erlaubnis und stelle mich vor.</p></div>
          </li>
          <li class="help-resp-item">
            <span class="help-resp-icon" style="background:#f0e8e6;color:#8a3d2d" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>
            </span>
            <div><strong>Natur</strong><p>Kein offenes Feuer ohne Erlaubnis; Pflanzen, Tiere und Steine lasse ich in Ruhe.</p></div>
          </li>
          <li class="help-resp-item">
            <span class="help-resp-icon" style="background:#e8efe2;color:#5e6b4f" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
            </span>
            <div><strong>Region</strong><p>Ich kaufe gern lokal ein und gebe etwas an die Region zurück, die mich beherbergt.</p></div>
          </li>
        </ul>
      </section>

      <section class="help-resp-section">
        <h3 class="help-resp-section-title">Wo darf ich übernachten?</h3>
        <ul class="help-resp-rules">
          <li>Parken, wo Parken erlaubt ist.</li>
          <li>Eine Nacht auf öffentlichen Parkplätzen ist meist geduldet – aber nur zur Wiederherstellung der Fahrtüchtigkeit, nicht zum Campen.</li>
          <li>Lokale Schilder und Schutzgebiete beachten – lokale Regeln haben immer Vorrang.</li>
          <li>Keine Campingmöbel, keine Markise, kein Lagercharakter.</li>
          <li>Nicht auf Privatgrundstücke oder sensible Naturflächen fahren.</li>
        </ul>
        <p class="help-resp-where-note">Im Zweifel ausgewiesene Stellplätze oder Trekking-Camps nutzen.</p>
      </section>

      <div class="help-resp-outro">
        <p><em>Besser gehen, als du kamst.</em> Mehr dazu: <a href="https://lnt.org/why/7-principles/" target="_blank" rel="noopener">Leave No Trace</a> (<a href="https://www.canicamphere.com/de/leave-no-trace" target="_blank" rel="noopener">Deutsch</a>).</p>
      </div>
    `
    return wrap
  }

  private buildStep4(): HTMLElement {
    const wrap = el('div', 'help-step')

    const loginSection = el('div', 'help-section help-section--login')
    loginSection.innerHTML = `
      <div class="help-login-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" x2="3" y1="12" y2="12"/></svg>
        <h2 class="help-section-title">Konto einrichten – optional</h2>
      </div>
      <ul class="help-login-list">
        <li>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
          Favoriten, Notizen &amp; Filter auf allen Geräten synchronisieren
        </li>
        <li>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
          KI-gestützte Suche &amp; Zusammenfassungen
        </li>
        <li class="help-login-list-planned">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>
          Weitere Features in Planung
        </li>
      </ul>
      <p class="help-free-note">Alle Kernfunktionen sind kostenlos – auch ohne Konto.</p>
    `
    wrap.appendChild(loginSection)

    const ctaWrap = el('div', 'help-account-ctas')

    if (this.deps.onOpenAuth) {
      const signIn = el('button', 'help-cta-btn')
      signIn.type = 'button'
      signIn.textContent = 'Jetzt anmelden'
      signIn.dataset['ref'] = 'signin'
      signIn.addEventListener('click', () => this.handleSignIn())
      ctaWrap.appendChild(signIn)
    }

    const skip = el('button', `help-cta-btn${this.deps.onOpenAuth ? ' help-cta-btn--ghost' : ''}`)
    skip.type = 'button'
    skip.textContent = this.deps.onOpenAuth ? 'Lieber später' : 'Los geht\'s!'
    skip.dataset['ref'] = 'start'
    skip.addEventListener('click', () => this.dismiss())
    ctaWrap.appendChild(skip)

    wrap.appendChild(ctaWrap)
    return wrap
  }

  private buildNav(): HTMLElement {
    const nav = el('div', 'help-wizard-nav')

    const isLast = this.step === TOTAL_STEPS

    if (this.step > 1) {
      const back = el('button', 'help-nav-btn help-nav-btn--back')
      back.type = 'button'
      back.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg> Zurück`
      back.addEventListener('click', () => this.back())
      nav.appendChild(back)
    } else {
      nav.appendChild(el('span', 'help-nav-spacer'))
    }

    if (!isLast) {
      const next = el('button', 'help-nav-btn help-nav-btn--next')
      next.type = 'button'
      next.dataset['ref'] = 'next'
      next.innerHTML = this.nextLabel() + ` <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>`
      next.addEventListener('click', () => this.advance())
      nav.appendChild(next)
    } else {
      nav.appendChild(el('span', 'help-nav-spacer'))
    }

    return nav
  }

  private nextLabel(): string {
    switch (this.step) {
      case 1: return 'Los geht\'s'
      case 2: return this.deps.profiles ? 'Übernehmen' : 'Filter übernehmen'
      case 3: return 'Verstanden, weiter'
      default: return 'Weiter'
    }
  }
}
