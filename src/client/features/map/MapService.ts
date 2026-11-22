import './map.css'
import L from 'leaflet'
import type { LatLngBounds } from '@/features/pois/OverpassClient.js'

// Lucide "layers" — base-layer chooser ("Ebenen")
const SVG_LAYERS = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/></svg>'

// Lucide "locate-fixed" — crosshair with centre dot
const SVG_LOCATE = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="2" x2="5" y1="12" y2="12"/><line x1="19" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="5"/><line x1="12" x2="12" y1="19" y2="22"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/></svg>'
// Lucide "route" — import a tour (GPX / Komoot)
const SVG_ROUTE = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/></svg>'

// Lucide plus / minus — replace Leaflet's default "+"/"−" glyphs so the zoom
// control matches the icon style of the layer switcher / locate button.
const SVG_PLUS = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" x2="12" y1="5" y2="19"/><line x1="5" x2="19" y1="12" y2="12"/></svg>'
const SVG_MINUS = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" x2="19" y1="12" y2="12"/></svg>'

/** The "Ebenen" chooser element plus a handle to close its panel (removes document listeners). */
export interface LayerSwitcher {
  readonly el: HTMLElement
  readonly close: () => void
}

function createActionButton(parent: HTMLElement, className: string, svg: string, label: string, onClick: () => void): HTMLButtonElement {
  const btn = L.DomUtil.create('button', className, parent) as HTMLButtonElement
  btn.type = 'button'
  btn.innerHTML = svg
  btn.title = label
  btn.setAttribute('aria-label', label)
  L.DomEvent.on(btn, 'click', (e: Event) => { L.DomEvent.stop(e); onClick() })
  return btn
}

/**
 * Map-actions bar (top-right, vertical, right under the header / beside the
 * collapsed pill — a fixed spot that never jumps with the bottom sheets):
 * base-layer chooser on top, then locate, then route import (one tap).
 */
export function createMapActions(
  onLocate: () => void,
  onRoute: () => void = () => {},
  layers?: LayerSwitcher,
): L.Control {
  const control = L.control({ position: 'topright' })
  control.onAdd = () => {
    const container = L.DomUtil.create('div', 'map-actions leaflet-bar')
    if (layers) container.appendChild(layers.el)
    createActionButton(container, 'locate-btn', SVG_LOCATE, 'Zu meinem Standort', onLocate)
    createActionButton(container, 'locate-btn track-btn', SVG_ROUTE, 'Route importieren', onRoute)
    L.DomEvent.disableClickPropagation(container)
    L.DomEvent.disableScrollPropagation(container)
    return container
  }
  // Leaflet removes the DOM; make sure no document listeners outlive the control.
  control.onRemove = () => layers?.close()
  return control
}

export type BaseLayerId = 'map' | 'satellite' | 'cycle' | 'topo'

export interface BaseLayerConfig {
  /** Stable identifier — this (not the label) is what gets persisted. */
  readonly id: BaseLayerId
  readonly label: string
  readonly url: string
  readonly attribution: string
  /** Highest zoom level the provider actually serves (Leaflet `maxNativeZoom`). */
  readonly maxZoom: number
  readonly subdomains?: readonly string[]
}

/** Satellite layer — Esri World Imagery, keyless and free. */
const SATELLITE_LAYER: BaseLayerConfig = {
  id: 'satellite',
  label: 'Satellit',
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  attribution: 'Luftbilder © <a href="https://www.esri.com">Esri</a>, Maxar, Earthstar Geographics',
  maxZoom: 19,
}

const BASE_LAYER_STORAGE_KEY = 'stellplatz:base-layer'

const CARTO_VOYAGER_URL = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png'

/** Reads a build-time key (Vite replaces `import.meta.env.VITE_*` statically). */
function readCartoKey(): string {
  try {
    return (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.['VITE_CARTO_API_KEY'] || ''
  } catch {
    return ''
  }
}

function readThunderforestKey(): string {
  try {
    return (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.['VITE_THUNDERFOREST_API_KEY'] || ''
  } catch {
    return ''
  }
}

/** The CARTO key baked into this build — empty string when none was configured. */
export const CARTO_API_KEY = readCartoKey()

/** The Thunderforest key baked into this build — empty string when none was configured. */
export const THUNDERFOREST_API_KEY = readThunderforestKey()

/**
 * Base ("Karte") layer config.
 *
 * CARTO brennt seit 2026 ein "API KEY REQUIRED"-Wasserzeichen in keylose
 * Voyager-Tiles. Mit Key (`VITE_CARTO_API_KEY`) bleibt der gewohnte Voyager-Look,
 * ohne Key fällt die Karte auf Esri World Street Map zurück — keyless und auf
 * demselben Host wie der Satellit-Layer, statt eine Karte voller Wasserzeichen
 * auszuliefern.
 */
export function buildMapLayerConfig(cartoKey: string = CARTO_API_KEY): BaseLayerConfig {
  if (cartoKey) {
    return {
      // CARTO Voyager — clean, muted earthy tones (free tier, API key required)
      id: 'map',
      label: 'Karte',
      url: `${CARTO_VOYAGER_URL}?key=${encodeURIComponent(cartoKey)}`,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende © <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom: 20,
    }
  }
  return {
    id: 'map',
    label: 'Karte',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Kartendarstellung © <a href="https://www.esri.com">Esri</a> — Quellen: Esri, HERE, Garmin, USGS, <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende',
    maxZoom: 19,
  }
}

/**
 * Fahrrad-Layer. Mit Key (`VITE_THUNDERFOREST_API_KEY`) OpenCycleMap von
 * Thunderforest, ohne Key keyless CyclOSM — so ist der Layer nie ohne Quelle.
 */
export function buildCycleLayerConfig(key: string = THUNDERFOREST_API_KEY): BaseLayerConfig {
  if (key) {
    return {
      id: 'cycle',
      label: 'OpenCycleMap',
      url: `https://{s}.tile.thunderforest.com/cycle/{z}/{x}/{y}.png?apikey=${encodeURIComponent(key)}`,
      attribution: 'Karten © <a href="https://www.thunderforest.com">Thunderforest</a>, Daten © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende',
      maxZoom: 22,
      subdomains: ['a', 'b', 'c'],
    }
  }
  return {
    id: 'cycle',
    label: 'Fahrradkarte',
    url: 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
    attribution: 'Karten © <a href="https://www.cyclosm.org">CyclOSM</a>, Daten © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende',
    maxZoom: 20,
    subdomains: ['a', 'b', 'c'],
  }
}

/** Topografische Karte — OpenTopoMap (keyless, Tiles enden bei Zoom 17). */
export const TOPO_LAYER: BaseLayerConfig = {
  id: 'topo',
  label: 'Topografische Karte',
  url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
  attribution: 'Kartendaten © OpenStreetMap-Mitwirkende, SRTM | Kartendarstellung © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
  maxZoom: 17,
  subdomains: ['a', 'b', 'c'],
}

/** Base map layers offered in the layer chooser (action bar, bottom-right) — first is the default. */
export const BASE_LAYER_CONFIGS: readonly BaseLayerConfig[] = [
  buildMapLayerConfig(),
  SATELLITE_LAYER,
  buildCycleLayerConfig(),
  TOPO_LAYER,
]

/**
 * Builds a `{ label → TileLayer }` map from the configs.
 *
 * Every layer gets the highest `maxZoom` of all configs as its display limit,
 * while `maxNativeZoom` is the provider's real limit: Leaflet then upscales the
 * last native tiles instead of requesting non-existent ones (blank grey map),
 * and the map's max zoom (derived from the active layer) never shrinks when
 * switching to a layer whose provider stops earlier.
 */
export function buildBaseLayers(configs: readonly BaseLayerConfig[] = BASE_LAYER_CONFIGS): Record<string, L.TileLayer> {
  const layers: Record<string, L.TileLayer> = {}
  const displayMaxZoom = Math.max(...configs.map(c => c.maxZoom))
  for (const cfg of configs) {
    layers[cfg.label] = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      maxZoom: displayMaxZoom,
      maxNativeZoom: cfg.maxZoom,
      ...(cfg.subdomains ? { subdomains: [...cfg.subdomains] } : {}),
    })
  }
  return layers
}

function readStoredLayerId(): string | null {
  try {
    return localStorage.getItem(BASE_LAYER_STORAGE_KEY)
  } catch {
    return null
  }
}

function storeLayerId(id: string): void {
  try {
    localStorage.setItem(BASE_LAYER_STORAGE_KEY, id)
  } catch { /* storage unavailable — choice just isn't remembered */ }
}

/** Gap between an opened layer panel and whatever sits below it (sheet, screen edge). */
const PANEL_BOTTOM_GAP_PX = 8
/** Never squeeze the layer panel below this; it scrolls inside. */
const PANEL_MIN_HEIGHT_PX = 120

/** The "Ebenen" chooser: one button that opens a radio panel with every base layer. */
function buildLayerSwitcher(
  configs: readonly BaseLayerConfig[],
  getActiveId: () => BaseLayerId,
  onSelect: (id: BaseLayerId) => void,
): LayerSwitcher {
  const container = L.DomUtil.create('div', 'layer-switcher')

  const btn = L.DomUtil.create('button', 'layer-btn', container) as HTMLButtonElement
  btn.type = 'button'
  btn.innerHTML = SVG_LAYERS
  btn.title = 'Ebenen'
  btn.setAttribute('aria-label', 'Ebenen')
  btn.setAttribute('aria-haspopup', 'true')
  btn.setAttribute('aria-expanded', 'false')

  const panel = L.DomUtil.create('div', 'layer-panel', container)
  panel.hidden = true
  const heading = L.DomUtil.create('div', 'layer-panel-title', panel)
  heading.id = 'layer-panel-title'
  heading.textContent = 'Ebenen'
  const group = L.DomUtil.create('div', 'layer-options', panel)
  group.setAttribute('role', 'radiogroup')
  group.setAttribute('aria-labelledby', heading.id)

  const inputs = new Map<BaseLayerId, HTMLInputElement>()
  for (const cfg of configs) {
    const label = L.DomUtil.create('label', 'layer-option', group) as HTMLLabelElement
    const input = L.DomUtil.create('input', '', label) as HTMLInputElement
    input.type = 'radio'
    input.name = 'base-layer'
    input.value = cfg.id
    const text = L.DomUtil.create('span', 'layer-option-label', label)
    text.textContent = cfg.label
    inputs.set(cfg.id, input)
    L.DomEvent.on(input, 'click', () => {
      close()
      onSelect(cfg.id)
      sync()
    })
  }

  function sync(): void {
    const active = getActiveId()
    for (const [id, input] of inputs) input.checked = id === active
  }

  const onDocClick = (e: Event) => {
    if (!container.contains(e.target as Node)) close()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { close(); btn.focus() }
  }

  /**
   * The panel opens downwards from the bar's top edge. A bottom sheet (route,
   * POI detail) may leave little room: Leaflet's bottom corner is lifted right
   * above it (route.css / responsive.css), so cap the panel there and let it scroll.
   */
  function fitPanel(): void {
    const bar = container.parentElement ?? container
    const floor = bar.closest('.leaflet-container')?.querySelector('.leaflet-bottom')?.getBoundingClientRect().bottom ?? 0
    const room = floor - bar.getBoundingClientRect().top - PANEL_BOTTOM_GAP_PX
    panel.style.maxHeight = room > 0 ? `${Math.max(PANEL_MIN_HEIGHT_PX, room)}px` : ''
  }

  function open(): void {
    sync()
    panel.hidden = false
    fitPanel()
    container.classList.add('open')
    btn.setAttribute('aria-expanded', 'true')
    document.addEventListener('click', onDocClick, true)
    document.addEventListener('keydown', onKey)
    inputs.get(getActiveId())?.focus()
  }
  function close(): void {
    if (panel.hidden) return
    panel.hidden = true
    container.classList.remove('open')
    btn.setAttribute('aria-expanded', 'false')
    document.removeEventListener('click', onDocClick, true)
    document.removeEventListener('keydown', onKey)
  }

  L.DomEvent.on(btn, 'click', (e: Event) => {
    L.DomEvent.stop(e)
    if (panel.hidden) open(); else close()
  })

  sync()
  return { el: container, close }
}

export class MapService {
  private readonly map: L.Map
  private readonly boundsListeners: Array<(b: LatLngBounds) => void> = []
  private readonly contextMenuListeners: Array<(lat: number, lng: number) => void> = []
  private readonly placementListeners: Array<(lat: number, lng: number) => void> = []
  private readonly locateListeners: Array<() => void> = []
  private readonly routeActionListeners: Array<() => void> = []
  private readonly dragStartListeners: Array<() => void> = []
  private readonly zoomStartListeners: Array<() => void> = []
  private readonly baseLayers: Record<string, L.TileLayer>
  private activeLayer: BaseLayerConfig
  private readonly baseLayerChangeListeners: Array<(key: string) => void> = []
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private _isPlacing = false
  /** Cancel handle of the running pick (also identifies it); null when idle. */
  private activePick: (() => void) | null = null

  constructor(
    container: HTMLElement,
    center: [number, number] = [48.137, 11.576],
    zoom = 13,
  ) {
    // Attribution bottom-left: the bottom-right corner belongs to the action bar.
    this.map = L.map(container, { zoomControl: true, attributionControl: false }).setView(center, zoom)
    L.control.attribution({ position: 'bottomleft' }).addTo(this.map)

    this.baseLayers = buildBaseLayers()
    const stored = readStoredLayerId()
    this.activeLayer = BASE_LAYER_CONFIGS.find(c => c.id === stored) ?? BASE_LAYER_CONFIGS[0]!
    this.baseLayers[this.activeLayer.label]!.addTo(this.map)
    createMapActions(
      () => { for (const l of this.locateListeners) l() },
      () => { for (const l of this.routeActionListeners) l() },
      buildLayerSwitcher(BASE_LAYER_CONFIGS, () => this.activeLayer.id, id => this.selectBaseLayer(id)),
    ).addTo(this.map)

    // Swap Leaflet's "+"/"−" zoom glyphs for Lucide icons (styled like the other controls).
    const c = this.map.getContainer()
    const zin = c.querySelector('.leaflet-control-zoom-in')
    const zout = c.querySelector('.leaflet-control-zoom-out')
    if (zin) zin.innerHTML = SVG_PLUS
    if (zout) zout.innerHTML = SVG_MINUS

    this.map.on('moveend', () => {
      if (this.debounceTimer) clearTimeout(this.debounceTimer)
      this.debounceTimer = setTimeout(() => this.emit(), 1200)
    })

    this.map.on('dragstart', () => {
      for (const l of this.dragStartListeners) l()
    })

    this.map.on('zoomstart', () => {
      for (const l of this.zoomStartListeners) l()
    })

    this.map.on('contextmenu', (e: L.LeafletMouseEvent) => {
      if (this._isPlacing) return
      for (const l of this.contextMenuListeners) l(e.latlng.lat, e.latlng.lng)
    })
  }

  private emit(): void {
    const b = this.getBounds()
    if (!b) return
    for (const l of this.boundsListeners) l(b)
  }

  getBounds(): LatLngBounds | null {
    const b = this.map.getBounds()
    return {
      south: b.getSouth(),
      west: b.getWest(),
      north: b.getNorth(),
      east: b.getEast(),
    }
  }

  onBoundsChanged(listener: (b: LatLngBounds) => void): () => void {
    this.boundsListeners.push(listener)
    return () => {
      const idx = this.boundsListeners.indexOf(listener)
      if (idx !== -1) this.boundsListeners.splice(idx, 1)
    }
  }

  onContextMenu(listener: (lat: number, lng: number) => void): () => void {
    this.contextMenuListeners.push(listener)
    return () => {
      const idx = this.contextMenuListeners.indexOf(listener)
      if (idx !== -1) this.contextMenuListeners.splice(idx, 1)
    }
  }

  /** Fires when the "my location" control is tapped. */
  onLocate(listener: () => void): () => void {
    this.locateListeners.push(listener)
    return () => {
      const idx = this.locateListeners.indexOf(listener)
      if (idx !== -1) this.locateListeners.splice(idx, 1)
    }
  }

  /** Fires when the "import route" control is tapped. */
  onRouteAction(listener: () => void): () => void {
    this.routeActionListeners.push(listener)
    return () => {
      const idx = this.routeActionListeners.indexOf(listener)
      if (idx !== -1) this.routeActionListeners.splice(idx, 1)
    }
  }

  /** Fires when the user starts a manual drag (not programmatic pans). */
  onDragStart(listener: () => void): () => void {
    this.dragStartListeners.push(listener)
    return () => {
      const idx = this.dragStartListeners.indexOf(listener)
      if (idx !== -1) this.dragStartListeners.splice(idx, 1)
    }
  }

  /** Fires when the user starts a zoom gesture (pinch or scroll). */
  onZoomStart(listener: () => void): () => void {
    this.zoomStartListeners.push(listener)
    return () => {
      const idx = this.zoomStartListeners.indexOf(listener)
      if (idx !== -1) this.zoomStartListeners.splice(idx, 1)
    }
  }

  private selectBaseLayer(id: BaseLayerId): void {
    const next = BASE_LAYER_CONFIGS.find(c => c.id === id)
    if (!next) return
    storeLayerId(next.id)
    if (next.id === this.activeLayer.id) return
    this.baseLayers[this.activeLayer.label]?.remove()
    this.baseLayers[next.label]?.addTo(this.map)
    this.activeLayer = next
    for (const l of this.baseLayerChangeListeners) l(next.label)
  }

  /** Label of the currently active base layer (e.g. 'Karte', 'Satellit'). */
  getBaseLayerLabel(): string {
    return this.activeLayer.label
  }

  /** Fires with the new label when the user switches the base layer. */
  onBaseLayerChange(listener: (key: string) => void): () => void {
    this.baseLayerChangeListeners.push(listener)
    return () => {
      const idx = this.baseLayerChangeListeners.indexOf(listener)
      if (idx !== -1) this.baseLayerChangeListeners.splice(idx, 1)
    }
  }

  /**
   * One-shot map pick: the next map click calls `onPick(lat, lng)`. Esc, right-click/long-press,
   * the returned function or a new `pickPoint` call end the pick without a result and call
   * `onCancel` exactly once (never after a successful pick). A new call replaces a running pick.
   * The returned cancel function is idempotent and only affects its own pick.
   * Long-press/right-click stays suppressed (no `onContextMenu`) for the whole pick.
   */
  pickPoint(onPick: (lat: number, lng: number) => void, onCancel?: () => void): () => void {
    this.activePick?.()
    let active = true
    const container = this.map.getContainer()
    const cleanup = (): void => {
      active = false
      this.map.off('click', onClick)
      this.map.off('contextmenu', onContext)
      document.removeEventListener('keydown', onKey)
      if (this.activePick === cancel) {
        this.activePick = null
        this._isPlacing = false
        container.classList.remove('placing-poi')
      }
    }
    const cancel = (): void => {
      if (!active) return
      cleanup()
      onCancel?.()
    }
    const onClick = (e: L.LeafletMouseEvent): void => {
      if (!active) return
      cleanup()
      onPick(e.latlng.lat, e.latlng.lng)
    }
    const onContext = (): void => cancel()
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') cancel() }
    this.activePick = cancel
    this._isPlacing = true
    container.classList.add('placing-poi')
    this.map.on('click', onClick)
    this.map.on('contextmenu', onContext)
    document.addEventListener('keydown', onKey)
    return cancel
  }

  /** Enter placement mode — next map click places a POI. No-op while a pick is running. */
  startPlacement(): void {
    if (this._isPlacing) return
    this.pickPoint((lat, lng) => {
      for (const l of this.placementListeners) l(lat, lng)
    })
  }

  /** Exit placement mode without placing. */
  cancelPlacement(): void {
    this.activePick?.()
  }

  onPlacement(listener: (lat: number, lng: number) => void): () => void {
    this.placementListeners.push(listener)
    return () => {
      const idx = this.placementListeners.indexOf(listener)
      if (idx !== -1) this.placementListeners.splice(idx, 1)
    }
  }

  get isPlacing(): boolean {
    return this._isPlacing
  }

  getMap(): L.Map {
    return this.map
  }

  setCenter(lat: number, lng: number, zoom?: number): void {
    this.map.setView([lat, lng], zoom ?? this.map.getZoom())
  }

  panTo(lat: number, lng: number): void {
    this.map.panTo([lat, lng])
  }
}

export async function getUserLocation(): Promise<[number, number] | null> {
  return new Promise(resolve => {
    if (!navigator.geolocation) { resolve(null); return }
    navigator.geolocation.getCurrentPosition(
      pos => resolve([pos.coords.latitude, pos.coords.longitude]),
      () => resolve(null),
      { timeout: 5000 },
    )
  })
}
