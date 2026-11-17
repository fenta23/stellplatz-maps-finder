import { describe, it, expect, vi } from 'vitest'
import { BASE_LAYER_CONFIGS, buildBaseLayers, buildMapLayerConfig, createLocateControl, createMapActions } from './MapService.js'

type OnAdd = { onAdd: () => HTMLElement }

describe('createLocateControl', () => {
  it('fires the callback when the button is clicked', () => {
    const onClick = vi.fn()
    const el = (createLocateControl(onClick) as unknown as OnAdd).onAdd()
    const btn = el.querySelector<HTMLButtonElement>('.locate-btn')
    expect(btn).toBeTruthy()
    btn!.click()
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('exposes an accessible label', () => {
    const el = (createLocateControl(vi.fn()) as unknown as OnAdd).onAdd()
    expect(el.querySelector('.locate-btn')?.getAttribute('aria-label')).toBe('Zu meinem Standort')
  })
})

describe('createMapActions', () => {
  it('renders only the locate button (no routing-mode toggle)', () => {
    const onLocate = vi.fn()
    const el = (createMapActions(onLocate) as unknown as OnAdd).onAdd()
    expect(el.classList.contains('map-actions')).toBe(true)
    expect(el.querySelector('.routing-toggle')).toBeNull()
    expect(el.querySelectorAll('button')).toHaveLength(1)
    el.querySelector<HTMLButtonElement>('.locate-btn')!.click()
    expect(onLocate).toHaveBeenCalledOnce()
  })
})

describe('BASE_LAYER_CONFIGS', () => {
  it('offers exactly a map and a satellite layer', () => {
    const labels = BASE_LAYER_CONFIGS.map(c => c.label)
    expect(labels).toEqual(['Karte', 'Satellit'])
  })

  it('credits OpenStreetMap on the map layer', () => {
    const map = BASE_LAYER_CONFIGS.find(c => c.label === 'Karte')
    expect(map?.attribution).toContain('OpenStreetMap')
  })

  it('uses Esri World Imagery for the satellite layer', () => {
    const sat = BASE_LAYER_CONFIGS.find(c => c.label === 'Satellit')
    expect(sat?.url).toContain('server.arcgisonline.com')
    expect(sat?.url).toContain('World_Imagery')
  })

  it('every layer carries an attribution (free-tier requirement)', () => {
    for (const cfg of BASE_LAYER_CONFIGS) {
      expect(cfg.attribution.length).toBeGreaterThan(0)
    }
  })

  it('satellite attribution credits Esri', () => {
    const sat = BASE_LAYER_CONFIGS.find(c => c.label === 'Satellit')
    expect(sat?.attribution).toContain('Esri')
  })
})

describe('buildBaseLayers', () => {
  it('creates one tile layer per config, keyed by label', () => {
    const layers = buildBaseLayers()
    expect(Object.keys(layers)).toEqual(['Karte', 'Satellit'])
  })

  it('wires the configured url into each tile layer', () => {
    const layers = buildBaseLayers([
      { label: 'Karte', url: 'https://example.test/{z}/{x}/{y}.png', attribution: 'x', maxZoom: 20 },
      { label: 'Satellit', url: 'https://sat.test/{z}/{y}/{x}', attribution: 'y', maxZoom: 19 },
    ])
    // Leaflet stores the template URL on the layer instance as _url
    expect((layers['Karte'] as unknown as { _url: string })._url).toBe('https://example.test/{z}/{x}/{y}.png')
    expect((layers['Satellit'] as unknown as { _url: string })._url).toBe('https://sat.test/{z}/{y}/{x}')
  })

  it('defaults to BASE_LAYER_CONFIGS', () => {
    const layers = buildBaseLayers()
    expect((layers['Satellit'] as unknown as { _url: string })._url).toContain('arcgisonline.com')
  })
})

// Regression: CARTO brennt seit 2026 ein "API KEY REQUIRED"-Wasserzeichen in
// keylose Voyager-Tiles — ohne Key darf die Karte kein CARTO mehr anfragen.
describe('buildMapLayerConfig', () => {
  it('uses CARTO Voyager with the key appended when a key is configured', () => {
    const cfg = buildMapLayerConfig('abc123')
    expect(cfg.url).toContain('basemaps.cartocdn.com')
    expect(cfg.url).toContain('voyager')
    expect(cfg.url).toContain('?key=abc123')
    expect(cfg.attribution).toContain('CARTO')
    expect(cfg.attribution).toContain('OpenStreetMap')
  })

  it('url-encodes the key', () => {
    expect(buildMapLayerConfig('a b&c').url).toContain('?key=a%20b%26c')
  })

  it('never requests CARTO tiles without a key', () => {
    const cfg = buildMapLayerConfig('')
    expect(cfg.url).not.toContain('cartocdn.com')
    expect(cfg.url).toContain('server.arcgisonline.com')
    expect(cfg.url).toContain('World_Street_Map')
  })

  it('drops the CARTO credit on the keyless fallback and credits Esri instead', () => {
    const cfg = buildMapLayerConfig('')
    expect(cfg.attribution).not.toContain('CARTO')
    expect(cfg.attribution).toContain('Esri')
    expect(cfg.attribution).toContain('OpenStreetMap')
  })

  it('keeps the "Karte" label either way', () => {
    expect(buildMapLayerConfig('key').label).toBe('Karte')
    expect(buildMapLayerConfig('').label).toBe('Karte')
  })
})
