import './search.css'
import { clone, ref } from '@/core/template.js'
import { createEventScope, type EventScope } from '@/core/events.js'
import { PlaceField, type PlaceFieldAction, type PlaceSuggestion } from '@/core/PlaceField.js'
import boxHtml from './searchBox.html?raw'

export type SearchBoxMode = 'search' | 'route' | 'ai'

export interface SearchBoxDeps {
  suggest(query: string): Promise<readonly PlaceSuggestion[]>
}

const SPARKLE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg>'
const TITLES: Record<Exclude<SearchBoxMode, 'search'>, string> = { route: 'Route planen', ai: 'KI-Suche' }

/** Aufklappbare Suchbox: Suchzeile, in den Modi `route`/`ai` Kopfzeile + Karte mit Slot. */
export class SearchBox {
  private readonly root: HTMLElement
  private readonly form: HTMLFormElement
  private readonly input: HTMLInputElement
  private readonly clearBtn: HTMLButtonElement
  private readonly aiBtn: HTMLButtonElement
  private readonly routeBtn: HTMLButtonElement
  private readonly routeLabel: HTMLElement
  private readonly head: HTMLElement
  private readonly title: HTMLElement
  private readonly panel: HTMLElement
  private readonly routeSlot: HTMLElement
  private readonly aiSlot: HTMLElement
  private readonly field: PlaceField
  private readonly events: EventScope = createEventScope()
  private currentMode: SearchBoxMode = 'search'
  private aiEnabled = false
  private selected: PlaceSuggestion | null = null
  private readonly placeListeners: Array<(p: PlaceSuggestion) => void> = []
  private readonly routeListeners: Array<(p: PlaceSuggestion | null) => void> = []
  private readonly aiListeners: Array<(q: string) => void> = []
  private readonly modeListeners: Array<(m: SearchBoxMode, prev: SearchBoxMode) => void> = []

  constructor(container: HTMLElement, deps: SearchBoxDeps) {
    this.root = clone(boxHtml)
    const r = this.root
    this.form = ref<HTMLFormElement>(r, 'form')
    this.input = ref<HTMLInputElement>(r, 'input')
    this.clearBtn = ref<HTMLButtonElement>(r, 'clear')
    this.aiBtn = ref<HTMLButtonElement>(r, 'aiBtn')
    this.routeBtn = ref<HTMLButtonElement>(r, 'routeBtn')
    this.routeLabel = ref(r, 'routeLabel')
    this.head = ref(r, 'head')
    this.title = ref(r, 'title')
    this.panel = ref(r, 'panel')
    this.routeSlot = ref(r, 'routeSlot')
    this.aiSlot = ref(r, 'aiSlot')
    // KI-Knopf nur bei erlaubter KI im DOM (setAiEnabled) – kein CSS-Verstecken.
    this.aiBtn.remove()

    this.field = new PlaceField(this.input, ref(r, 'list'), {
      name: 'Ort',
      suggest: q => deps.suggest(q),
      onSelect: s => {
        this.selected = s
        this.syncClear()
        this.syncRouteBtn()
        for (const l of [...this.placeListeners]) l(s)
        this.input.blur() // schließt die Handy-Tastatur
      },
      onInvalidate: () => { this.selected = null; this.syncRouteBtn() },
      actions: q => this.aiEnabled ? [this.aiAction(q)] : [],
    })
    this.input.setAttribute('aria-label', 'Ort suchen')

    this.events.on(this.input, 'input', () => this.syncClear())
    this.events.on(this.clearBtn, 'click', () => {
      this.selected = null
      this.field.setText('')
      this.syncClear()
      this.syncRouteBtn()
      this.input.focus()
    })
    this.events.on(this.form, 'submit', e => {
      e.preventDefault()
      void this.field.submit().then(ok => { if (ok) this.input.blur() })
    })
    this.events.on(this.routeBtn, 'click', () => {
      for (const l of [...this.routeListeners]) l(this.selected)
    })
    this.events.on(this.aiBtn, 'click', () => this.emitAi(this.input.value.trim()))
    this.events.on(ref(r, 'close'), 'click', () => this.setMode('search'))

    container.appendChild(this.root)
  }

  mode(): SearchBoxMode { return this.currentMode }

  setMode(mode: SearchBoxMode): void {
    if (mode === this.currentMode) return
    const prev = this.currentMode
    const hadFocus = this.root.contains(document.activeElement)
    this.currentMode = mode
    this.root.dataset.mode = mode
    this.form.hidden = mode !== 'search'
    this.head.hidden = mode === 'search'
    this.title.textContent = mode === 'search' ? '' : TITLES[mode]
    this.panel.hidden = mode === 'search'
    this.routeSlot.hidden = mode !== 'route'
    this.aiSlot.hidden = mode !== 'ai'
    document.body.classList.toggle('searchbox-open', mode !== 'search')
    this.routeBtn.setAttribute('aria-expanded', String(mode === 'route'))
    if (prev === 'search') this.field.closeList()
    // Fokus auf einen Knopf, nicht aufs Feld: das würde am Handy die Tastatur öffnen.
    if (mode === 'search' && hadFocus) {
      const target = prev === 'ai' && this.aiBtn.isConnected ? this.aiBtn : this.routeBtn
      target.focus()
    }
    for (const l of [...this.modeListeners]) l(mode, prev)
  }

  slot(name: 'route' | 'ai'): HTMLElement {
    return name === 'route' ? this.routeSlot : this.aiSlot
  }

  focusSearch(): void {
    if (this.currentMode === 'search') this.input.focus()
  }

  setAiEnabled(enabled: boolean): void {
    this.aiEnabled = enabled
    if (enabled && !this.aiBtn.isConnected) this.routeBtn.after(this.aiBtn)
    else if (!enabled && this.aiBtn.isConnected) this.aiBtn.remove()
  }

  onPlaceSelected(l: (place: PlaceSuggestion) => void): () => void { return subscribe(this.placeListeners, l) }
  onRouteRequested(l: (place: PlaceSuggestion | null) => void): () => void { return subscribe(this.routeListeners, l) }
  onAiSearch(l: (query: string) => void): () => void { return subscribe(this.aiListeners, l) }
  onModeChange(l: (mode: SearchBoxMode, prev: SearchBoxMode) => void): () => void { return subscribe(this.modeListeners, l) }

  destroy(): void {
    this.field.destroy()
    this.events.dispose()
    this.root.remove()
    document.body.classList.remove('searchbox-open')
  }

  private aiAction(query: string): PlaceFieldAction {
    return { id: 'ai', label: `Mit KI suchen: „${query}“`, iconSvg: SPARKLE_SVG, run: () => this.emitAi(query) }
  }

  private emitAi(query: string): void {
    for (const l of [...this.aiListeners]) l(query)
  }

  private syncClear(): void {
    this.clearBtn.hidden = this.input.value.length === 0
  }

  private syncRouteBtn(): void {
    const here = this.selected !== null
    const text = here ? 'Route hierher' : 'Route planen'
    this.routeLabel.hidden = !here
    this.routeBtn.setAttribute('aria-label', text)
    this.routeBtn.title = text
  }
}

function subscribe<T>(list: T[], l: T): () => void {
  list.push(l)
  return () => {
    const i = list.indexOf(l)
    if (i !== -1) list.splice(i, 1)
  }
}
