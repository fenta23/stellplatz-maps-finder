import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import L from 'leaflet'
import { createLeafletTrackLayer, CONNECTOR_DASH, FIT_MAX_ZOOM, FIT_PADDING_TOP_LEFT, FIT_PADDING_BOTTOM_RIGHT } from './leafletTrackLayer.js'
import type { TrackPoint } from '@/features/track/trackTypes.js'

const POINTS: readonly TrackPoint[] = [[48.0, 9.0], [48.1, 9.1], [48.2, 9.05]]

let map: L.Map
// jsdom has no canvas 2d context, so tests inject the SVG renderer.
const make = () => createLeafletTrackLayer(map, L.svg())
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

describe('createLeafletTrackLayer', () => {
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
  const FROM: TrackPoint = [48.1, 9.1]
  const TO: TrackPoint = [48.12, 9.2]

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
