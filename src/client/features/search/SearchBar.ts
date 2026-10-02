import './search.css'
import type { LatLngBounds } from '@/features/pois/OverpassClient.js'
import { geocode, type NominatimResult } from '@/core/nominatim.js'
import { createEventScope, type EventScope } from '@/core/events.js'

export type PlaceSelectedEvent = {
  readonly lat: number
  readonly lng: number
  readonly name: string
}

export class SearchBar {
  private readonly input: HTMLInputElement
  private readonly dropdown: HTMLElement
  private readonly listeners: Array<(e: PlaceSelectedEvent) => void> = []
  private readonly aiListeners: Array<(query: string) => void> = []
  private readonly events: EventScope = createEventScope()
  private readonly aiBtn: HTMLButtonElement
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private bounds: LatLngBounds | null = null

  constructor(private readonly container: HTMLElement) {
    const wrapper = document.createElement('div')
    wrapper.className = 'search-wrapper'

    // A real <form> so the on-screen keyboard's "Search"/"Go" key (and Enter)
    // actually submits — without it, mobile users couldn't trigger a search.
    const form = document.createElement('form')
    form.className = 'search-form'
    form.setAttribute('role', 'search')

    this.input = document.createElement('input')
    this.input.type = 'search'
    this.input.placeholder = 'Ort suchen…'
    this.input.className = 'search-input'
    this.input.setAttribute('aria-label', 'Ort suchen')
    this.input.setAttribute('autocomplete', 'off')
    this.input.setAttribute('enterkeyhint', 'search')

    this.dropdown = document.createElement('ul')
    this.dropdown.className = 'search-dropdown hidden'
    this.dropdown.setAttribute('role', 'listbox')

    const clearBtn = document.createElement('button')
    clearBtn.type = 'button'
    clearBtn.className = 'search-clear hidden'
    clearBtn.setAttribute('aria-label', 'Suche löschen')
    clearBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'

    // "✨ KI-Suche" — opens the chat modal with the current text as the seed query.
    // Only appended to DOM for logged-in users (setAiEnabled).
    const aiBtn = document.createElement('button')
    aiBtn.type = 'button'
    aiBtn.className = 'search-ai'
    aiBtn.setAttribute('aria-label', 'Mit KI suchen')
    aiBtn.title = 'Mit KI suchen'
    aiBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg>'
    aiBtn.addEventListener('click', () => {
      const q = this.input.value.trim()
      for (const l of this.aiListeners) l(q)
    })
    this.aiBtn = aiBtn

    form.appendChild(this.input)
    form.appendChild(clearBtn)
    wrapper.appendChild(form)
    wrapper.appendChild(this.dropdown)
    this.container.appendChild(wrapper)

    this.input.addEventListener('input', () => {
      if (this.debounceTimer) clearTimeout(this.debounceTimer)
      this.debounceTimer = setTimeout(() => void this.search(), 350)
      clearBtn.classList.toggle('hidden', this.input.value.length === 0)
    })

    clearBtn.addEventListener('click', () => {
      this.input.value = ''
      this.input.focus()
      this.hideDropdown()
      clearBtn.classList.add('hidden')
    })

    // Submit (Enter / mobile "Search" key) → jump straight to the best match.
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      void this.submit()
    })

    this.input.addEventListener('blur', () => {
      // small delay so a click/tap on an item fires first
      setTimeout(() => this.hideDropdown(), 150)
    })

    this.events.on(document, 'keydown', (e) => {
      if (e.key === 'Escape') this.hideDropdown()
    })
  }

  updateBounds(bounds: LatLngBounds): void {
    this.bounds = bounds
  }

  /** Debounced as-you-type search → dropdown of suggestions. */
  private async search(): Promise<void> {
    const results = await this.fetchResults()
    this.showDropdown(results)
  }

  /** Submit (Enter / mobile keyboard) → run now and jump to the best match. */
  private async submit(): Promise<void> {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    const results = await this.fetchResults()
    if (results.length === 0) { this.hideDropdown(); return }
    this.selectResult(results[0]!)
    this.input.blur() // dismiss the on-screen keyboard
  }

  private async fetchResults(): Promise<readonly NominatimResult[]> {
    const q = this.input.value.trim()
    if (q.length < 2) return []
    return geocode(q, { limit: 6, ...(this.bounds ? { viewbox: this.bounds } : {}) })
  }

  private selectResult(r: NominatimResult): void {
    this.input.value = r.display_name
    this.hideDropdown()
    this.input.blur()
    for (const l of this.listeners) {
      l({ lat: Number(r.lat), lng: Number(r.lon), name: r.display_name })
    }
  }

  private showDropdown(results: readonly NominatimResult[]): void {
    this.dropdown.innerHTML = ''
    if (results.length === 0) { this.hideDropdown(); return }

    for (const r of results) {
      const li = document.createElement('li')
      li.className = 'search-dropdown-item'
      li.setAttribute('role', 'option')
      li.textContent = r.display_name
      // mousedown (fires before the input's blur) + preventDefault keeps focus
      // off the blur-hide race; works for synthesized taps on touch too.
      li.addEventListener('mousedown', (e) => {
        e.preventDefault()
        this.selectResult(r)
      })
      this.dropdown.appendChild(li)
    }
    this.dropdown.classList.remove('hidden')
  }

  private hideDropdown(): void {
    this.dropdown.classList.add('hidden')
    this.dropdown.innerHTML = ''
  }

  onPlaceSelected(listener: (e: PlaceSelectedEvent) => void): () => void {
    this.listeners.push(listener)
    return () => {
      const idx = this.listeners.indexOf(listener)
      if (idx !== -1) this.listeners.splice(idx, 1)
    }
  }

  /** Fires with the current input text when the "✨ KI-Suche" button is clicked. */
  onAiSearch(listener: (query: string) => void): () => void {
    this.aiListeners.push(listener)
    return () => {
      const idx = this.aiListeners.indexOf(listener)
      if (idx !== -1) this.aiListeners.splice(idx, 1)
    }
  }

  /** Show/hide the "✨ KI-Suche" button — only logged-in users may use the AI.
   *  Removes the button from DOM entirely when disabled — no fragile CSS hiding. */
  setAiEnabled(enabled: boolean): void {
    if (enabled && !this.aiBtn.parentElement) {
      this.input.parentElement?.appendChild(this.aiBtn)
    } else if (!enabled && this.aiBtn.parentElement) {
      this.aiBtn.remove()
    }
  }

  destroy(): void { this.events.dispose() }
}
