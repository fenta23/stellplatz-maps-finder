import { describe, it, expect } from 'vitest'
import { DatenschutzPanel } from './DatenschutzPanel.js'

describe('DatenschutzPanel', () => {
  it('renders privacy content with controller and processors', () => {
    const c = document.createElement('div')
    new DatenschutzPanel(c)
    expect(c.textContent).toContain('Verantwortlicher')
    expect(c.textContent).toContain('Supabase')
    expect(c.textContent).toContain('GitHub Pages')
    expect(c.textContent).toContain('netcup')
    expect(c.textContent).toContain('Komoot')
    expect(c.textContent).toContain('api.komoot.de')
    expect(c.textContent).not.toContain('Valhalla')
    expect(c.textContent).toContain('FOSSGIS')
    expect(c.textContent).toContain('routing.openstreetmap.de')
    expect(c.textContent).toContain('Mein Standort')
    expect(c.textContent).not.toContain('Server-Proxy')
    expect(c.textContent).toContain('direkt von deinem Browser an öffentliche')
    expect(c.textContent).toContain('overpass-api.de')
    expect(c.textContent).toContain('nominatim.openstreetmap.org')
    expect(c.textContent).toContain('CARTO')
    expect(c.textContent).toContain('Esri')
    expect(c.textContent).toContain('Thunderforest')
    expect(c.textContent).toContain('CyclOSM')
    expect(c.textContent).toContain('OpenStreetMap France')
    expect(c.textContent).toContain('OpenTopoMap')
  })

  it('starts closed and opens/closes', () => {
    const c = document.createElement('div')
    const panel = new DatenschutzPanel(c)
    expect(panel.isOpen()).toBe(false)
    panel.open()
    expect(panel.isOpen()).toBe(true)
    panel.close()
    expect(panel.isOpen()).toBe(false)
  })

  it('closes when the X button is clicked', () => {
    const c = document.createElement('div')
    const panel = new DatenschutzPanel(c)
    panel.open()
    c.querySelector<HTMLButtonElement>('.fav-close')!.click()
    expect(panel.isOpen()).toBe(false)
  })

  it('closes when the backdrop (panel root) is clicked, not the content', () => {
    const c = document.createElement('div')
    const panel = new DatenschutzPanel(c)
    panel.open()
    // Klick auf den Inhalt (Header) schließt NICHT
    c.querySelector<HTMLElement>('.fav-header')!.click()
    expect(panel.isOpen()).toBe(true)
    // Klick auf den Panel-Root (Backdrop im Desktop-Modal) schließt
    c.querySelector<HTMLElement>('.fav-panel')!.click()
    expect(panel.isOpen()).toBe(false)
  })
})
