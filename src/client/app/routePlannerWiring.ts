import type { OsmPoi } from '@/features/pois/OverpassClient.js'
import type { GeocodeOptions, NominatimResult } from '@/core/nominatim.js'
import type { TargetMarker } from '@/features/map/targetMarker.js'
import { RoutePlannerPanel } from '@/features/route-planner/RoutePlannerPanel.js'
import type { PlaceSuggestion } from '@/features/route-planner/PlaceField.js'
import {
  defaultTravelMode,
  type PlanPoint, type PlanRequest, type PlanRole, type TravelMode,
} from '@/features/route-planner/plannerModel.js'
import { fetchPlannedRoute, type RouteEndpoint } from '@/features/track/osrmRoute.js'
import { prepareTrack } from '@/features/track/trackImport.js'
import { TrackImportError, trackImportErrorMessage } from '@/features/track/trackErrors.js'
import type { Track } from '@/features/track/trackTypes.js'

type LatLon = { readonly lat: number; readonly lon: number }

export const PLAN_FAILED_MESSAGE = 'Die Route konnte nicht berechnet werden.'
export const MY_LOCATION_LABEL = 'Mein Standort'
const SUGGESTION_LIMIT = 5

export interface RoutePlannerWiringDeps {
  /** Panel host (`#content`). */
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
}

export interface RoutePlannerWiring {
  open(): void
  close(): void
  isOpen(): boolean
  planFromPoi(poi: OsmPoi, role: PlanRole): void
  /** Marker tapped while the planner is picking: true = taken as the point (caller must NOT select the POI). */
  offerPoi(poi: OsmPoi): boolean
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

  async function suggest(query: string): Promise<readonly PlaceSuggestion[]> {
    const viewbox = deps.getViewbox?.()
    const hits = await deps.geocode(query, { limit: SUGGESTION_LIMIT, ...(viewbox ? { viewbox } : {}) })
    return hits.map(h => ({ label: h.display_name, lat: Number(h.lat), lon: Number(h.lon) }))
      .filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon))
  }

  async function locate(): Promise<LatLon | null> {
    return deps.getUserPos() ?? await deps.requestUserPos()
  }

  /** A map tap has no name of its own: leave the label out so the route is named after the road OSRM snapped it to. */
  function endpointOf(p: PlanPoint): RouteEndpoint {
    return p.kind === 'map' ? { lat: p.lat, lon: p.lon } : { lat: p.lat, lon: p.lon, label: p.label }
  }

  async function plan(req: PlanRequest, signal: AbortSignal): Promise<void> {
    const imported = await fetchPlannedRoute(
      { start: endpointOf(req.start), end: endpointOf(req.end), mode: req.mode },
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
    onClose: clearMarkers,
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

  return {
    open,
    close: () => panel.close(),
    isOpen: () => panel.isOpen(),

    planFromPoi(poi, role) {
      const point = poiPoint(poi, deps.poiLabel(poi))
      const pos = deps.getUserPos()
      // "Als Ziel" with nothing else set yet: the user most likely wants to get there from here.
      const needsStart = role === 'end' && !start && pos !== null
      panel.open({ role, point })
      refreshOwnPosition()
      if (needsStart) {
        panel.setPoint('start', { lat: pos.lat, lon: pos.lon, label: MY_LOCATION_LABEL, kind: 'gps' })
      }
      if (deps.isMobile()) deps.collapseDetail()
    },

    offerPoi(poi) {
      const role = panel.pickingRole()
      if (!panel.isOpen() || role === null) return false
      panel.setPoint(role, poiPoint(poi, deps.poiLabel(poi)))
      return true
    },
  }
}
