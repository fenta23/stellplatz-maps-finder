import L from 'leaflet'
import type { TrackLayer, TrackEditing, MapInsets } from '@/features/track/TrackLayer.js'
import type { TrackPoint } from '@/features/track/trackTypes.js'
import { attachEditHandles } from './trackEditHandles.js'

/** Line opacity while a recalculation is running. */
const BUSY_OPACITY = 0.45

const LINE_COLOR = '#2F6FB5'
const LINE_COLOR_SATELLITE = '#FF1493'
const START_COLOR = '#2E9E4F'
const END_COLOR = '#C62828'

/** Extra room at the top for the search and filter bars; the sides/bottom just get a margin. */
export const FIT_PADDING_TOP_LEFT: L.PointTuple = [40, 120]
export const FIT_PADDING_BOTTOM_RIGHT: L.PointTuple = [40, 40]
/** Stops very short tracks from zooming in to street-corner level. */
export const FIT_MAX_ZOOM = 16

/** Dash pattern of the connector to a selected place (px: dash, gap). */
export const CONNECTOR_DASH = '8 7'

const baseLine = { lineCap: 'round', lineJoin: 'round', interactive: false } as const
const endMarker = (color: string) => ({
  radius: 6, color: '#fff', weight: 2, opacity: 1, fillColor: color, fillOpacity: 1, interactive: false,
}) as const

/**
 * Leaflet implementation of the TrackLayer port. Everything lives in one
 * layer group owned here. The default overlay pane (z-index 400) sits above
 * the tiles (200) and below the marker pane (600) used by the POI cluster
 * group, so the line never covers POI markers. Without editing, lines are
 * non-interactive so clicks fall through to markers and the map. With editing
 * (`setEditing`) the coloured line is interactive (events still bubble to the
 * map) and the waypoints get draggable handles (see trackEditHandles.ts).
 *
 * `renderer` is injectable: production defaults to a canvas renderer (fast
 * for up to 20,000 points; `tolerance` widens the hit area for fingers); jsdom
 * has no canvas 2d context, so tests pass SVG. `canEdit` locks all edit
 * interaction from outside (e.g. while a map pick is running).
 */
export function createLeafletTrackLayer(
  map: L.Map,
  renderer: L.Renderer = L.canvas({ padding: 0.5, tolerance: 10 }),
  opts: { readonly canEdit?: () => boolean } = {},
): TrackLayer {
  const canEdit = opts.canEdit ?? (() => true)
  const group = L.layerGroup()
  let line: L.Polyline | null = null
  let bounds: L.LatLngBounds | null = null
  let satellite = false
  let points: readonly TrackPoint[] = []
  let editing: TrackEditing | null = null
  let disposeEditing: (() => void) | null = null

  const color = () => (satellite ? LINE_COLOR_SATELLITE : LINE_COLOR)

  // The connector lives in its own group: redrawing the track (e.g. after a
  // corridor change) must not take the line to the selected place with it.
  const connectorGroup = L.layerGroup()
  let connector: L.Polyline | null = null

  const clearTrack = () => {
    disposeEditing?.()
    disposeEditing = null
    group.clearLayers()
    group.remove()
    line = null
    bounds = null
  }
  const clearConnector = () => {
    connectorGroup.clearLayers()
    connectorGroup.remove()
    connector = null
  }

  // Builds the whole track (and, when editing, its handles) from the remembered state.
  const draw = () => {
    clearTrack()
    if (points.length === 0) return
    const latlngs = points.map(([lat, lon]) => L.latLng(lat, lon))
    bounds = L.latLngBounds(latlngs)
    const casing = L.polyline(latlngs, { ...baseLine, renderer, color: '#fff', weight: 7, opacity: 0.9 })
    line = L.polyline(latlngs, {
      ...baseLine, renderer, color: color(), weight: 4, opacity: editing?.busy ? BUSY_OPACITY : 1,
      interactive: editing !== null,
    })
    group.addLayer(casing).addLayer(line)
    if (!editing) {
      group.addLayer(L.circleMarker(latlngs[0]!, { ...endMarker(START_COLOR), renderer }))
      group.addLayer(L.circleMarker(latlngs[latlngs.length - 1]!, { ...endMarker(END_COLOR), renderer }))
    }
    group.addTo(map)
    if (editing) disposeEditing = attachEditHandles(map, line, editing, canEdit)
  }

  return {
    setEditing(next: TrackEditing | null) {
      editing = next
      draw()
    },
    show(next: readonly TrackPoint[]) {
      points = next
      draw()
    },
    fitBounds(insets: MapInsets = {}) {
      if (!bounds) return
      map.fitBounds(bounds, {
        paddingTopLeft: [FIT_PADDING_TOP_LEFT[0] + (insets.left ?? 0), FIT_PADDING_TOP_LEFT[1] + (insets.top ?? 0)],
        paddingBottomRight: [FIT_PADDING_BOTTOM_RIGHT[0] + (insets.right ?? 0), FIT_PADDING_BOTTOM_RIGHT[1] + (insets.bottom ?? 0)],
        maxZoom: FIT_MAX_ZOOM,
      })
    },
    setSatellite(on: boolean) {
      satellite = on
      line?.setStyle({ color: color() })
      connector?.setStyle({ color: color() })
    },
    showConnector(from: TrackPoint, to: TrackPoint) {
      clearConnector()
      const latlngs = [L.latLng(from[0], from[1]), L.latLng(to[0], to[1])]
      const casing = L.polyline(latlngs, { ...baseLine, renderer, color: '#fff', weight: 6, opacity: 0.9 })
      connector = L.polyline(latlngs, {
        ...baseLine, lineCap: 'butt', renderer, color: color(), weight: 3, opacity: 1, dashArray: CONNECTOR_DASH,
      })
      connectorGroup.addLayer(casing).addLayer(connector)
      connectorGroup.addTo(map)
    },
    clearConnector,
    clear() {
      points = []
      clearTrack()
      clearConnector()
    },
  }
}
