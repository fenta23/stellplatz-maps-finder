import { createEventScope, type EventScope } from '@/core/events.js'

export interface PlaceSuggestion {
  readonly label: string
  readonly lat: number
  readonly lon: number
}

export interface PlaceFieldDeps {
  /** "Start" | "Ziel" — für aria-label und Platzhalter. */
  readonly name: string
  suggest(query: string): Promise<readonly PlaceSuggestion[]>
  onSelect(s: PlaceSuggestion): void
  /** Tippen verwirft den bisher gesetzten Punkt. */
  onInvalidate(): void
  /** Standard 400. */
  readonly debounceMs?: number
}

export const MIN_QUERY_LENGTH = 3
const BLUR_CLOSE_MS = 150
let nextId = 0

/**
 * Ortsfeld mit Vorschlagsliste. Eingabe → Debounce → `suggest` → Liste.
 * Antworten veralteter Anfragen werden verworfen (Token), die gleiche Anfrage
 * wird nicht zweimal hintereinander gestellt, `suggest` darf scheitern.
 */
export class PlaceField {
  private readonly events: EventScope = createEventScope()
  private readonly listId = `place-list-${++nextId}`
  private readonly debounceMs: number
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private blurTimer: ReturnType<typeof setTimeout> | null = null
  /** Bumped on every new query, selection, setText and teardown. */
  private token = 0
  private lastQuery = ''
  private items: readonly PlaceSuggestion[] = []
  private active = -1

  constructor(
    private readonly input: HTMLInputElement,
    private readonly list: HTMLElement,
    private readonly deps: PlaceFieldDeps,
  ) {
    this.debounceMs = deps.debounceMs ?? 400
    input.setAttribute('aria-label', deps.name)
    input.placeholder = `${deps.name} suchen…`
    input.setAttribute('role', 'combobox')
    input.setAttribute('aria-autocomplete', 'list')
    input.setAttribute('aria-expanded', 'false')
    input.setAttribute('aria-controls', this.listId)
    list.id = this.listId
    list.setAttribute('role', 'listbox')
    list.hidden = true

    this.events.on(input, 'input', () => this.onInput())
    this.events.on(input, 'keydown', e => this.onKey(e))
    this.events.on(input, 'focus', () => this.clearBlurTimer())
    this.events.on(input, 'blur', () => {
      this.clearBlurTimer()
      // Kurze Verzögerung, damit ein Tipp auf einen Eintrag zuerst ankommt.
      this.blurTimer = setTimeout(() => {
        this.blurTimer = null
        this.cancelPending()
        this.closeList()
      }, BLUR_CLOSE_MS)
    })
  }

  /** Setzt den Text programmatisch (kein onInvalidate), verwirft laufende Anfragen. */
  setText(text: string): void {
    this.cancelPending()
    this.input.value = text
    this.lastQuery = ''
    this.closeList()
  }

  getText(): string { return this.input.value }

  setDisabled(disabled: boolean): void {
    this.input.disabled = disabled
    if (disabled) { this.cancelPending(); this.closeList() }
  }

  isListOpen(): boolean { return !this.list.hidden }

  /** Schließt die Liste; true, wenn sie offen war. */
  closeList(): boolean {
    const wasOpen = this.isListOpen()
    this.list.hidden = true
    this.list.replaceChildren()
    this.items = []
    this.active = -1
    this.lastQuery = ''
    this.input.setAttribute('aria-expanded', 'false')
    this.input.removeAttribute('aria-activedescendant')
    return wasOpen
  }

  destroy(): void {
    this.cancelPending()
    this.clearBlurTimer()
    this.events.dispose()
  }

  private cancelPending(): void {
    this.token++
    if (this.debounceTimer) { clearTimeout(this.debounceTimer); this.debounceTimer = null }
  }

  private clearBlurTimer(): void {
    if (this.blurTimer) { clearTimeout(this.blurTimer); this.blurTimer = null }
  }

  private onInput(): void {
    this.deps.onInvalidate()
    this.cancelPending()
    const query = this.input.value.trim()
    if (query.length < MIN_QUERY_LENGTH) { this.closeList(); return }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      void this.lookup(query)
    }, this.debounceMs)
  }

  private async lookup(query: string): Promise<void> {
    if (query === this.lastQuery) return
    this.lastQuery = query
    const my = ++this.token
    let results: readonly PlaceSuggestion[]
    try {
      results = await this.deps.suggest(query)
    } catch {
      if (my !== this.token) return
      this.lastQuery = ''
      this.render([], true)
      return
    }
    if (my !== this.token) return
    this.render(results, false)
  }

  private render(results: readonly PlaceSuggestion[], failed: boolean): void {
    this.items = results
    this.active = -1
    this.list.replaceChildren()
    if (results.length === 0) {
      const li = document.createElement('li')
      li.className = 'planner-suggestion planner-suggestion-empty'
      li.setAttribute('role', 'presentation')
      li.textContent = failed ? 'Suche nicht verfügbar' : 'Keine Treffer'
      this.list.appendChild(li)
    } else {
      results.forEach((s, i) => {
        const li = document.createElement('li')
        li.className = 'planner-suggestion'
        li.id = `${this.listId}-${i}`
        li.setAttribute('role', 'option')
        li.setAttribute('aria-selected', 'false')
        li.textContent = s.label
        // mousedown feuert vor dem Blur des Eingabefelds; preventDefault hält den Fokus.
        li.addEventListener('mousedown', e => { e.preventDefault(); this.select(s) })
        this.list.appendChild(li)
      })
    }
    this.list.hidden = false
    this.input.setAttribute('aria-expanded', 'true')
    this.input.removeAttribute('aria-activedescendant')
  }

  private select(s: PlaceSuggestion): void {
    this.cancelPending()
    this.input.value = s.label
    this.closeList()
    this.deps.onSelect(s)
  }

  private move(delta: number): void {
    const n = this.items.length
    if (n === 0) return
    this.active = this.active < 0 ? (delta > 0 ? 0 : n - 1) : (this.active + delta + n) % n
    const options = this.list.querySelectorAll<HTMLElement>('[role="option"]')
    options.forEach((el, i) => el.setAttribute('aria-selected', String(i === this.active)))
    const el = options[this.active]
    if (el) this.input.setAttribute('aria-activedescendant', el.id)
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      // Nur die Liste schließen; das Panel soll darauf nicht auch noch reagieren.
      if (this.closeList()) e.stopPropagation()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!this.isListOpen() || this.items.length === 0) return
      e.preventDefault()
      this.move(e.key === 'ArrowDown' ? 1 : -1)
    } else if (e.key === 'Enter') {
      const s = this.items[this.active]
      if (this.isListOpen() && s) { e.preventDefault(); this.select(s) }
    }
  }
}
