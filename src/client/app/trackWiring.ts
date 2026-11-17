import type { ITrackStore } from '@/features/track/TrackStore.js'
import { TrackPanel, formatOffset, formatKmAlong, type TrackPanelRow } from '@/features/track/TrackPanel.js'
import { withinStretch, type CorridorHit } from '@/features/track/corridor.js'
import { buildGpxExport, exportFileName, type GpxWaypoint } from '@/features/track/gpxExport.js'
import { downloadTextFile } from '@/features/track/downloadTextFile.js'
import type { SavedTrack, TrackPosition } from '@/features/track/trackTypes.js'
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
  /** Hands a text file to the user; default: browser download. Injectable for tests. */
  readonly downloadFile?: ((filename: string, mime: string, text: string) => void) | undefined
  /**
   * Runs `run` once map and panel have a size; used for the one-time fit to a route
   * that was already active at startup. Default: after two animation frames.
   */
  readonly scheduleStartupFit?: ((run: () => void) => void) | undefined
}

export const RETRY_SUFFIX = ' – erneut versuchen'
/** Below this the place counts as "an der Route" (same limit as the detail panel): no connector line. */
export const CONNECTOR_MIN_OFFSET_M = 10

/**
 * Default for `scheduleStartupFit`: two animation frames, so the freshly created
 * panel and the map container have been laid out before we measure insets.
 */
function afterLayout(run: () => void): void {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(run))
  else setTimeout(run, 0)
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
  let current: SavedTrack | null = null
  let latestHits: readonly CorridorHit<OsmPoi>[] = []
  let byKey = new Map<string, OsmPoi>()

  /** Stretch ("Abschnitt") of the active track in km; null = whole route. In memory only. */
  let stretch: { readonly from: number; readonly to: number } | null = null

  /** The hits inside the stretch — what the map shows. */
  const stretchedHits = (): readonly CorridorHit<OsmPoi>[] =>
    stretch ? withinStretch(latestHits, stretch.from, stretch.to) : latestHits

  /** What the list shows (and the export contains): stretch + active categories. */
  const listedHits = (): readonly CorridorHit<OsmPoi>[] =>
    stretchedHits().filter(h => deps.isTypeActive(h.item.type))

  const publishMarkers = () => deps.setMarkers(stretchedHits().map(h => h.item))

  const rebuildRows = () => {
    const rows: TrackPanelRow[] = []
    for (const h of listedHits()) {
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
      publishMarkers()
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
    onRemove: () => { store.clear(); flash('Route geschlossen – sie bleibt gespeichert') },
    onStretchChange: (from, to) => {
      const whole = from <= 0 && current !== null && to >= current.lengthM / 1000
      stretch = whole ? null : { from, to }
      publishMarkers()
      rebuildRows()
    },
    onExport: () => exportListed(),
    onStatusClick: () => void loader.retryFailed(),
  })

  const download = deps.downloadFile ?? downloadTextFile

  const exportListed = () => {
    const hits = listedHits()
    if (!current || hits.length === 0) return
    const waypoints: GpxWaypoint[] = hits.map(h => {
      const info = deps.rowFor(h.item)
      // Unnamed places carry the category label as title; named ones have it as subtitle.
      const label = info.subtitle || info.title
      return {
        lat: h.item.lat, lon: h.item.lon, name: info.title, type: label,
        description: `${formatKmAlong(h.kmAlong)} · ${formatOffset(h.offsetM)}`,
      }
    })
    const gpx = buildGpxExport({ name: current.name, points: current.points, waypoints })
    download(exportFileName(current.name), 'application/gpx+xml', gpx)
    flash(`${waypoints.length} ${waypoints.length === 1 ? 'Ort' : 'Orte'} als GPX exportiert`)
  }

  const activate = (track: SavedTrack) => {
    current = track
    stretch = null // a new route starts with the whole stretch (panel.setTrack resets its control)
    latestHits = []
    byKey = new Map()
    refresher.suspend() // the corridor owns the markers now
    panel.setTrack(track)
    void loader.load(track)
    drawConnector() // another route: the line to the selected place belongs to the old one
  }

  const deactivate = () => {
    current = null
    stretch = null
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

  // Routes have ids: the same id = the same route (corridor change or a list-only change
  // such as deleting an inactive route) → no panel reset, no reload, no redraw.
  store.onChange(track => {
    dialog.refresh()
    if (!track) {
      if (current) { draw(null); deactivate() }
    } else if (current && current.id === track.id) {
      const corridorChanged = track.corridorM !== current.corridorM
      current = track
      if (corridorChanged) loader.setCorridor(track.corridorM)
    } else {
      draw(track)
      activate(track)
    }
  })
  // Startup: draw and load now (suspending before the first viewport refresh avoids a
  // flash of viewport POIs); fit once map and panel have a size — unless the user has
  // switched or closed the route by then (that path fits on its own).
  const initial = store.get()
  draw(initial)
  if (initial) {
    activate(initial)
    const schedule = deps.scheduleStartupFit ?? afterLayout
    schedule(() => {
      if (current && current.id === initial.id) layer.fitBounds(panel.mapInsets())
    })
  }

  const dialog = new TrackImportDialog(dialogContainer, {
    getActiveTrack: () => store.get(),
    getSavedTracks: () => store.list(),
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
    onRemoveActive: () => { store.clear(); flash('Route geschlossen – sie bleibt gespeichert'); dialog.close() },
    onActivate: id => {
      const saved = store.list().find(t => t.id === id)
      if (!saved) return
      store.activate(id)
      // Like a fresh import: fold the sheet first so the route is fitted above the strip only.
      panel.collapseOnMobile()
      layer.fitBounds(panel.mapInsets())
      flash(`Route geladen: ${saved.name} · ${formatKm(saved.lengthM)}`)
    },
    onDelete: id => { store.remove(id); flash('Route gelöscht') },
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
