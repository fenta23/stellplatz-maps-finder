import { describe, it, expect, beforeEach } from 'vitest'
import L from 'leaflet'
import { createLeafletPoiHighlight, HIGHLIGHT_PANE } from './poiHighlight.js'

let map: L.Map
let el: HTMLElement
const marks = () => [...el.querySelectorAll<HTMLElement>('.poi-highlight')]
const POS = { lat: 48.1, lon: 9.1 }

beforeEach(() => {
  el = document.createElement('div')
  document.body.appendChild(el)
  map = L.map(el).setView([48, 9], 10)
})

describe('createLeafletPoiHighlight', () => {
  it('puts its pane above the marker pane (clusters) and lets clicks through', () => {
    createLeafletPoiHighlight(map)
    const pane = map.getPane(HIGHLIGHT_PANE)!
    expect(Number(pane.style.zIndex)).toBeGreaterThan(600)
    expect(Number(pane.style.zIndex)).toBeLessThan(650)
    expect(pane.style.pointerEvents).toBe('none')
  })

  it('show marks the position with a ring and the enlarged icon, in its own pane', () => {
    const h = createLeafletPoiHighlight(map)
    h.show(POS, 'data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E')
    expect(marks()).toHaveLength(1)
    const mark = marks()[0]!
    expect(map.getPane(HIGHLIGHT_PANE)!.contains(mark)).toBe(true)
    expect(mark.querySelector('.poi-highlight-ring')).not.toBeNull()
    expect(mark.querySelector<HTMLImageElement>('img.poi-highlight-icon')!.getAttribute('src'))
      .toBe('data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E')
    const layers: L.Marker[] = []
    map.eachLayer(l => { if (l instanceof L.Marker) layers.push(l) })
    expect(layers).toHaveLength(1)
    expect(layers[0]!.getLatLng()).toEqual(L.latLng(POS.lat, POS.lon))
    expect(layers[0]!.options.interactive).toBe(false)
  })

  it('shows only the ring without an icon', () => {
    const h = createLeafletPoiHighlight(map)
    h.show(POS)
    expect(marks()[0]!.querySelector('.poi-highlight-ring')).not.toBeNull()
    expect(marks()[0]!.querySelector('img')).toBeNull()
  })

  it('show again moves the mark instead of adding a second one; clear removes it', () => {
    const h = createLeafletPoiHighlight(map)
    h.show(POS)
    h.show({ lat: 48.2, lon: 9.2 })
    expect(marks()).toHaveLength(1)
    h.clear()
    expect(marks()).toHaveLength(0)
    h.clear() // no-op
  })

  it('reuses the pane when created twice on the same map', () => {
    createLeafletPoiHighlight(map)
    createLeafletPoiHighlight(map)
    expect(el.querySelectorAll(`.leaflet-${HIGHLIGHT_PANE}-pane`)).toHaveLength(1)
  })
})
