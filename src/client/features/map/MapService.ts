import './map.css'
import L from 'leaflet'
import type { LatLngBounds } from '@/features/pois/OverpassClient.js'

const SVG_MAP = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/></svg>'

const SVG_SATELLITE = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m13.5 6.5-3.148-3.148a1.205 1.205 0 0 0-1.704 0L6.352 5.648a1.205 1.205 0 0 0 0 1.704L9.5 10.5"/><path d="M16.5 7.5 19 5"/><path d="m17.5 10.5 3.148 3.148a1.205 1.205 0 0 1 0 1.704l-2.296 2.296a1.205 1.205 0 0 1-1.704 0L13.5 14.5"/><path d="M9 21a6 6 0 0 0-6-6"/><path d="M9.352 10.648a1.205 1.205 0 0 0 0 1.704l2.296 2.296a1.205 1.205 0 0 0 1.704 0l4.296-4.296a1.205 1.205 0 0 0 0-1.704l-2.296-2.296a1.205 1.205 0 0 0-1.704 0z"/></svg>'

// Lucide "locate-fixed" — crosshair with centre dot
const SVG_LOCATE = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="2" x2="5" y1="12" y2="12"/><line x1="19" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="5"/><line x1="12" x2="12" y1="19" y2="22"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/></svg>'
// Lucide "route" — import a tour (GPX / Komoot)
const SVG_ROUTE = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/></svg>'

// Lucide plus / minus — replace Leaflet's default "+"/"−" glyphs so the zoom
// control matches the icon style of the layer switcher / locate button.
const SVG_PLUS = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" x2="12" y1="5" y2="19"/><line x1="5" x2="19" y1="12" y2="12"/></svg>'
const SVG_MINUS = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" x2="19" y1="12" y2="12"/></svg>'

/** A control button that recenters the map on the user's location. */
export function createLocateControl(onClick: () => void): L.Control {
  const control = L.control({ position: 'bottomleft' })
  control.onAdd = () => {
    const container = L.DomUtil.create('div', 'locate-control leaflet-bar')
    const btn = L.DomUtil.create('button', 'locate-btn', container) as HTMLButtonElement
    btn.type = 'button'
    btn.innerHTML = SVG_LOCATE
    btn.title = 'Zu meinem Standort'
    btn.setAttribute('aria-label', 'Zu meinem Standort')
    L.DomEvent.on(btn, 'click', (e: Event) => { L.DomEvent.stop(e); onClick() })
    L.DomEvent.disableClickPropagation(container)
    return container
  }
  return control
}

/** Map-actions control (bottom-left): the locate button and the route-import button. */
export function createMapActions(onLocate: () => void, onTrack: () => void = () => {}): L.Control {
  const control = L.control({ position: 'bottomleft' })
  control.onAdd = () => {
    const container = L.DomUtil.create('div', 'map-actions leaflet-bar')

    const locateBtn = L.DomUtil.create('button', 'locate-btn', container) as HTMLButtonElement
    locateBtn.type = 'button'
    locateBtn.innerHTML = SVG_LOCATE
    locateBtn.title = 'Zu meinem Standort'
    locateBtn.setAttribute('aria-label', 'Zu meinem Standort')
    L.DomEvent.on(locateBtn, 'click', (e: Event) => { L.DomEvent.stop(e); onLocate() })

    const trackBtn = L.DomUtil.create('button', 'locate-btn track-btn', container) as HTMLButtonElement
    trackBtn.type = 'button'
    trackBtn.innerHTML = SVG_ROUTE
    trackBtn.title = 'Route importieren'
    trackBtn.setAttribute('aria-label', 'Route importieren')
    L.DomEvent.on(trackBtn, 'click', (e: Event) => { L.DomEvent.stop(e); onTrack() })

    L.DomEvent.disableClickPropagation(container)
    return container
  }
  return control
}

export interface BaseLayerConfig {
  readonly label: string
  readonly url: string
  readonly attribution: string
  readonly maxZoom: number
}

/** Satellite layer — Esri World Imagery, keyless and free. */
const SATELLITE_LAYER: BaseLayerConfig = {
  label: 'Satellit',
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  attribution: 'Luftbilder © <a href="https://www.esri.com">Esri</a>, Maxar, Earthstar Geographics',
  maxZoom: 19,
}

const CARTO_VOYAGER_URL = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png'

/** Reads the build-time CARTO key (Vite replaces `import.meta.env.VITE_*` statically). */
function readCartoKey(): string {
  try {
    return (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.['VITE_CARTO_API_KEY'] || ''
  } catch {
    return ''
  }
}

/** The CARTO key baked into this build — empty string when none was configured. */
export const CARTO_API_KEY = readCartoKey()

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
      label: 'Karte',
      url: `${CARTO_VOYAGER_URL}?key=${encodeURIComponent(cartoKey)}`,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende © <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom: 20,
    }
  }
  return {
    label: 'Karte',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Kartendarstellung © <a href="https://www.esri.com">Esri</a> — Quellen: Esri, HERE, Garmin, USGS, <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende',
    maxZoom: 19,
  }
}

/** Base map layers offered in the layer switcher (top-right control). */
export const BASE_LAYER_CONFIGS: readonly BaseLayerConfig[] = [
  buildMapLayerConfig(),
  SATELLITE_LAYER,
]

/** Builds a `{ label → TileLayer }` map from the configs — first entry is the default. */
export function buildBaseLayers(configs: readonly BaseLayerConfig[] = BASE_LAYER_CONFIGS): Record<string, L.TileLayer> {
  const layers: Record<string, L.TileLayer> = {}
  for (const cfg of configs) {
    layers[cfg.label] = L.tileLayer(cfg.url, { attribution: cfg.attribution, maxZoom: cfg.maxZoom })
  }
  return layers
}

function createLayerSwitcher(
  baseLayers: Record<string, L.TileLayer>,
  map: L.Map,
  onLayerSwitch?: (key: string) => void,
): L.Control {
  const control = L.control({ position: 'topright' })

  control.onAdd = () => {
    const container = L.DomUtil.create('div', 'layer-switcher leaflet-bar')

    const keys = Object.keys(baseLayers)
    let activeKey = keys[0]!

    for (const key of keys) {
      const btn = L.DomUtil.create('button', 'layer-btn', container)
      btn.innerHTML = key === 'Karte' ? SVG_MAP : SVG_SATELLITE
      btn.title = key
      btn.setAttribute('aria-label', key)
      if (key === activeKey) btn.classList.add('active')

      L.DomEvent.on(btn, 'click', () => {
        if (key === activeKey) return
        baseLayers[activeKey]?.remove()
        baseLayers[key]?.addTo(map)
        activeKey = key
        container.querySelectorAll('.layer-btn').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
        onLayerSwitch?.(key)
      })
    }

    L.DomEvent.disableClickPropagation(container)
    return container
  }

  return control
}

export class MapService {
  private readonly map: L.Map
  private readonly boundsListeners: Array<(b: LatLngBounds) => void> = []
  private readonly contextMenuListeners: Array<(lat: number, lng: number) => void> = []
  private readonly placementListeners: Array<(lat: number, lng: number) => void> = []
  private readonly locateListeners: Array<() => void> = []
  private readonly trackActionListeners: Array<() => void> = []
  private readonly dragStartListeners: Array<() => void> = []
  private readonly zoomStartListeners: Array<() => void> = []
  private readonly baseLayerChangeListeners: Array<(key: string) => void> = []
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private _isPlacing = false

  constructor(
    container: HTMLElement,
    center: [number, number] = [48.137, 11.576],
    zoom = 13,
  ) {
    this.map = L.map(container, { zoomControl: true }).setView(center, zoom)

    const baseLayers = buildBaseLayers()
    baseLayers[BASE_LAYER_CONFIGS[0]!.label]!.addTo(this.map)
    createLayerSwitcher(baseLayers, this.map, key => {
      for (const l of this.baseLayerChangeListeners) l(key)
    }).addTo(this.map)
    createMapActions(
      () => { for (const l of this.locateListeners) l() },
      () => { for (const l of this.trackActionListeners) l() },
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
  onTrackAction(listener: () => void): () => void {
    this.trackActionListeners.push(listener)
    return () => {
      const idx = this.trackActionListeners.indexOf(listener)
      if (idx !== -1) this.trackActionListeners.splice(idx, 1)
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

  /** Fires when the user switches the base layer (Karte / Satellit). */
  onBaseLayerChange(listener: (key: string) => void): () => void {
    this.baseLayerChangeListeners.push(listener)
    return () => {
      const idx = this.baseLayerChangeListeners.indexOf(listener)
      if (idx !== -1) this.baseLayerChangeListeners.splice(idx, 1)
    }
  }

  /** Enter placement mode — next map click places a POI. */
  startPlacement(): void {
    if (this._isPlacing) return
    this._isPlacing = true
    this.map.getContainer().classList.add('placing-poi')
    const handler = (e: L.LeafletMouseEvent) => {
      if (!this._isPlacing) return
      this.cancelPlacement()
      for (const l of this.placementListeners) l(e.latlng.lat, e.latlng.lng)
    }
    this.map.once('click', handler)
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { this.cancelPlacement(); document.removeEventListener('keydown', escHandler) }
    }
    document.addEventListener('keydown', escHandler)
    const cancelClick = () => this.cancelPlacement() // right-click cancels
    this.map.once('contextmenu', cancelClick)
  }

  /** Exit placement mode without placing. */
  cancelPlacement(): void {
    if (!this._isPlacing) return
    this._isPlacing = false
    this.map.getContainer().classList.remove('placing-poi')
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
