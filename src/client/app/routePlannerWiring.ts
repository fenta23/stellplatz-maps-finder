import type { OsmPoi } from '@/features/pois/OverpassClient.js'
import type { GeocodeOptions, NominatimResult } from '@/core/nominatim.js'
import type { TargetMarker } from '@/features/map/targetMarker.js'
import { RoutePlannerPanel } from '@/features/route-planner/RoutePlannerPanel.js'
import { createPlaceSuggest } from '@/app/placeSuggest.js'
import {
  defaultTravelMode,
  shortPlaceLabel,
  type PlanPoint, type PlanRequest, type PlanRole,
} from '@/features/route-planner/plannerModel.js'
import type { TravelMode } from '@/core/travelMode.js'
import { fetchPlannedRoute } from '@/features/track/osrmRoute.js'
import type { RoutePoint } from '@/features/track/trackTypes.js'
import { prepareTrack } from '@/features/track/trackImport.js'
import { TrackImportError, trackImportErrorMessage } from '@/features/track/trackErrors.js'
import type { Track } from '@/features/track/trackTypes.js'

type LatLon = { readonly lat: number; readonly lon: number }

export const PLAN_FAILED_MESSAGE = 'Die Route konnte nicht berechnet werden.'
export const MY_LOCATION_LABEL = 'Mein Standort'
const SUGGESTION_LIMIT = 5
/** Half-width of the destination bias box around the start. */
const DEST_BIAS_DEG = 1.5

export interface RoutePlannerWiringDeps {
  /** Slot der Suchbox, in den das Formular kommt. */
  readonly container: HTMLElement
  readonly geocode: (q: string, opts?: GeocodeOptions) => Promise<NominatimResult[]>
  /** Last known position of the user, if any. */
  readonly getUserPos: () => LatLon | null
  /** Ask the device for the position (permission prompt); null when unavailable. */
  readonly requestUserPos: () => Promise<LatLon | null>
  /** `MapService.pickPoint`. */
  readonly pickPoint: (onPick: (lat: number, lng: number) => void, onCancel?: () => void) => () => void
  readonly markers: { readonly start: TargetMarker; readonly end: TargetMarker }
  /** Active profile ids (hiker, cyclist, camper) — picks the initial travel mode. */
  readonly getProfiles: () => readonly string[]
  readonly modeStore: {
    get(): TravelMode | null
    set(mode: TravelMode): void
  }
  /** Hand the planned route over to the track wiring (shows it, saves it, loads POIs). */
  readonly importTrack: (track: Track) => void
  readonly fetchFn?: typeof fetch | undefined
  readonly isMobile: () => boolean
  /** Fold the POI detail sheet away (mobile only, so the map is free for the route). */
  readonly collapseDetail: () => void
  readonly poiLabel: (poi: OsmPoi) => string
  /** Bias for the place search, e.g. the visible map area. */
  readonly getViewbox?: () => GeocodeOptions['viewbox'] | undefined
  /** The planner was closed (button of the search box, Esc, success); after the markers are cleared. */
  readonly onClose?: () => void
  /** Opens the import dialog (link in the form). */
  readonly openImport?: () => void
}

export interface RoutePlannerWiring {
  open(): void
  close(): void
  isOpen(): boolean
  planFromPoi(poi: OsmPoi, role: PlanRole): void
  /** Place chosen in the search line: take it as the destination. */
  planToPlace(place: { readonly lat: number; readonly lon: number; readonly label: string }): void
  /** Puts the focus on the first field that still needs input. */
  focus(): void
  /** Marker tapped while the planner is picking: true = taken as the point (caller must NOT select the POI). */
  offerPoi(poi: OsmPoi): boolean
  /** Route wish in place names (AI): prefill start, destination and mode. Never computes on its own. */
  planFromNames(req: { readonly from: string | null; readonly to: string; readonly mode: TravelMode | null }): Promise<void>
}

const MARKER_PREFIX: Record<PlanRole, string> = { start: 'Start', end: 'Ziel' }

function poiPoint(poi: OsmPoi, label: string): PlanPoint {
  return { lat: poi.lat, lon: poi.lon, label, kind: 'poi' }
}

/** Route planner: place search, own position, map/POI picks, and the hand-over of the planned route. */
export function createRoutePlannerWiring(deps: RoutePlannerWiringDeps): RoutePlannerWiring {
  let start: PlanPoint | null = null
  let end: PlanPoint | null = null

  const showMarker = (role: PlanRole, point: PlanPoint | null): void => {
    const marker = deps.markers[role]
    if (!point) { marker.clear(); return }
    marker.show({ lat: point.lat, lon: point.lon }, { label: `${MARKER_PREFIX[role]}: ${point.label}` })
  }
  const clearMarkers = (): void => {
    deps.markers.start.clear()
    deps.markers.end.clear()
  }

  const suggest = createPlaceSuggest({ geocode: deps.geocode, getViewbox: deps.getViewbox, limit: SUGGESTION_LIMIT })

  async function locate(): Promise<LatLon | null> {
    return deps.getUserPos() ?? await deps.requestUserPos()
  }

  /** A map tap has no name of its own: leave the label out so the route is named after the road OSRM snapped it to. */
  function routePointOf(p: PlanPoint): RoutePoint {
    return p.kind === 'map' ? { lat: p.lat, lon: p.lon } : { lat: p.lat, lon: p.lon, label: p.label }
  }

  async function plan(req: PlanRequest, signal: AbortSignal): Promise<void> {
    const imported = await fetchPlannedRoute(
      { mode: req.mode, waypoints: [routePointOf(req.start), routePointOf(req.end)] },
      deps.fetchFn,
      signal,
    )
    const track = prepareTrack(imported)
    deps.modeStore.set(req.mode)
    // The track layer draws start/end itself from here on.
    clearMarkers()
    deps.importTrack(track)
  }

  const panel = new RoutePlannerPanel(deps.container, {
    suggest,
    locate,
    pickOnMap: done => deps.pickPoint(
      (lat, lng) => done({ lat, lon: lng }),
      () => done(null),
    ),
    plan,
    describeError: err => err instanceof TrackImportError ? trackImportErrorMessage(err) : PLAN_FAILED_MESSAGE,
    initialMode: () => defaultTravelMode(deps.modeStore.get(), deps.getProfiles()),
    onPointsChange: (s, e) => {
      start = s
      end = e
      if (!panel.isOpen()) return
      showMarker('start', s)
      showMarker('end', e)
    },
    onClose: () => { clearMarkers(); deps.onClose?.() },
    ...(deps.openImport ? { onOpenImport: deps.openImport } : {}),
  })

  /** "Mein Standort" is a snapshot: when the planner opens again, move held ones to where the user is now. */
  function refreshOwnPosition(): void {
    const pos = deps.getUserPos()
    if (!pos) return
    for (const role of ['start', 'end'] as const) {
      const held = role === 'start' ? start : end
      if (held?.kind === 'gps' && (held.lat !== pos.lat || held.lon !== pos.lon)) {
        panel.setPoint(role, { ...held, lat: pos.lat, lon: pos.lon })
      }
    }
  }

  function open(): void {
    panel.open()
    refreshOwnPosition()
    // The panel keeps its points across close/open; the markers were cleared on close.
    showMarker('start', start)
    showMarker('end', end)
  }

  function planFrom(point: PlanPoint, role: PlanRole): void {
    const pos = deps.getUserPos()
    // "Als Ziel" with nothing else set yet: the user most likely wants to get there from here.
    const needsStart = role === 'end' && !start && pos !== null
    panel.open({ role, point })
    refreshOwnPosition()
    if (needsStart) {
      panel.setPoint('start', { lat: pos.lat, lon: pos.lon, label: MY_LOCATION_LABEL, kind: 'gps' })
    }
  }

  /** First geocoder hit as a plan point; failures and non-finite coordinates count as no hit. */
  async function geocodeFirst(name: string, opts: GeocodeOptions): Promise<PlanPoint | null> {
    const hit = (await deps.geocode(name, opts))[0]
    if (!hit) return null
    const lat = Number(hit.lat)
    const lon = Number(hit.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
    return { lat, lon, label: shortPlaceLabel(hit.display_name), kind: 'place' }
  }

  async function planFromNames(req: {
    readonly from: string | null
    readonly to: string
    readonly mode: TravelMode | null
  }): Promise<void> {
    panel.open()
    refreshOwnPosition()
    if (req.mode) panel.selectMode(req.mode)

    // Resolves to where the start ended up, so the destination search can be biased towards it.
    let startAnchor: Promise<LatLon | null>
    if (req.from === null) {
      startAnchor = (async () => {
        const pos = await locate().catch(() => null)
        // Own position is optional: without it the user picks the start themselves.
        panel.setPoint('start', pos ? { lat: pos.lat, lon: pos.lon, label: MY_LOCATION_LABEL, kind: 'gps' } : null)
        return pos
      })()
    } else {
      let found: LatLon | null = null
      const from = req.from
      const p = panel.resolvePoint('start', from, async () => {
        const point = await geocodeFirst(from, { limit: 1 })
        found = point
        return point
      })
      startAnchor = p.then(() => found)
    }

    const to = req.to
    const endDone = panel.resolvePoint('end', to, async () => {
      const anchor = await startAnchor
      const viewbox = anchor
        ? {
          west: anchor.lon - DEST_BIAS_DEG, north: anchor.lat + DEST_BIAS_DEG,
          east: anchor.lon + DEST_BIAS_DEG, south: anchor.lat - DEST_BIAS_DEG,
        }
        : undefined
      return geocodeFirst(to, viewbox ? { limit: 1, viewbox } : { limit: 1 })
    })
    await Promise.all([startAnchor, endDone])
  }

  return {
    open,
    close: () => panel.close(),
    isOpen: () => panel.isOpen(),

    planFromPoi(poi, role) {
      planFrom(poiPoint(poi, deps.poiLabel(poi)), role)
      if (deps.isMobile()) deps.collapseDetail()
    },

    planToPlace(place) {
      planFrom({ lat: place.lat, lon: place.lon, label: shortPlaceLabel(place.label), kind: 'place' }, 'end')
    },

    planFromNames,

    focus: () => panel.focusFirstEmpty(),

    offerPoi(poi) {
      const role = panel.pickingRole()
      if (!panel.isOpen() || role === null) return false
      panel.setPoint(role, poiPoint(poi, deps.poiLabel(poi)))
      return true
    },
  }
}
