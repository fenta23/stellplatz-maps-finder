import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import L from 'leaflet'
import { createLeafletRouteLayer, CONNECTOR_DASH, FIT_MAX_ZOOM, FIT_PADDING_TOP_LEFT, FIT_PADDING_BOTTOM_RIGHT } from './leafletRouteLayer.js'
import type { LinePoint } from '@/features/route/routeTypes.js'
import type { RouteLayer, RouteEditing } from '@/features/route/RouteLayer.js'

const POINTS: readonly LinePoint[] = [[48.0, 9.0], [48.1, 9.1], [48.2, 9.05]]

let map: L.Map
// jsdom has no canvas 2d context, so tests inject the SVG renderer.
const make = () => createLeafletRouteLayer(map, L.svg())
const layers = () => {
  const out: L.Layer[] = []
  map.eachLayer(l => out.push(l))
  return out
}
const polylines = () => layers().filter((l): l is L.Polyline => l instanceof L.Polyline && !(l instanceof L.CircleMarker))
const circles = () => layers().filter((l): l is L.CircleMarker => l instanceof L.CircleMarker)

beforeEach(() => {
  const el = document.createElement('div')
  document.body.appendChild(el)
  map = L.map(el).setView([48, 9], 10)
})

describe('createLeafletRouteLayer', () => {
  it('show adds casing, line and two end markers', () => {
    make().show(POINTS)
    expect(polylines()).toHaveLength(2)
    expect(circles()).toHaveLength(2)
  })

  it('show twice replaces instead of leaking', () => {
    const t = make()
    t.show(POINTS)
    t.show(POINTS)
    expect(polylines()).toHaveLength(2)
    expect(circles()).toHaveLength(2)
  })

  it('clear removes everything', () => {
    const t = make()
    t.show(POINTS)
    t.clear()
    expect(polylines()).toHaveLength(0)
    expect(circles()).toHaveLength(0)
  })

  it('lines and markers are non-interactive', () => {
    make().show(POINTS)
    for (const l of [...polylines(), ...circles()]) expect(l.options.interactive).toBe(false)
  })

  it('draws a white casing under the coloured line with round joins', () => {
    make().show(POINTS)
    const [casing, line] = polylines()
    expect(casing!.options.color).toBe('#fff')
    expect(casing!.options.weight).toBeGreaterThan(line!.options.weight!)
    expect(line!.options.color).toBe('#2F6FB5')
    expect(line!.options.lineJoin).toBe('round')
    expect(line!.options.lineCap).toBe('round')
  })

  it('stays in the overlay pane, below the marker pane', () => {
    make().show(POINTS)
    for (const l of polylines()) expect(l.options.pane ?? 'overlayPane').toBe('overlayPane')
    // jsdom does not load Leaflet's stylesheet, so read the pane z-indices from it.
    const css = readFileSync('node_modules/leaflet/dist/leaflet.css', 'utf8')
    const z = (name: string) => Number(new RegExp(`\\.leaflet-${name}-pane\\s*\\{\\s*z-index:\\s*(\\d+)`).exec(css)?.[1])
    expect(z('overlay')).toBe(400)
    expect(z('overlay')).toBeLessThan(z('marker'))
  })

  it('fitBounds passes the track bounds with padding and maxZoom', () => {
    const spy = vi.spyOn(map, 'fitBounds')
    const t = make()
    t.show(POINTS)
    t.fitBounds()
    expect(spy).toHaveBeenCalledOnce()
    const [b, opts] = spy.mock.calls[0]!
    expect((b as L.LatLngBounds).getSouthWest()).toEqual(L.latLng(48.0, 9.0))
    expect((b as L.LatLngBounds).getNorthEast()).toEqual(L.latLng(48.2, 9.1))
    expect(opts?.maxZoom).toBe(FIT_MAX_ZOOM)
    expect(opts?.paddingTopLeft).toBeDefined()
  })

  it('fitBounds adds the insets to the default paddings', () => {
    const spy = vi.spyOn(map, 'fitBounds')
    const t = make()
    t.show(POINTS)
    t.fitBounds({ left: 364, bottom: 52 })
    t.fitBounds()
    const [, withInsets] = spy.mock.calls[0]!
    const [, plain] = spy.mock.calls[1]!
    expect(plain?.paddingTopLeft).toEqual(FIT_PADDING_TOP_LEFT)
    expect(plain?.paddingBottomRight).toEqual(FIT_PADDING_BOTTOM_RIGHT)
    expect(withInsets?.paddingTopLeft).toEqual([FIT_PADDING_TOP_LEFT[0] + 364, FIT_PADDING_TOP_LEFT[1]])
    expect(withInsets?.paddingBottomRight).toEqual([FIT_PADDING_BOTTOM_RIGHT[0], FIT_PADDING_BOTTOM_RIGHT[1] + 52])
  })

  it('fitBounds is a no-op without a track and after clear', () => {
    const spy = vi.spyOn(map, 'fitBounds')
    const t = make()
    t.fitBounds()
    t.show(POINTS)
    t.clear()
    t.fitBounds()
    expect(spy).not.toHaveBeenCalled()
  })

  it('setSatellite restyles a drawn track', () => {
    const t = make()
    t.show(POINTS)
    t.setSatellite(true)
    expect(polylines()[1]!.options.color).toBe('#FF1493')
    t.setSatellite(false)
    expect(polylines()[1]!.options.color).toBe('#2F6FB5')
  })

  it('setSatellite before show applies to the next show', () => {
    const t = make()
    t.setSatellite(true)
    t.show(POINTS)
    expect(polylines()[1]!.options.color).toBe('#FF1493')
  })

  it('does not throw on empty or single-point input', () => {
    const t = make()
    expect(() => t.show([])).not.toThrow()
    expect(layers().some(l => l instanceof L.Polyline)).toBe(false)
    expect(() => t.show([[48, 9]])).not.toThrow()
    expect(() => t.fitBounds()).not.toThrow()
    expect(() => t.setSatellite(true)).not.toThrow()
  })
})

describe('connector to a selected place', () => {
  const dashed = () => polylines().filter(l => l.options.dashArray === CONNECTOR_DASH)
  const FROM: LinePoint = [48.1, 9.1]
  const TO: LinePoint = [48.12, 9.2]

  it('draws a dashed, non-interactive line with a casing between the two points', () => {
    const t = make()
    t.show(POINTS)
    t.showConnector(FROM, TO)
    expect(polylines()).toHaveLength(4)
    expect(dashed()).toHaveLength(1)
    const line = dashed()[0]!
    expect(line.options.interactive).toBe(false)
    expect((line.getLatLngs() as L.LatLng[]).map(p => [p.lat, p.lng])).toEqual([[...FROM], [...TO]])
  })

  it('replaces the previous connector instead of leaking', () => {
    const t = make()
    t.show(POINTS)
    t.showConnector(FROM, TO)
    t.showConnector(FROM, [48.3, 9.3])
    expect(polylines()).toHaveLength(4)
    expect((dashed()[0]!.getLatLngs() as L.LatLng[])[1]!.lat).toBe(48.3)
  })

  it('survives a redraw of the track, goes with clearConnector and with clear', () => {
    const t = make()
    t.show(POINTS)
    t.showConnector(FROM, TO)
    t.show(POINTS)
    expect(dashed()).toHaveLength(1)
    t.clearConnector()
    expect(dashed()).toHaveLength(0)
    expect(polylines()).toHaveLength(2)
    t.showConnector(FROM, TO)
    t.clear()
    expect(layers().filter(l => l instanceof L.Path)).toHaveLength(0)
  })

  it('follows the satellite colour', () => {
    const t = make()
    t.show(POINTS)
    t.showConnector(FROM, TO)
    const before = dashed()[0]!.options.color
    t.setSatellite(true)
    expect(dashed()[0]!.options.color).not.toBe(before)
    t.showConnector(FROM, TO)
    expect(dashed()[0]!.options.color).not.toBe(before)
  })
})

describe('editing', () => {
  const WAYPOINTS: readonly LinePoint[] = [[48.0, 9.0], [48.1, 9.1], [48.2, 9.05]]
  const handles = () => layers().filter((l): l is L.Marker => l instanceof L.Marker)
  const handleClasses = () => handles().map(h => (h.options.icon as L.DivIcon).options.className)
  const mkEditing = (over: Partial<RouteEditing> = {}) => ({
    waypoints: WAYPOINTS,
    onInsert: vi.fn(),
    onMove: vi.fn(),
    onRemove: vi.fn(),
    ...over,
  })
  const setup = (over: Partial<RouteEditing> = {}, canEdit?: () => boolean) => {
    const t = createLeafletRouteLayer(map, L.svg(), canEdit ? { canEdit } : {})
    const editing = mkEditing(over)
    t.setEditing(editing)
    t.show(POINTS)
    return { t, editing }
  }
  const lineLayer = () => polylines()[1]!
  const px = (lat: number, lng: number) => map.latLngToContainerPoint([lat, lng])
  // Real DOM event at a lat/lng so Leaflet derives latlng and runs its own propagation.
  const domEvent = (target: Element, type: string, lat: number, lng: number, init: MouseEventInit = {}) => {
    const p = px(lat, lng)
    const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, button: 0, ...init })
    target.dispatchEvent(ev)
    return ev
  }
  const lineEl = () => lineLayer().getElement()!
  const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  const mouseUp = () => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  // A point 40 px east of the given one at the current zoom.
  const east = (lat: number, lng: number): [number, number] => {
    const p = px(lat, lng)
    const ll = map.containerPointToLatLng([p.x + 40, p.y])
    return [ll.lat, ll.lng]
  }
  const insertCall = (editing: RouteEditing) => (editing.onInsert as ReturnType<typeof vi.fn>).mock.calls[0]!

  it('without editing the line is non-interactive and there are no handles', () => {
    make().show(POINTS)
    expect(handles()).toHaveLength(0)
    expect(lineLayer().options.interactive).toBe(false)
  })

  it('makes the coloured line interactive but not the casing; no canvas end circles', () => {
    setup()
    const [casing, line] = polylines()
    expect(casing!.options.interactive).toBe(false)
    expect(line!.options.interactive).toBe(true)
    expect(circles()).toHaveLength(0)
  })

  it('has one handle per waypoint with start/via/end classes in their own pane', () => {
    setup()
    expect(handles()).toHaveLength(3)
    expect(handleClasses()).toEqual([
      'track-handle track-handle--start',
      'track-handle track-handle--via',
      'track-handle track-handle--end',
    ])
    expect(handles()[0]!.options.draggable).toBe(true)
    expect(handles()[0]!.options.pane).toBe('track-handles')
    expect(handles()[1]!.getElement()?.getAttribute('aria-label')).toContain('Zwischenpunkt')
    expect(handles()[0]!.options.title).toBe('Start verschieben')
    expect(handles()[2]!.options.title).toBe('Ziel verschieben')
  })

  it('keeps the handles above the POI markers (clusters on the line would hide them) and below tooltips', () => {
    setup()
    const handlePane = Number(map.getPane('track-handles')!.style.zIndex)
    expect(handlePane).toBeGreaterThan(600) // marker pane: POI cluster group
    expect(handlePane).toBeLessThan(650) // tooltip pane
  })

  it('gives the same handles whether setEditing or show comes first, and never doubles them', () => {
    const a = createLeafletRouteLayer(map, L.svg())
    a.show(POINTS)
    a.setEditing(mkEditing())
    expect(handles()).toHaveLength(3)
    a.show(POINTS)
    expect(handles()).toHaveLength(3)
    a.setEditing(mkEditing())
    expect(handles()).toHaveLength(3)
    expect(polylines()).toHaveLength(2)
  })

  it('has no handles without a shown track', () => {
    const t = make()
    t.setEditing(mkEditing())
    expect(handles()).toHaveLength(0)
  })

  it('rebuilds handles from the new waypoints on every setEditing', () => {
    const { t } = setup()
    t.setEditing(mkEditing({ waypoints: [[48.0, 9.0], [48.05, 9.02], [48.1, 9.1], [48.2, 9.05]], busy: true }))
    expect(handles()).toHaveLength(4)
    expect(handleClasses()[1]).toContain('track-handle--busy')
    t.setEditing(mkEditing({ waypoints: WAYPOINTS }))
    expect(handles()).toHaveLength(3)
    expect(handleClasses().join()).not.toContain('busy')
  })

  it('dragend reports onMove with the handle position', () => {
    const { editing } = setup()
    const h = handles()[1]!
    h.setLatLng([48.15, 9.2])
    h.fire('dragend')
    expect(editing.onMove).toHaveBeenCalledWith(1, [48.15, 9.2])
  })

  it('click on a via handle removes it; start and end ignore clicks; click does not reach the map', () => {
    const { editing } = setup()
    const mapClick = vi.fn()
    map.on('click', mapClick)
    const [start, via, end] = handles()
    click(start!.getElement()!)
    click(end!.getElement()!)
    expect(editing.onRemove).not.toHaveBeenCalled()
    click(via!.getElement()!)
    expect(editing.onRemove).toHaveBeenCalledWith(1)
    expect(mapClick).not.toHaveBeenCalled()
  })

  it('contextmenu on a handle does not reach the map', () => {
    setup()
    const ctx = vi.fn()
    map.on('contextmenu', ctx)
    handles()[1]!.getElement()!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    expect(ctx).not.toHaveBeenCalled()
  })

  it('contextmenu on the line inserts at that point and is kept from the map', () => {
    const { editing } = setup()
    const ctx = vi.fn()
    map.on('contextmenu', ctx)
    domEvent(lineEl(), 'contextmenu', 48.1, 9.1, { button: 2 })
    expect(editing.onInsert).toHaveBeenCalledOnce()
    const [grab, drop] = insertCall(editing)
    expect(grab).toEqual(drop)
    expect(grab[0]).toBeCloseTo(48.1, 3)
    expect(ctx).not.toHaveBeenCalled()
  })

  it('drag on the line: map panning is off meanwhile, onInsert(grab, drop) on release', () => {
    const { editing } = setup()
    expect(map.dragging.enabled()).toBe(true)
    domEvent(lineEl(), 'mousedown', 48.1, 9.1)
    expect(map.dragging.enabled()).toBe(false)
    const [lat, lng] = east(48.1, 9.1)
    domEvent(map.getContainer(), 'mousemove', lat, lng)
    mouseUp()
    expect(map.dragging.enabled()).toBe(true)
    expect(editing.onInsert).toHaveBeenCalledOnce()
    const [grab, drop] = insertCall(editing)
    // DOM events carry whole pixels, so the grab point is only close to the line point.
    expect(grab[0]).toBeCloseTo(48.1, 2)
    expect(grab[1]).toBeCloseTo(9.1, 2)
    expect(drop[0]).toBeCloseTo(lat, 5)
    expect(drop[1]).toBeCloseTo(lng, 5)
    expect(handles()).toHaveLength(3) // temp handle is gone
  })

  it('shows a temporary non-interactive handle while dragging that follows the mouse', () => {
    setup()
    domEvent(lineEl(), 'mousedown', 48.1, 9.1)
    expect(handles()).toHaveLength(4)
    const [lat, lng] = east(48.1, 9.1)
    domEvent(map.getContainer(), 'mousemove', lat, lng)
    const temp = handles()[3]!
    expect(temp.options.interactive).toBe(false)
    expect(temp.getLatLng().lat).toBeCloseTo(lat, 5)
    mouseUp()
  })

  it('a press under 5 px of movement reports nothing and re-enables panning', () => {
    const { editing } = setup()
    domEvent(lineEl(), 'mousedown', 48.1, 9.1)
    const p = px(48.1, 9.1)
    const near = map.containerPointToLatLng([p.x + 3, p.y])
    domEvent(map.getContainer(), 'mousemove', near.lat, near.lng)
    mouseUp()
    expect(editing.onInsert).not.toHaveBeenCalled()
    expect(map.dragging.enabled()).toBe(true)
  })

  it('swallows the click after a real drag but not after a plain press', () => {
    setup()
    const mapClick = vi.fn()
    map.on('click', mapClick)
    domEvent(lineEl(), 'mousedown', 48.1, 9.1)
    mouseUp()
    click(map.getContainer())
    expect(mapClick).toHaveBeenCalledOnce()

    domEvent(lineEl(), 'mousedown', 48.1, 9.1)
    const [lat, lng] = east(48.1, 9.1)
    domEvent(map.getContainer(), 'mousemove', lat, lng)
    mouseUp()
    click(map.getContainer())
    expect(mapClick).toHaveBeenCalledOnce()
  })

  it('ignores a right-button press on the line', () => {
    setup()
    domEvent(lineEl(), 'mousedown', 48.1, 9.1, { button: 2 })
    expect(map.dragging.enabled()).toBe(true)
  })

  it('hover shows a non-interactive handle on the line and hides it on mouseout', () => {
    setup()
    lineLayer().fire('mousemove', { latlng: L.latLng(48.1, 9.1) })
    expect(handles()).toHaveLength(4)
    expect(handles()[3]!.options.interactive).toBe(false)
    lineLayer().fire('mouseout')
    expect(handles()).toHaveLength(3)
  })

  it('shows no hover handle during a drag', () => {
    setup()
    domEvent(lineEl(), 'mousedown', 48.1, 9.1)
    lineLayer().fire('mousemove', { latlng: L.latLng(48.1, 9.1) })
    expect(handles()).toHaveLength(4) // only the temp handle
    mouseUp()
  })

  it('busy locks handles and line, dims the line and lets contextmenu through to the map', () => {
    const { editing } = setup({ busy: true })
    expect(handles().every(h => h.options.draggable === false)).toBe(true)
    expect(handleClasses().every(c => c!.includes('track-handle--busy'))).toBe(true)
    expect(lineLayer().options.opacity).toBe(0.45)
    const ctx = vi.fn()
    map.on('contextmenu', ctx)
    domEvent(lineEl(), 'contextmenu', 48.1, 9.1, { button: 2 })
    expect(editing.onInsert).not.toHaveBeenCalled()
    expect(ctx).toHaveBeenCalledOnce()
    domEvent(lineEl(), 'mousedown', 48.1, 9.1)
    expect(map.dragging.enabled()).toBe(true)
    lineLayer().fire('mousemove', { latlng: L.latLng(48.1, 9.1) })
    expect(handles()).toHaveLength(3)
    click(handles()[1]!.getElement()!)
    expect(editing.onRemove).not.toHaveBeenCalled()
  })

  it('canEdit() === false blocks everything without visual change and is asked afresh', () => {
    let allowed = false
    const { editing } = setup({}, () => allowed)
    expect(lineLayer().options.opacity).toBe(1)
    expect(handleClasses().join()).not.toContain('busy')
    domEvent(lineEl(), 'contextmenu', 48.1, 9.1, { button: 2 })
    domEvent(lineEl(), 'mousedown', 48.1, 9.1)
    expect(map.dragging.enabled()).toBe(true)
    lineLayer().fire('mousemove', { latlng: L.latLng(48.1, 9.1) })
    expect(handles()).toHaveLength(3)
    click(handles()[1]!.getElement()!)
    handles()[1]!.fire('dragend')
    expect(editing.onInsert).not.toHaveBeenCalled()
    expect(editing.onRemove).not.toHaveBeenCalled()
    expect(editing.onMove).not.toHaveBeenCalled()
    allowed = true
    domEvent(lineEl(), 'contextmenu', 48.1, 9.1, { button: 2 })
    expect(editing.onInsert).toHaveBeenCalledOnce()
  })

  describe('cleanup', () => {
    const midDrag = (act: (t: RouteLayer) => void) => {
      const { t, editing } = setup()
      domEvent(lineEl(), 'mousedown', 48.1, 9.1)
      expect(map.dragging.enabled()).toBe(false)
      act(t)
      const [lat, lng] = east(48.1, 9.1)
      domEvent(map.getContainer(), 'mousemove', lat, lng)
      mouseUp()
      expect(editing.onInsert).not.toHaveBeenCalled()
      expect(map.dragging.enabled()).toBe(true)
      expect(map.listens('mousemove')).toBe(false)
    }

    it('setEditing(null) during a drag aborts it, removes handles and listeners', () => {
      midDrag(t => t.setEditing(null))
      expect(handles()).toHaveLength(0)
      expect(lineLayer().options.interactive).toBe(false)
      expect(circles()).toHaveLength(2)
    })

    it('clear() during a drag aborts it and removes everything', () => {
      midDrag(t => t.clear())
      expect(handles()).toHaveLength(0)
    })

    it('show() during a drag aborts it; handles are rebuilt, not doubled', () => {
      midDrag(t => t.show(POINTS))
      expect(handles()).toHaveLength(3)
    })

    it('removes the hover handle on clear', () => {
      const { t } = setup()
      lineLayer().fire('mousemove', { latlng: L.latLng(48.1, 9.1) })
      t.clear()
      expect(handles()).toHaveLength(0)
    })
  })

  it('setSatellite recolours the line while editing', () => {
    const { t } = setup()
    t.setSatellite(true)
    expect(lineLayer().options.color).toBe('#FF1493')
  })
})
