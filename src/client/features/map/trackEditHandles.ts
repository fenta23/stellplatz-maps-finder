import L from 'leaflet'
import type { TrackEditing } from '@/features/track/TrackLayer.js'
import type { TrackPoint } from '@/features/track/trackTypes.js'

export const HANDLE_PANE = 'track-handles'
/**
 * Above the POI markers (600), highlight (620) and target marker (630), below tooltips
 * (650): the places along a route cluster right on its line and would hide every handle.
 * So that a place under a handle stays tappable, only the visible dot takes pointer
 * events (see `.track-handle` in map.css), not the whole icon box.
 */
const PANE_Z_INDEX = '640'
/** Icon box of a handle; the visible circle (18 px) and the actual hit area are set by CSS. */
const HANDLE_SIZE = 32
/** Mouse travel (container px) below which a press on the line still counts as a plain click. */
export const DRAG_THRESHOLD_PX = 5
/** How long the click that follows a real line drag is swallowed. */
const CLICK_SUPPRESS_MS = 100

const toPoint = (ll: L.LatLng): TrackPoint => [ll.lat, ll.lng]

interface LineDrag {
  readonly grab: L.LatLng
  last: L.LatLng
  readonly temp: L.Marker
  readonly dragWasEnabled: boolean
}

/**
 * Makes an interactive track line editable: one draggable handle per waypoint,
 * grabbing the line (mouse), right-click/long-press on the line, and a hover
 * handle. Only reports through the callbacks of `editing`. Returns a dispose
 * function that removes every layer and listener and aborts a running drag.
 * `canEdit` is asked afresh on each event.
 */
export function attachEditHandles(
  map: L.Map,
  line: L.Polyline,
  editing: TrackEditing,
  canEdit: () => boolean,
): () => void {
  const pane = map.getPane(HANDLE_PANE) ?? map.createPane(HANDLE_PANE)
  pane.style.zIndex = PANE_Z_INDEX
  const busy = editing.busy === true
  const active = () => !busy && canEdit()

  const makeHandle = (at: L.LatLngExpression, kind: string, opts: L.MarkerOptions = {}): L.Marker =>
    L.marker(at, {
      icon: L.divIcon({
        className: `track-handle track-handle--${kind}${busy ? ' track-handle--busy' : ''}`,
        html: '<span class="track-handle-dot"></span>',
        iconSize: [HANDLE_SIZE, HANDLE_SIZE],
        iconAnchor: [HANDLE_SIZE / 2, HANDLE_SIZE / 2],
      }),
      pane: HANDLE_PANE,
      keyboard: false,
      bubblingMouseEvents: false,
      ...opts,
    })

  // ---- waypoint handles ----
  const handles: L.Marker[] = []
  const last = editing.waypoints.length - 1
  editing.waypoints.forEach((wp, index) => {
    const kind = index === 0 ? 'start' : index === last ? 'end' : 'via'
    const title = kind === 'start' ? 'Start verschieben'
      : kind === 'end' ? 'Ziel verschieben'
        : 'Zwischenpunkt verschieben – antippen zum Entfernen'
    const origin = L.latLng(wp[0], wp[1])
    const marker = makeHandle(origin, kind, { draggable: !busy, title }).addTo(map)
    marker.getElement()?.setAttribute('aria-label', title)
    marker.on('dragend', () => {
      if (!active()) {
        marker.setLatLng(origin)
        return
      }
      editing.onMove(index, toPoint(marker.getLatLng()))
    })
    // Leaflet only routes a DOM event to a layer that listens for it; without a
    // listener it falls through to the map, so every handle listens (also start/end)
    // and a long-press must not reach the map's "new custom place" action.
    marker.on('click', (e) => {
      L.DomEvent.stopPropagation(e)
      if (kind === 'via' && active()) editing.onRemove(index)
    })
    marker.on('dblclick contextmenu', (e) => { L.DomEvent.stop(e) })
    handles.push(marker)
  })

  // ---- hover handle ----
  let hover: L.Marker | null = null
  const hideHover = () => {
    hover?.remove()
    hover = null
  }
  const onLineMove = (e: L.LeafletMouseEvent) => {
    if (drag || !active()) return hideHover()
    if (!hover) hover = makeHandle(e.latlng, 'via', { interactive: false }).addTo(map)
    hover.getElement()?.classList.add('track-handle--hover')
    hover.setLatLng(e.latlng)
  }

  // ---- grabbing the line ----
  let drag: LineDrag | null = null
  let swallowClick: (() => void) | null = null

  const onMapMove = (e: L.LeafletMouseEvent) => {
    if (!drag) return
    drag.last = e.latlng
    drag.temp.setLatLng(e.latlng)
  }
  const endDrag = (): LineDrag | null => {
    const d = drag
    if (!d) return null
    drag = null
    d.temp.remove()
    map.off('mousemove', onMapMove)
    document.removeEventListener('mouseup', onMouseUp)
    if (d.dragWasEnabled) map.dragging.enable()
    return d
  }
  const suppressNextClick = () => {
    swallowClick?.()
    const container = map.getContainer()
    const stop = (ev: Event) => { ev.stopPropagation(); done() }
    const timer = setTimeout(() => done(), CLICK_SUPPRESS_MS)
    const done = () => {
      clearTimeout(timer)
      container.removeEventListener('click', stop, true)
      swallowClick = null
    }
    container.addEventListener('click', stop, true)
    swallowClick = done
  }
  function onMouseUp(): void {
    const d = endDrag()
    if (!d) return
    const moved = map.latLngToContainerPoint(d.grab).distanceTo(map.latLngToContainerPoint(d.last))
    if (moved <= DRAG_THRESHOLD_PX) return
    suppressNextClick()
    editing.onInsert(toPoint(d.grab), toPoint(d.last))
  }
  const onLineDown = (e: L.LeafletMouseEvent) => {
    if (drag || !active()) return
    if (e.originalEvent && e.originalEvent.button !== 0) return
    hideHover()
    // Keep the press away from the map, otherwise it starts panning.
    L.DomEvent.stopPropagation(e)
    const dragWasEnabled = map.dragging.enabled()
    map.dragging.disable()
    drag = {
      grab: e.latlng,
      last: e.latlng,
      temp: makeHandle(e.latlng, 'via', { interactive: false }).addTo(map),
      dragWasEnabled,
    }
    map.on('mousemove', onMapMove)
    document.addEventListener('mouseup', onMouseUp)
  }
  const onLineContext = (e: L.LeafletMouseEvent) => {
    if (!active()) return
    // Also keeps the map's own contextmenu handler (new custom place) from firing.
    L.DomEvent.stop(e)
    const p = toPoint(e.latlng)
    editing.onInsert(p, p)
  }

  line.on({
    mousedown: onLineDown,
    mousemove: onLineMove,
    mouseout: hideHover,
    contextmenu: onLineContext,
  })

  return () => {
    endDrag()
    line.off({
      mousedown: onLineDown,
      mousemove: onLineMove,
      mouseout: hideHover,
      contextmenu: onLineContext,
    })
    hideHover()
    for (const h of handles) h.remove()
  }
}
