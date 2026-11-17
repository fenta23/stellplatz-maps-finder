import './poi-detail.css'
import type { OsmPoi } from '@/features/pois/OverpassClient.js'
import { buildGoogleMapsPoiLink, buildPark4nightPoiLink, buildNavLink } from './externalLinks.js'
import type { CustomPoi } from '@/features/custom-pois/CustomPoi.js'
import { customIdToNumber } from '@/features/custom-pois/CustomPoi.js'
import { clone, ref } from '@/core/template.js'
import { createEventScope, type EventScope } from '@/core/events.js'
import { renderList } from '@/core/bind.js'
import { esc, safeUrl, trackInfoText, typeLabel } from './poiLabels.js'
import { buildTags } from './buildTags.js'
import type { TagRow } from './buildTags.js'
import { renderImages, showLightbox, hideLightbox } from './imageGallery.js'
import type { PoiImage } from './imageGallery.js'
import { renderNotes } from './noteRenderer.js'
import type { OsmNote } from './noteRenderer.js'
import { parseOpenHours } from './poiOpenHours.js'
import { CEMETERY_TYPE_ID, cemeteryWaterHint } from './cemeteryHint.js'
import panelHtml from './poiDetailPanel.html?raw'

const SVG_MAP_PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>'

const SVG_SPARKLE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg>'

export interface NearbyItem {
  readonly kind: string
  readonly name: string
  readonly distance: number
  readonly lat: number
  readonly lon: number
}

const NEARBY_ICONS: Record<string, string> = {
  fuel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 4 0v-6.998a2 2 0 0 0-.59-1.42L18 5"/><path d="M14 21V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v16"/><path d="M2 21h13"/><path d="M3 9h11"/></svg>',
  supermarket: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 10a4 4 0 0 1-8 0"/><path d="M3.103 6.034h17.794"/><path d="M3.4 5.467a2 2 0 0 0-.4 1.2V20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.667a2 2 0 0 0-.4-1.2l-2-2.667A2 2 0 0 0 17 2H7a2 2 0 0 0-1.6.8z"/></svg>',
  pharmacy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/></svg>',
  bakery: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>',
  water: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/></svg>',
  dump: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
}

/** Icon markup (trusted, own set) for a nearby-supply kind, or undefined for unknown kinds. */
export function nearbyIconSvg(kind: string): string | undefined {
  return NEARBY_ICONS[kind]
}

const HEART_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"/></svg>'

export interface PanelConfig {
  readonly isCustom?: boolean
  readonly isLoggedIn?: boolean
  readonly onEdit?: () => void
  readonly onDelete?: () => void
}

/** Per-open view state for the panel. */
export interface PanelView {
  readonly isFavorite?: boolean
  readonly noteText?: string
  readonly config?: PanelConfig
  /** Position along the active imported route; shown as a summary line. */
  readonly trackInfo?: { readonly kmAlong: number; readonly kmToEnd: number; readonly offsetM: number }
}

// ── Generic listener helper ──────────────────────────────────────────────────
function subscribe<T>(listeners: T[], listener: T): () => void {
  listeners.push(listener)
  return () => {
    const idx = listeners.indexOf(listener)
    if (idx !== -1) listeners.splice(idx, 1)
  }
}

export class PoiDetailPanel {
  private readonly panel: HTMLElement
  private readonly events: EventScope = createEventScope()
  private readonly closeListeners: Array<() => void> = []
  private readonly favListeners: Array<() => void> = []
  private readonly noteListeners: Array<(text: string) => void> = []
  private readonly nearbyListeners: Array<(item: NearbyItem) => void> = []
  private nearbyItems: NearbyItem[] = []
  private _collapsed = false

  /** `now` is injectable for tests (season-dependent hints); defaults to the current date. */
  constructor(private readonly container: HTMLElement, private readonly now: () => Date = () => new Date()) {
    this.panel = document.createElement('aside')
    this.panel.className = 'poi-detail-panel hidden'
    this.panel.setAttribute('aria-label', 'POI Details')
    this.container.appendChild(this.panel)
    this.wireGlobalEvents()
  }

  // ── Public event registration ───────────────────────────────────────────────
  onClose = (listener: () => void): (() => void) => subscribe(this.closeListeners, listener)
  onFavoriteToggle = (listener: () => void): (() => void) => subscribe(this.favListeners, listener)
  onNoteSave = (listener: (text: string) => void): (() => void) => subscribe(this.noteListeners, listener)
  onNearbySelect = (listener: (item: NearbyItem) => void): (() => void) => subscribe(this.nearbyListeners, listener)

  // ── Public collapse/expand (mobile map-drag) ────────────────────────────────
  /** Shrink to header-only strip. No-op when the panel is hidden. */
  collapse(): void {
    if (this.panel.classList.contains('hidden')) return
    this._collapsed = true
    this.panel.classList.add('poi-detail-panel--collapsed')
  }

  expand(): void {
    this._collapsed = false
    this.panel.classList.remove('poi-detail-panel--collapsed')
  }

  // ── Event delegation + global key handling ──────────────────────────────────
  private wireGlobalEvents(): void {
    this.panel.addEventListener('click', (e) => {
      const target = e.target as HTMLElement

      // Tap on collapsed strip: expand (unless closing the panel)
      if (this._collapsed) {
        if (!target.closest('.btn-close')) this.expand()
        return
      }

      const link = target.closest<HTMLElement>('[data-lightbox]')
      if (link?.dataset['lightbox']) { e.preventDefault(); showLightbox(link.dataset['lightbox']); return }
      const nearby = target.closest<HTMLElement>('[data-nearby-idx]')
      if (nearby?.dataset['nearbyIdx']) {
        const item = this.nearbyItems[Number(nearby.dataset['nearbyIdx'])]
        if (item) {
          this.panel.querySelectorAll('.nearby-item.active').forEach(el => el.classList.remove('active'))
          nearby.classList.add('active')
          for (const l of this.nearbyListeners) l(item)
        }
      }
    })

    this.events.on(document, 'click', (e) => {
      if (!(e.target as HTMLElement).closest('.poi-menu-wrap')) this.closeMenu()
    })

    this.events.on(document, 'keydown', (e) => {
      if (e.key !== 'Escape') return
      if (this.panel.classList.contains('hidden')) return
      if (this.closeMenu()) return
      if (document.getElementById('poi-lightbox')?.classList.contains('hidden') === false) return
      this.hide()
    })
  }

  private closeMenu(): boolean {
    const menu = this.panel.querySelector<HTMLElement>('.poi-menu')
    if (!menu || menu.hidden) return false
    menu.hidden = true
    this.panel.querySelector('.btn-kebab')?.setAttribute('aria-expanded', 'false')
    return true
  }

  // ── Public render ───────────────────────────────────────────────────────────
  show(poi: OsmPoi, panelView: PanelView = {}): void {
    const { isFavorite = false, noteText = '', config, trackInfo } = panelView
    this.expand()
    this.panel.classList.remove('hidden')
    document.body.classList.add('detail-open')
    this.panel.innerHTML = ''
    const view = clone(panelHtml)
    this.panel.appendChild(view)

    const isCustom = config?.isCustom ?? false
    const t = poi.tags

    // Header: name, favourite heart, close, kebab menu
    ref(view, 'name').textContent = t.name ?? typeLabel(poi.type)
    this.renderFav(view, isCustom, isFavorite)
    ref(view, 'close').addEventListener('click', () => this.hide())
    // The kebab menu only carries edit/delete for custom POIs. OSM POIs have no
    // such actions, so drop it entirely (the .poi-menu-wrap CSS would otherwise
    // override the template's `hidden` attribute and leave a dead button).
    if (isCustom) this.renderMenu(view, config!)
    else ref(view, 'menuWrap').remove()

    // Opening hours badge
    const oh = t.opening_hours ? parseOpenHours(t.opening_hours) : null
    if (oh) {
      const badge = ref(view, 'ohBadge')
      badge.hidden = false
      badge.classList.add(oh.open ? 'oh-open' : 'oh-closed')
      badge.textContent = oh.hint
    }

    // Position along the active route
    if (trackInfo) {
      ref(view, 'trackInfo').hidden = false
      ref(view, 'trackInfoText').textContent = trackInfoText(trackInfo)
    }

    // Cemetery water hint (all year; extra sentence in winter)
    if (poi.type === CEMETERY_TYPE_ID) {
      const hint = cemeteryWaterHint(this.now())
      ref(view, 'cemeteryHint').hidden = false
      ref(view, 'cemeteryHintText').textContent = hint.text
      if (hint.winterText) {
        const w = ref(view, 'cemeteryHintWinter')
        w.hidden = false
        w.textContent = hint.winterText
      }
    }

    // Losfahren: hand-off to the nav app (destination only)
    ref<HTMLAnchorElement>(view, 'nav').href = buildNavLink({ lat: poi.lat, lon: poi.lon })

    // Tags
    this.renderTags(view, poi)

    // Google Maps link (name + coords → lands on the matching place card)
    ref<HTMLAnchorElement>(view, 'maps').href = buildGoogleMapsPoiLink({ lat: poi.lat, lon: poi.lon }, poi.tags.name)

    // park4night link (only for logged-in users; ref:park4night → detail, else search)
    const grid = ref(view, 'actionGrid')
    if (config?.isLoggedIn) {
      ref<HTMLAnchorElement>(view, 'p4n').href = buildPark4nightPoiLink({ lat: poi.lat, lon: poi.lon }, poi.tags.name, poi.tags['ref:park4night'])
      ref<HTMLElement>(view, 'p4n').hidden = false
      grid.classList.add('has-p4n')
    } else {
      grid.classList.remove('has-p4n')
    }

    // Detail sections visibility
    if (isCustom) {
      view.querySelectorAll<HTMLElement>('[data-section]').forEach(s => s.hidden = true)
    }

    // Note editor
    ref<HTMLTextAreaElement>(view, 'note').value = noteText
    this.wireNoteEditor(noteText)
  }

  // ── Sub-render helpers ──────────────────────────────────────────────────────
  private renderFav(view: DocumentFragment, isCustom: boolean, isFavorite: boolean): void {
    if (isCustom) { ref(view, 'fav').hidden = true; return }
    const fav = ref(view, 'fav')
    fav.setAttribute('aria-pressed', String(isFavorite))
    fav.innerHTML = HEART_SVG
    fav.classList.toggle('active', isFavorite)
    fav.addEventListener('click', () => {
      const nowFav = fav.getAttribute('aria-pressed') !== 'true'
      fav.setAttribute('aria-pressed', String(nowFav))
      fav.classList.toggle('active', nowFav)
      for (const l of this.favListeners) l()
    })
  }

  private renderMenu(view: DocumentFragment, config: PanelConfig): void {
    const menuWrap = ref(view, 'menuWrap')
    const menuBtn = ref(view, 'menuBtn')
    const menu = ref(view, 'menu')
    menuWrap.hidden = false
    const setMenu = (open: boolean) => { menu.hidden = !open; menuBtn.setAttribute('aria-expanded', String(open)) }
    menuBtn.addEventListener('click', (e) => { e.stopPropagation(); setMenu(menu.hidden) })
    ref(view, 'editBtn').addEventListener('click', () => { setMenu(false); config.onEdit?.() })
    ref(view, 'deleteBtn').addEventListener('click', () => { setMenu(false); config.onDelete?.() })
  }

  private renderTags(view: DocumentFragment, poi: OsmPoi): void {
    renderList(ref(view, 'tags'), buildTags(poi), {
      row: r => ({ label: r.label, value: r.href ? '' : r.value }),
      decorate: (rowEl: HTMLElement, r: TagRow) => {
        if (!r.href) return
        const cell = rowEl.querySelector('[data-ref="cell"]')
        if (!cell) return
        const a = clone<HTMLAnchorElement>('<a target="_blank" rel="noopener"></a>')
        a.href = safeUrl(r.href)
        a.textContent = `${r.value} ↗`
        cell.appendChild(a)
      },
    })
  }

  // ── Note editor ─────────────────────────────────────────────────────────────
  private wireNoteEditor(initial: string): void {
    const input = this.panel.querySelector<HTMLTextAreaElement>('.mynote-input')
    const status = this.panel.querySelector<HTMLElement>('.mynote-status')
    if (!input) return
    let saved = initial
    const save = () => {
      const text = input.value.trim()
      if (text === saved) return
      saved = text
      for (const l of this.noteListeners) l(text)
      if (status) status.textContent = text ? '✓ gespeichert' : 'gelöscht'
    }
    this.panel.querySelector('.mynote-save')?.addEventListener('click', save)
    input.addEventListener('blur', save)
    input.addEventListener('input', () => { if (status) status.textContent = '' })
  }

  // ── Content update helpers ──────────────────────────────────────────────────
  updateImages(images: PoiImage[]): void {
    const section = this.panel.querySelector<HTMLElement>('[data-section="images"]')
    if (!section) return
    section.innerHTML = images.length === 0 ? '' : renderImages(images)
  }

  /** Show a loading placeholder in the AI-summary block (called before fetch). */
  setSummaryLoading(): void {
    const section = this.panel.querySelector<HTMLElement>('[data-section="ai-summary"]')
    if (!section) return
    section.hidden = false
    section.innerHTML = `<h3 class="ai-summary-heading">${SVG_SPARKLE} KI-Zusammenfassung</h3><p class="ai-summary-loading">wird erstellt…</p>`
  }

  /** Fill the AI-summary block, or hide it when there's nothing to show. */
  updateSummary(text: string | null): void {
    const section = this.panel.querySelector<HTMLElement>('[data-section="ai-summary"]')
    if (!section) return
    if (!text) { section.innerHTML = ''; section.hidden = true; return }
    section.hidden = false
    section.innerHTML = `<h3 class="ai-summary-heading">${SVG_SPARKLE} KI-Zusammenfassung</h3><p class="ai-summary-text">${esc(text)}</p>`
  }

  updateNearby(items: NearbyItem[]): void {
    const section = this.panel.querySelector<HTMLElement>('[data-section="nearby"]')
    if (!section) return
    this.nearbyItems = items
    if (items.length === 0) { section.innerHTML = ''; return }
    const rows = items.map((it, i) => {
      const dist = it.distance < 1000
        ? `${it.distance} m`
        : `${(it.distance / 1000).toFixed(1).replace('.', ',')} km`
      const svg = NEARBY_ICONS[it.kind] ?? ''
      return `<li><button type="button" class="nearby-item" data-nearby-idx="${i}" title="Auf der Karte anzeigen"><span class="nearby-icon">${svg}</span><span class="nearby-name">${esc(it.name)}</span><span class="nearby-dist">${dist}</span></button></li>`
    }).join('')
    section.innerHTML = `<h3 class="nearby-heading">${SVG_MAP_PIN} In der Nähe <span class="nearby-hint">· tippen zum Anzeigen</span></h3><ul class="nearby-list">${rows}</ul>`
  }

  updateNotes(notes: OsmNote[]): void {
    const section = this.panel.querySelector<HTMLElement>('[data-section="notes"]')
    if (!section) return
    section.innerHTML = renderNotes(notes)
  }

  hide(): void {
    this.expand()
    this.panel.classList.add('hidden')
    document.body.classList.remove('detail-open')
    this.panel.innerHTML = ''
    hideLightbox()
    for (const l of this.closeListeners) l()
  }

  destroy(): void { this.events.dispose() }
}

export function customPoiToOsmPoi(cp: CustomPoi): OsmPoi {
  return {
    id: customIdToNumber(cp.id),
    type: 'parking',
    lat: cp.lat,
    lon: cp.lon,
    tags: {
      name: cp.name || undefined,
      phone: cp.phone,
      email: cp.email,
      website: cp.website,
      fee: cp.fee,
      capacity: cp.capacity,
      opening_hours: cp.openingHours,
      operator: cp.operator,
      description: cp.description,
      'addr:street': cp.street,
      'addr:housenumber': cp.housenumber,
      'addr:postcode': cp.postcode,
      'addr:city': cp.city,
    },
  }
}
