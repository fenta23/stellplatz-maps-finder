import type { ITrackStore } from '@/features/track/TrackStore.js'
import { TrackPanel, type TrackPanelRow } from '@/features/track/TrackPanel.js'
import type { CorridorHit } from '@/features/track/corridor.js'
import type { Track, TrackPosition } from '@/features/track/trackTypes.js'
import { poiKey, type OsmPoi } from '@/features/pois/OverpassClient.js'
import { MSG_CHUNKS_FAILED, type TrackPoiLoader } from './trackPoiLoader.js'
import type { TrackLayer } from '@/features/track/TrackLayer.js'
import { TrackImportDialog, formatKm } from '@/features/track/TrackImportDialog.js'
import { importFromKomootLink } from '@/features/track/komoot.js'
import { readGpxFile } from '@/features/track/gpx.js'

/** What the wiring needs from the viewport POI refresher. */
export interface RefresherControl {
  suspend(): void
  resume(): void
  refresh(): Promise<void> | void
}

export interface TrackRowInfo {
  readonly title: string
  readonly subtitle: string
  readonly color: string
  /** Optional extra line under the subtitle. */
  readonly hint?: string | undefined
  /** Trusted SVG markup from our own icon set. */
  readonly iconSvg?: string | undefined
}

export interface TrackLoaderCallbacks {
  readonly onUpdate: (hits: readonly CorridorHit<OsmPoi>[], done: boolean) => void
  readonly setStatus: (text: string, isError?: boolean) => void
}

export interface TrackWiringDeps {
  readonly store: ITrackStore
  readonly layer: TrackLayer
  readonly dialogContainer: HTMLElement
  readonly flash: (msg: string) => void
  readonly fetchFn?: typeof fetch | undefined
  /** Built by the wiring's owner; the callbacks are the wiring's (breaks the construction cycle). */
  readonly createLoader: (callbacks: TrackLoaderCallbacks) => TrackPoiLoader
  readonly refresher: RefresherControl
  /** Replaces the markers on the map (while a track is active: only the corridor POIs). */
  readonly setMarkers: (pois: readonly OsmPoi[]) => void
  readonly selectPoi: (poi: OsmPoi) => void
  readonly rowFor: (poi: OsmPoi) => TrackRowInfo
  /** Whether the category chip of this POI type is on. */
  readonly isTypeActive: (type: string) => boolean
  readonly panelContainer: HTMLElement
}

export const RETRY_SUFFIX = ' – erneut versuchen'
/** Below this the place counts as "an der Route" (same limit as the detail panel): no connector line. */
export const CONNECTOR_MIN_OFFSET_M = 10

/** Same route (points, name, length), regardless of the corridor — a new TrackStore parse yields new arrays. */
function sameRoute(a: Track, b: Track): boolean {
  if (a === b) return true
  if (a.name !== b.name || a.source !== b.source || a.lengthM !== b.lengthM || a.points.length !== b.points.length) return false
  if (a.points === b.points) return true
  for (let i = 0; i < a.points.length; i++) {
    if (a.points[i]![0] !== b.points[i]![0] || a.points[i]![1] !== b.points[i]![1]) return false
  }
  return true
}

export interface TrackWiring {
  /** Call when the filter store changed; `needsRefetch` = its fetch signature changed. */
  readonly onFiltersChanged: (needsRefetch: boolean) => void
  readonly positionOf: (poi: OsmPoi) => TrackPosition | null
  /** The selected POI changed (null = none): draws/removes the dashed line from the route to it. */
  readonly onPoiSelected: (poi: OsmPoi | null) => void
  readonly isTrackActive: () => boolean
  /** CSS px of the map covered by the track panel (zeros without a track). */
  readonly mapInsets: () => { readonly left: number; readonly bottom: number }
  /** Mobile: fold the list away while the map is being moved. */
  readonly collapsePanel: () => void
  readonly openImport: () => void
  readonly closeImport: () => void
  readonly isImportOpen: () => boolean
  readonly setSatellite: (on: boolean) => void
}

export function createTrackWiring(deps: TrackWiringDeps): TrackWiring {
  const { store, layer, dialogContainer, flash, fetchFn, refresher } = deps

  const draw = (track: ReturnType<ITrackStore['get']>) => {
    if (track) layer.show(track.points)
    else layer.clear()
  }

  // ── POIs along the active track ──
  let current: Track | null = null
  let latestHits: readonly CorridorHit<OsmPoi>[] = []
  let byKey = new Map<string, OsmPoi>()

  const rebuildRows = () => {
    const rows: TrackPanelRow[] = []
    for (const h of latestHits) {
      if (!deps.isTypeActive(h.item.type)) continue
      const info = deps.rowFor(h.item)
      rows.push({
        key: poiKey(h.item), title: info.title, subtitle: info.subtitle, color: info.color,
        ...(info.hint ? { hint: info.hint } : {}),
        ...(info.iconSvg ? { iconSvg: info.iconSvg } : {}),
        kmAlong: h.kmAlong, offsetM: h.offsetM,
      })
    }
    panel.setRows(rows)
  }

  const loader = deps.createLoader({
    onUpdate: hits => {
      latestHits = hits
      byKey = new Map(hits.map(h => [poiKey(h.item), h.item]))
      deps.setMarkers(hits.map(h => h.item))
      rebuildRows()
    },
    setStatus: (text, isError) => {
      if (text === MSG_CHUNKS_FAILED) panel.setStatus(text + RETRY_SUFFIX, true, true)
      else panel.setStatus(text, isError ?? false)
    },
  })

  // Dashed line from the nearest point of the route to the selected place.
  let selected: OsmPoi | null = null
  const drawConnector = () => {
    const poi = current ? selected : null
    const pos = poi ? loader.positionOf(poi) : null
    const foot = poi && pos && pos.offsetM >= CONNECTOR_MIN_OFFSET_M ? loader.footOf(poi) : null
    if (poi && foot) layer.showConnector(foot, [poi.lat, poi.lon])
    else layer.clearConnector()
  }

  const panel = new TrackPanel(deps.panelContainer, {
    onSelectRow: key => { const poi = byKey.get(key); if (poi) deps.selectPoi(poi) },
    onCorridorChange: m => store.setCorridor(m),
    onFit: () => layer.fitBounds(panel.mapInsets()),
    onRemove: () => { store.clear(); flash('Route entfernt') },
    onStatusClick: () => void loader.retryFailed(),
  })

  const activate = (track: Track) => {
    current = track
    latestHits = []
    byKey = new Map()
    refresher.suspend() // the corridor owns the markers now
    panel.setTrack(track)
    void loader.load(track)
    drawConnector() // another route: the line to the selected place belongs to the old one
  }

  const deactivate = () => {
    current = null
    latestHits = []
    byKey = new Map()
    loader.cancel()
    panel.setTrack(null)
    // Take the corridor POIs off the map ourselves: the viewport refresher only
    // repaints when it actually loads something, and it refuses over-wide
    // viewports ("Bitte weiter reinzoomen…") — the route's markers would stay.
    deps.setMarkers([])
    refresher.resume()
    void refresher.refresh() // normal viewport POIs come back
  }

  store.onChange(track => {
    draw(track)
    dialog.refresh()
    if (!track) {
      if (current) deactivate()
    } else if (current && sameRoute(current, track)) {
      current = track // corridor change only: no panel reset, no reload
      loader.setCorridor(track.corridorM)
    } else {
      activate(track)
    }
  })
  // Startup: draw only, the map keeps its normal start position. Suspending
  // here (before the first viewport refresh) avoids a flash of viewport POIs.
  const initial = store.get()
  draw(initial)
  if (initial) activate(initial)

  const dialog = new TrackImportDialog(dialogContainer, {
    getActiveTrack: () => store.get(),
    importLink: (input, signal) => importFromKomootLink(input, fetchFn, signal),
    importFile: file => readGpxFile(file),
    onImported: track => {
      store.set(track)
      // Mobile: fold the sheet first so the route is fitted above the strip only.
      panel.collapseOnMobile()
      layer.fitBounds(panel.mapInsets())
      flash(`Route geladen: ${track.name} · ${formatKm(track.lengthM)}`)
    },
    onShowActive: () => { layer.fitBounds(panel.mapInsets()); dialog.close() },
    onRemoveActive: () => { store.clear(); flash('Route entfernt'); dialog.close() },
  })

  return {
    onFiltersChanged: needsRefetch => {
      if (!current) return
      if (needsRefetch) void loader.reload()
      else loader.reclassify() // re-assigns the loaded POIs, delivers via onUpdate → markers
      rebuildRows()
    },
    positionOf: poi => loader.positionOf(poi),
    onPoiSelected: poi => { selected = poi; drawConnector() },
    isTrackActive: () => current !== null,
    mapInsets: () => panel.mapInsets(),
    collapsePanel: () => { if (current) panel.collapse() },
    openImport: () => dialog.open(),
    closeImport: () => dialog.close(),
    isImportOpen: () => dialog.isOpen(),
    setSatellite: on => layer.setSatellite(on),
  }
}
