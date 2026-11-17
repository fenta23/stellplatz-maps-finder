import L from 'leaflet'
import type { TrackLayer, MapInsets } from '@/features/track/TrackLayer.js'
import type { TrackPoint } from '@/features/track/trackTypes.js'

const LINE_COLOR = '#2F6FB5'
const LINE_COLOR_SATELLITE = '#FF1493'
const START_COLOR = '#2E9E4F'
const END_COLOR = '#C62828'

/** Extra room at the top for the search and filter bars; the sides/bottom just get a margin. */
export const FIT_PADDING_TOP_LEFT: L.PointTuple = [40, 120]
export const FIT_PADDING_BOTTOM_RIGHT: L.PointTuple = [40, 40]
/** Stops very short tracks from zooming in to street-corner level. */
export const FIT_MAX_ZOOM = 16

const baseLine = { lineCap: 'round', lineJoin: 'round', interactive: false } as const
const endMarker = (color: string) => ({
  radius: 6, color: '#fff', weight: 2, opacity: 1, fillColor: color, fillOpacity: 1, interactive: false,
}) as const

/**
 * Leaflet implementation of the TrackLayer port. Everything lives in one
 * layer group owned here. The default overlay pane (z-index 400) sits above
 * the tiles (200) and below the marker pane (600) used by the POI cluster
 * group, so the line never covers POI markers. Lines are non-interactive so
 * clicks fall through to markers and the map.
 *
 * `renderer` is injectable: production defaults to a canvas renderer (fast
 * for up to 20,000 points); jsdom has no canvas 2d context, so tests pass SVG.
 */
export function createLeafletTrackLayer(
  map: L.Map,
  renderer: L.Renderer = L.canvas({ padding: 0.5 }),
): TrackLayer {
  const group = L.layerGroup()
  let line: L.Polyline | null = null
  let bounds: L.LatLngBounds | null = null
  let satellite = false

  const color = () => (satellite ? LINE_COLOR_SATELLITE : LINE_COLOR)

  const clear = () => {
    group.clearLayers()
    group.remove()
    line = null
    bounds = null
  }

  return {
    show(points: readonly TrackPoint[]) {
      clear()
      if (points.length === 0) return
      const latlngs = points.map(([lat, lon]) => L.latLng(lat, lon))
      bounds = L.latLngBounds(latlngs)
      const casing = L.polyline(latlngs, { ...baseLine, renderer, color: '#fff', weight: 7, opacity: 0.9 })
      line = L.polyline(latlngs, { ...baseLine, renderer, color: color(), weight: 4, opacity: 1 })
      group.addLayer(casing).addLayer(line)
      group.addLayer(L.circleMarker(latlngs[0]!, { ...endMarker(START_COLOR), renderer }))
      group.addLayer(L.circleMarker(latlngs[latlngs.length - 1]!, { ...endMarker(END_COLOR), renderer }))
      group.addTo(map)
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
    },
    clear,
  }
}
