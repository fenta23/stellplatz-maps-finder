import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import L from 'leaflet'
import { readFileSync } from 'node:fs'
import { BASE_LAYER_CONFIGS, MapService, TOPO_LAYER, buildBaseLayers, buildCycleLayerConfig, buildMapLayerConfig, createLocateControl, createMapActions } from './MapService.js'

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
  it('renders the locate and route-import buttons (no routing-mode toggle)', () => {
    const onLocate = vi.fn()
    const onTrack = vi.fn()
    const el = (createMapActions(onLocate, onTrack) as unknown as OnAdd).onAdd()
    expect(el.classList.contains('map-actions')).toBe(true)
    expect(el.querySelector('.routing-toggle')).toBeNull()
    expect(el.querySelectorAll('button')).toHaveLength(2)
    el.querySelector<HTMLButtonElement>('.locate-btn:not(.track-btn)')!.click()
    expect(onLocate).toHaveBeenCalledOnce()
    expect(onTrack).not.toHaveBeenCalled()
    const trackBtn = el.querySelector<HTMLButtonElement>('.track-btn')!
    expect(trackBtn.title).toBe('Route importieren')
    expect(trackBtn.getAttribute('aria-label')).toBe('Route importieren')
    trackBtn.click()
    expect(onTrack).toHaveBeenCalledOnce()
    expect(onLocate).toHaveBeenCalledOnce()
  })
})

describe('BASE_LAYER_CONFIGS', () => {
  it('offers map, satellite, cycle and topo in this order (map is the default)', () => {
    expect(BASE_LAYER_CONFIGS.map(c => c.id)).toEqual(['map', 'satellite', 'cycle', 'topo'])
    expect(BASE_LAYER_CONFIGS[0]!.label).toBe('Karte')
    expect(BASE_LAYER_CONFIGS[1]!.label).toBe('Satellit')
    expect(BASE_LAYER_CONFIGS[3]!.label).toBe('Topografische Karte')
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
    expect(Object.keys(layers)).toEqual(BASE_LAYER_CONFIGS.map(c => c.label))
  })

  it('wires the configured url into each tile layer', () => {
    const layers = buildBaseLayers([
      { id: 'map', label: 'Karte', url: 'https://example.test/{z}/{x}/{y}.png', attribution: 'x', maxZoom: 20 },
      { id: 'satellite', label: 'Satellit', url: 'https://sat.test/{z}/{y}/{x}', attribution: 'y', maxZoom: 19 },
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

describe('buildCycleLayerConfig', () => {
  it('uses Thunderforest OpenCycleMap with the encoded key when configured', () => {
    const cfg = buildCycleLayerConfig('a b&c')
    expect(cfg.id).toBe('cycle')
    expect(cfg.label).toBe('OpenCycleMap')
    expect(cfg.url).toBe('https://{s}.tile.thunderforest.com/cycle/{z}/{x}/{y}.png?apikey=a%20b%26c')
    expect(cfg.subdomains).toEqual(['a', 'b', 'c'])
    expect(cfg.maxZoom).toBe(22)
    expect(cfg.attribution).toContain('Thunderforest')
    expect(cfg.attribution).toContain('OpenStreetMap')
  })

  it('falls back to keyless CyclOSM without a key and leaks no key', () => {
    const cfg = buildCycleLayerConfig('')
    expect(cfg.id).toBe('cycle')
    expect(cfg.label).toBe('Fahrradkarte')
    expect(cfg.url).toBe('https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png')
    expect(cfg.url).not.toContain('thunderforest')
    expect(cfg.url).not.toContain('apikey')
    expect(cfg.subdomains).toEqual(['a', 'b', 'c'])
    expect(cfg.maxZoom).toBe(20)
    expect(cfg.attribution).toContain('CyclOSM')
    expect(cfg.attribution).toContain('OpenStreetMap')
  })
})

describe('TOPO_LAYER', () => {
  it('is OpenTopoMap with native zoom 17', () => {
    expect(TOPO_LAYER.id).toBe('topo')
    expect(TOPO_LAYER.label).toBe('Topografische Karte')
    expect(TOPO_LAYER.url).toBe('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png')
    expect(TOPO_LAYER.subdomains).toEqual(['a', 'b', 'c'])
    expect(TOPO_LAYER.maxZoom).toBe(17)
    expect(TOPO_LAYER.attribution).toContain('OpenTopoMap')
    expect(TOPO_LAYER.attribution).toContain('SRTM')
  })
})

describe('buildBaseLayers zoom handling', () => {
  it('upscales native tiles instead of shrinking the map zoom range', () => {
    const layers = buildBaseLayers()
    const topo = layers['Topografische Karte']!.options
    const overallMax = Math.max(...BASE_LAYER_CONFIGS.map(c => c.maxZoom))
    expect(topo.maxNativeZoom).toBe(17)
    expect(topo.maxZoom).toBe(overallMax)
    for (const l of Object.values(layers)) expect(l.options.maxZoom).toBe(overallMax)
  })
})

describe('MapService base layer chooser', () => {
  const KEY = 'stellplatz:base-layer'
  let host: HTMLElement

  const activeTileUrls = (svc: MapService): string[] => {
    const urls: string[] = []
    svc.getMap().eachLayer(l => { if (l instanceof L.TileLayer) urls.push((l as unknown as { _url: string })._url) })
    return urls
  }
  const radios = (): HTMLInputElement[] => Array.from(host.querySelectorAll<HTMLInputElement>('.layer-switcher input[type=radio]'))
  const panel = (): HTMLElement => host.querySelector<HTMLElement>('.layer-panel')!
  const toggle = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('.layer-btn')!

  beforeEach(() => {
    localStorage.clear()
    host = document.createElement('div')
    host.style.width = '400px'
    host.style.height = '400px'
    document.body.appendChild(host)
  })
  afterEach(() => { host.remove(); vi.restoreAllMocks() })

  it('renders one labelled button and a closed radiogroup listing all layers', () => {
    const svc = new MapService(host)
    expect(host.querySelectorAll('.layer-btn')).toHaveLength(1)
    expect(toggle().getAttribute('aria-label')).toBe('Ebenen')
    expect(toggle().title).toBe('Ebenen')
    expect(panel().hidden).toBe(true)
    expect(panel().querySelector('.layer-panel-title')?.textContent).toBe('Ebenen')
    expect(panel().querySelector('[role=radiogroup]')).toBeTruthy()
    expect(radios().map(r => r.value)).toEqual(['map', 'satellite', 'cycle', 'topo'])
    const labels = Array.from(panel().querySelectorAll('label')).map(l => l.textContent)
    expect(labels).toEqual(BASE_LAYER_CONFIGS.map(c => c.label))
    expect(radios().map(r => r.checked)).toEqual([true, false, false, false])
    expect(svc.getBaseLayerLabel()).toBe('Karte')
  })

  it('opens on button click and closes again', () => {
    new MapService(host)
    toggle().click()
    expect(panel().hidden).toBe(false)
    expect(toggle().getAttribute('aria-expanded')).toBe('true')
    toggle().click()
    expect(panel().hidden).toBe(true)
  })

  it('selecting a layer switches the tile layer, closes the panel and notifies with the label', () => {
    const svc = new MapService(host)
    const listener = vi.fn()
    svc.onBaseLayerChange(listener)
    toggle().click()
    radios()[3]!.click()
    expect(listener).toHaveBeenCalledExactlyOnceWith('Topografische Karte')
    expect(svc.getBaseLayerLabel()).toBe('Topografische Karte')
    expect(activeTileUrls(svc)).toEqual([TOPO_LAYER.url])
    expect(panel().hidden).toBe(true)
    expect(radios().map(r => r.checked)).toEqual([false, false, false, true])
    expect(localStorage.getItem(KEY)).toBe('topo')
  })

  it('re-selecting the active layer only closes the panel', () => {
    const svc = new MapService(host)
    const listener = vi.fn()
    svc.onBaseLayerChange(listener)
    toggle().click()
    radios()[0]!.click()
    expect(listener).not.toHaveBeenCalled()
    expect(panel().hidden).toBe(true)
  })

  it('closes on Escape and on an outside click, but not on a click inside', () => {
    new MapService(host)
    toggle().click()
    panel().querySelector<HTMLElement>('.layer-panel-title')!.click()
    expect(panel().hidden).toBe(false)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(panel().hidden).toBe(true)
    toggle().click()
    document.body.click()
    expect(panel().hidden).toBe(true)
  })

  it('keeps a layer on the map configured to upscale at zoom 19 for topo', () => {
    const svc = new MapService(host, [48.1, 11.5], 19)
    toggle().click()
    radios()[3]!.click()
    const tiles: L.TileLayer[] = []
    svc.getMap().eachLayer(l => { if (l instanceof L.TileLayer) tiles.push(l) })
    expect(tiles).toHaveLength(1)
    expect(tiles[0]!.options.maxNativeZoom).toBe(17)
    expect(tiles[0]!.options.maxZoom).toBeGreaterThanOrEqual(19)
    expect(svc.getMap().getZoom()).toBe(19)
    expect(svc.getMap().getMaxZoom()).toBeGreaterThanOrEqual(19)
  })

  it('restores the stored layer id at construction', () => {
    localStorage.setItem(KEY, 'cycle')
    const svc = new MapService(host)
    expect(svc.getBaseLayerLabel()).toBe(BASE_LAYER_CONFIGS[2]!.label)
    expect(radios().map(r => r.checked)).toEqual([false, false, true, false])
  })

  it('falls back to the default for an unknown stored id', () => {
    localStorage.setItem(KEY, 'nonsense')
    expect(new MapService(host).getBaseLayerLabel()).toBe('Karte')
  })

  it('falls back to the default when localStorage throws, and swallows write errors', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    const svc = new MapService(host)
    expect(svc.getBaseLayerLabel()).toBe('Karte')
    toggle().click()
    expect(() => radios()[1]!.click()).not.toThrow()
    expect(svc.getBaseLayerLabel()).toBe('Satellit')
  })
})

// jsdom applies no stylesheets, so the CSS is checked as text.
describe('MapService.pickPoint', () => {
  let host: HTMLDivElement
  let svc: MapService
  const at = (lat: number, lng: number): void => { svc.getMap().fire('click', { latlng: L.latLng(lat, lng) }) }
  const rightClick = (): void => { svc.getMap().fire('contextmenu', { latlng: L.latLng(1, 2) }) }
  const esc = (): void => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) }
  const placing = (): boolean => host.classList.contains('placing-poi')

  beforeEach(() => {
    localStorage.clear()
    host = document.createElement('div')
    host.style.width = '400px'
    host.style.height = '400px'
    document.body.appendChild(host)
    svc = new MapService(host)
  })
  afterEach(() => { host.remove(); vi.restoreAllMocks() })

  it('reports the next map click exactly once and does not call onCancel', () => {
    const onPick = vi.fn()
    const onCancel = vi.fn()
    svc.pickPoint(onPick, onCancel)
    at(48.1, 11.5)
    at(49, 12)
    expect(onPick).toHaveBeenCalledExactlyOnceWith(48.1, 11.5)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('cleans up flag and CSS class after a successful pick and after a cancel', () => {
    const cancel = svc.pickPoint(vi.fn())
    expect(svc.isPlacing).toBe(true)
    expect(placing()).toBe(true)
    at(1, 2)
    expect(svc.isPlacing).toBe(false)
    expect(placing()).toBe(false)
    svc.pickPoint(vi.fn())
    expect(placing()).toBe(true)
    cancel() // stale handle: must not end the new pick
    expect(svc.isPlacing).toBe(true)
    esc()
    expect(svc.isPlacing).toBe(false)
    expect(placing()).toBe(false)
  })

  it('Escape cancels once and a later click picks nothing', () => {
    const onPick = vi.fn()
    const onCancel = vi.fn()
    svc.pickPoint(onPick, onCancel)
    esc()
    esc()
    at(1, 2)
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onPick).not.toHaveBeenCalled()
    expect(svc.isPlacing).toBe(false)
  })

  it('right-click/long-press cancels the pick and never reaches onContextMenu listeners', () => {
    const onPick = vi.fn()
    const onCancel = vi.fn()
    const onContextMenu = vi.fn()
    svc.onContextMenu(onContextMenu)
    svc.pickPoint(onPick, onCancel)
    rightClick()
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onContextMenu).not.toHaveBeenCalled()
    expect(onPick).not.toHaveBeenCalled()
    expect(placing()).toBe(false)
    // after the pick the context menu works again
    rightClick()
    expect(onContextMenu).toHaveBeenCalledOnce()
  })

  it('the returned cancel function ends the pick, calls onCancel once and is idempotent', () => {
    const onPick = vi.fn()
    const onCancel = vi.fn()
    const cancel = svc.pickPoint(onPick, onCancel)
    cancel()
    cancel()
    at(1, 2)
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onPick).not.toHaveBeenCalled()
    expect(svc.isPlacing).toBe(false)
  })

  it('regression: a cancelled pick does not fire together with the next pick', () => {
    const first = vi.fn()
    const second = vi.fn()
    svc.pickPoint(first)
    esc()
    svc.pickPoint(second)
    at(48, 11)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledExactlyOnceWith(48, 11)
  })

  it('regression: a cancelled pick leaves no map or document listeners behind', () => {
    const map = svc.getMap()
    const ctxBefore = (map as unknown as { _events: Record<string, unknown[] | undefined> })._events.contextmenu?.length ?? 0
    const added = vi.spyOn(document, 'addEventListener')
    const removed = vi.spyOn(document, 'removeEventListener')
    const keydowns = (spy: typeof added): number => spy.mock.calls.filter(c => c[0] === 'keydown').length
    expect(map.listens('click')).toBe(false)
    for (const abort of [esc, rightClick, () => svc.cancelPlacement()]) {
      svc.startPlacement()
      abort()
      expect(map.listens('click')).toBe(false)
      expect((map as unknown as { _events: Record<string, unknown[] | undefined> })._events.contextmenu?.length ?? 0).toBe(ctxBefore)
      expect(keydowns(removed)).toBe(keydowns(added))
    }
  })

  it('regression: a placement cancelled before another one emits only once', () => {
    const onPlacement = vi.fn()
    svc.onPlacement(onPlacement)
    svc.startPlacement()
    rightClick()
    svc.startPlacement()
    at(48, 11)
    at(49, 12)
    expect(onPlacement).toHaveBeenCalledExactlyOnceWith(48, 11)
  })

  it('a new pickPoint cancels the running one (its onCancel fires) and takes over', () => {
    const firstPick = vi.fn()
    const firstCancel = vi.fn()
    const secondPick = vi.fn()
    const secondCancel = vi.fn()
    svc.pickPoint(firstPick, firstCancel)
    svc.pickPoint(secondPick, secondCancel)
    expect(firstCancel).toHaveBeenCalledOnce()
    expect(svc.isPlacing).toBe(true)
    expect(placing()).toBe(true)
    at(5, 6)
    expect(firstPick).not.toHaveBeenCalled()
    expect(secondPick).toHaveBeenCalledExactlyOnceWith(5, 6)
    expect(secondCancel).not.toHaveBeenCalled()
    expect(firstCancel).toHaveBeenCalledOnce()
  })

  it('a stale cancel handle does not end a newer pick', () => {
    const stale = svc.pickPoint(vi.fn())
    const onPick = vi.fn()
    const onCancel = vi.fn()
    svc.pickPoint(onPick, onCancel)
    stale()
    expect(onCancel).not.toHaveBeenCalled()
    expect(svc.isPlacing).toBe(true)
    at(7, 8)
    expect(onPick).toHaveBeenCalledExactlyOnceWith(7, 8)
  })

  it('a planner pick does not trigger onPlacement, startPlacement still does', () => {
    const onPlacement = vi.fn()
    svc.onPlacement(onPlacement)
    const onPick = vi.fn()
    svc.pickPoint(onPick)
    at(1, 2)
    expect(onPick).toHaveBeenCalledOnce()
    expect(onPlacement).not.toHaveBeenCalled()
    svc.startPlacement()
    at(3, 4)
    expect(onPlacement).toHaveBeenCalledExactlyOnceWith(3, 4)
  })

  it('startPlacement stays a no-op during a running pick; cancelPlacement ends the pick', () => {
    const onPlacement = vi.fn()
    svc.onPlacement(onPlacement)
    const onCancel = vi.fn()
    svc.pickPoint(vi.fn(), onCancel)
    svc.startPlacement()
    expect(onCancel).not.toHaveBeenCalled()
    svc.cancelPlacement()
    expect(onCancel).toHaveBeenCalledOnce()
    expect(svc.isPlacing).toBe(false)
    expect(placing()).toBe(false)
    at(1, 2)
    expect(onPlacement).not.toHaveBeenCalled()
  })
})

describe('map.css', () => {
  const css = readFileSync('src/client/features/map/map.css', 'utf8')

  it('styles the layer panel and its options', () => {
    expect(css).toMatch(/\.layer-panel\s*\{/)
    expect(css).toMatch(/\.layer-option\s*\{/)
  })

  it('keeps the hidden panel hidden despite explicit display rules', () => {
    expect(css).toMatch(/\.layer-panel\[hidden\]\s*\{\s*display:\s*none/)
  })

  it('has no dangling selector line that swallows the next rule', () => {
    const lines = css.split('\n').map(l => l.trim())
    lines.forEach((l, i) => {
      if (/^[.#][^{},;/]*$/.test(l)) {
        throw new Error(`dangling selector at line ${i + 1}: ${l}`)
      }
    })
    const zoomIn = css.split('\n').filter(l => l.includes('leaflet-control-zoom-in') && !l.includes('svg') && !l.includes(':hover'))
    for (const l of zoomIn) expect(l).not.toContain('.layer-btn')
    expect(css).toMatch(/\.layer-btn\s*\{[^}]*border-radius:\s*8px/)
  })

  it('caps the attribution width so it stays right of the bottom-left controls', () => {
    expect(css).toMatch(/\.leaflet-control-attribution\s*\{[^}]*max-width:\s*calc\(100vw/)
  })
})
