import { describe, it, expect, beforeEach } from 'vitest'
import L from 'leaflet'
import { createLeafletTargetMarker, TARGET_PANE } from './targetMarker.js'

let map: L.Map
let el: HTMLElement
const marks = () => [...el.querySelectorAll<HTMLElement>('.target-marker')]
const POS = { lat: 48.1, lon: 9.1 }
const SVG = '<svg data-test="icon"><path d="M0 0"/></svg>'

beforeEach(() => {
  el = document.createElement('div')
  document.body.appendChild(el)
  map = L.map(el).setView([48, 9], 10)
})

describe('createLeafletTargetMarker', () => {
  it('uses its own pane above the marker pane and lets clicks through', () => {
    createLeafletTargetMarker(map)
    const pane = map.getPane(TARGET_PANE)!
    expect(Number(pane.style.zIndex)).toBeGreaterThan(620)
    expect(Number(pane.style.zIndex)).toBeLessThan(650)
    expect(pane.style.pointerEvents).toBe('none')
  })

  it('show adds a non-interactive marker at the position, in its pane', () => {
    const t = createLeafletTargetMarker(map)
    t.show(POS, { label: 'Aral' })
    expect(marks()).toHaveLength(1)
    expect(map.getPane(TARGET_PANE)!.contains(marks()[0]!)).toBe(true)
    expect(marks()[0]!.classList.contains('leaflet-interactive')).toBe(false)
    let found: L.Marker | undefined
    map.eachLayer(l => { if (l instanceof L.Marker) found = l })
    expect(found!.getLatLng()).toEqual(L.latLng(POS.lat, POS.lon))
    expect(found!.options.interactive).toBe(false)
  })

  it('sets the label as text, never as markup', () => {
    const t = createLeafletTargetMarker(map)
    const name = '<img src=x onerror=alert(1)>'
    t.show(POS, { label: name })
    const label = el.querySelector('.target-marker-label')!
    expect(label.textContent).toBe(name)
    expect(el.querySelector('.target-marker img')).toBeNull()
  })

  it('uses the icon markup when given, a neutral dot otherwise', () => {
    const t = createLeafletTargetMarker(map)
    t.show(POS, { label: 'A', iconSvg: SVG })
    expect(el.querySelector('.target-marker-badge svg[data-test="icon"]')).not.toBeNull()
    expect(el.querySelector('.target-marker-dot')).toBeNull()
    t.show(POS, { label: 'A' })
    expect(el.querySelector('.target-marker-badge svg')).toBeNull()
    expect(el.querySelector('.target-marker-dot')).not.toBeNull()
  })

  it('has no pulsing ring like the selection highlight', () => {
    createLeafletTargetMarker(map).show(POS, { label: 'A' })
    expect(el.querySelector('.poi-highlight-ring')).toBeNull()
  })

  it('show twice replaces the previous target', () => {
    const t = createLeafletTargetMarker(map)
    t.show(POS, { label: 'Erste' })
    t.show({ lat: 48.2, lon: 9.2 }, { label: 'Zweite' })
    expect(marks()).toHaveLength(1)
    expect(el.querySelector('.target-marker-label')!.textContent).toBe('Zweite')
  })

  it('clear removes the marker and is safe to repeat', () => {
    const t = createLeafletTargetMarker(map)
    t.show(POS, { label: 'A' })
    t.clear()
    expect(marks()).toHaveLength(0)
    expect(() => t.clear()).not.toThrow()
  })
})
