import { describe, it, expect, vi } from 'vitest'
import { PoiDetailPanel, nearbyIconSvg } from './PoiDetailPanel.js'
import type { OsmPoi } from '@/features/pois/OverpassClient.js'

const poi: OsmPoi = {
  id: 1,
  type: 'campsite',
  lat: 48.1,
  lon: 11.2,
  tags: {
    name: 'Testcamp',
    opening_hours: 'Mo-Su 08:00-22:00',
    fee: 'yes',
    website: 'https://example.com',
  },
}

describe('PoiDetailPanel', () => {
  it('renders name from tags', () => {
    const container = document.createElement('div')
    const panel = new PoiDetailPanel(container)
    panel.show(poi)
    expect(container.querySelector('h2')?.textContent).toBe('Testcamp')
  })

  it('is hidden initially', () => {
    const container = document.createElement('div')
    new PoiDetailPanel(container)
    expect(container.querySelector('.poi-detail-panel')?.classList.contains('hidden')).toBe(true)
  })

  it('becomes visible on show()', () => {
    const container = document.createElement('div')
    const panel = new PoiDetailPanel(container)
    panel.show(poi)
    expect(container.querySelector('.poi-detail-panel')?.classList.contains('hidden')).toBe(false)
  })

  it('hides on close button click', () => {
    const container = document.createElement('div')
    const panel = new PoiDetailPanel(container)
    panel.show(poi)
    container.querySelector<HTMLButtonElement>('.btn-close')?.click()
    expect(container.querySelector('.poi-detail-panel')?.classList.contains('hidden')).toBe(true)
  })

  it('sets the Losfahren link to a destination-only nav deeplink', () => {
    const container = document.createElement('div')
    new PoiDetailPanel(container).show(poi)
    const a = container.querySelector<HTMLAnchorElement>('.btn-go')
    expect(a?.textContent).toContain('Losfahren')
    expect(a?.getAttribute('href')).toMatch(/destination=48\.1,11\.2|daddr=48\.1,11\.2/)
    expect(a?.getAttribute('href')).not.toMatch(/origin|saddr|travelmode|dirflg/)
  })

  it('renders no routing UI (route summary, start, Route hierhin, Von hier)', () => {
    const container = document.createElement('div')
    new PoiDetailPanel(container).show(poi)
    expect(container.querySelector('.route-summary')).toBeNull()
    expect(container.querySelector('.route-start')).toBeNull()
    expect(container.querySelector('.btn-navigate')).toBeNull()
    expect(container.querySelector('.btn-set-start')).toBeNull()
    expect(container.textContent).not.toContain('Route hierhin')
    expect(container.textContent).not.toContain('Von hier')
  })

  it('links to Google Maps, park4night only for logged-in users', () => {
    const container = document.createElement('div')
    const panel = new PoiDetailPanel(container)
    panel.show(poi)
    expect(container.querySelector<HTMLAnchorElement>('.btn-maps')?.href).toContain('google.com/maps/search')
    expect(container.querySelector<HTMLElement>('.btn-p4n')?.hidden).toBe(true)
    panel.show(poi, { config: { isLoggedIn: true } })
    expect(container.querySelector<HTMLElement>('.btn-p4n')?.hidden).toBe(false)
    expect(container.querySelector<HTMLAnchorElement>('.btn-p4n')?.href).toContain('park4night.com')
  })

  it('shows the route position line when trackInfo is given', () => {
    const container = document.createElement('div')
    const panel = new PoiDetailPanel(container)
    panel.show(poi, { trackInfo: { kmAlong: 12.4, kmToEnd: 73.6, offsetM: 180 } })
    const line = container.querySelector<HTMLElement>('.track-info')!
    expect(line.hidden).toBe(false)
    expect(line.textContent).toBe('Route: km 12,4 · noch 73,6 km · 180 m abseits')
  })

  it('hides the route position line without trackInfo (also after a previous show)', () => {
    const container = document.createElement('div')
    const panel = new PoiDetailPanel(container)
    expect(panel.show(poi)).toBeUndefined()
    expect(container.querySelector<HTMLElement>('.track-info')?.hidden).toBe(true)
    panel.show(poi, { trackInfo: { kmAlong: 1, kmToEnd: 2, offsetM: 5 } })
    panel.show(poi)
    expect(container.querySelector<HTMLElement>('.track-info')?.hidden).toBe(true)
  })

  it('marks the favourite state from the view', () => {
    const container = document.createElement('div')
    new PoiDetailPanel(container).show(poi, { isFavorite: true })
    expect(container.querySelector('.btn-favorite')?.getAttribute('aria-pressed')).toBe('true')
  })

  it('nearby hint no longer promises a route', () => {
    const container = document.createElement('div')
    const panel = new PoiDetailPanel(container)
    panel.show(poi)
    panel.updateNearby([{ kind: 'bakery', name: 'Bäcker', distance: 300, lat: 48.2, lon: 11.3 }])
    expect(container.querySelector('[data-section="nearby"]')?.innerHTML).not.toMatch(/Route/)
  })

  it('hides on Escape key when panel is open', () => {
    const container = document.createElement('div')
    const panel = new PoiDetailPanel(container)
    panel.show(poi)
    expect(container.querySelector('.poi-detail-panel')?.classList.contains('hidden')).toBe(false)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(container.querySelector('.poi-detail-panel')?.classList.contains('hidden')).toBe(true)
  })

  it('does not hide on Escape when panel is already closed', () => {
    const container = document.createElement('div')
    const panel = new PoiDetailPanel(container)
    const cb = vi.fn()
    panel.onClose(cb)
    // panel never shown — ESC should be a no-op
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(cb).not.toHaveBeenCalled()
  })

  it('fires onClose listener when Escape is pressed', () => {
    const container = document.createElement('div')
    const panel = new PoiDetailPanel(container)
    const cb = vi.fn()
    panel.onClose(cb)
    panel.show(poi)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(cb).toHaveBeenCalledOnce()
  })

  it('does not close panel when lightbox is open', () => {
    const container = document.createElement('div')
    const panel = new PoiDetailPanel(container)
    panel.show(poi)

    // Simulate an open lightbox
    const lb = document.createElement('div')
    lb.id = 'poi-lightbox'
    document.body.appendChild(lb) // no 'hidden' class → lightbox is open

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(container.querySelector('.poi-detail-panel')?.classList.contains('hidden')).toBe(false)

    document.body.removeChild(lb)
  })

  it('renders tag rows into the table', () => {
    const container = document.createElement('div')
    new PoiDetailPanel(container).show(poi)
    const rows = container.querySelectorAll('.poi-tags tr')
    const text = [...rows].map(r => r.textContent?.replace(/\s+/g, ' ').trim())
    expect(text).toContain('Typ Campingplatz')
    expect(text.some(t => t?.startsWith('Gebühr'))).toBe(true)
  })

  it('renders a website tag as a safe anchor', () => {
    const container = document.createElement('div')
    new PoiDetailPanel(container).show(poi)
    const a = container.querySelector<HTMLAnchorElement>('.poi-tags a')
    expect(a?.getAttribute('href')).toBe('https://example.com')
    expect(a?.textContent).toContain('Öffnen')
    expect(a?.target).toBe('_blank')
  })

  it('neutralises a javascript: URL in a website tag', () => {
    const container = document.createElement('div')
    new PoiDetailPanel(container).show({ ...poi, tags: { ...poi.tags, website: 'javascript:alert(1)' } })
    expect(container.querySelector<HTMLAnchorElement>('.poi-tags a')?.getAttribute('href')).toBe('#')
  })

  it('prefills the personal note textarea', () => {
    const container = document.createElement('div')
    new PoiDetailPanel(container).show(poi, { noteText: 'Tor links' })
    expect(container.querySelector<HTMLTextAreaElement>('.mynote-input')?.value).toBe('Tor links')
  })

  it('renders nearby items as clickable rows and fires onNearbySelect', () => {
    const container = document.createElement('div')
    const panel = new PoiDetailPanel(container)
    const cb = vi.fn()
    panel.onNearbySelect(cb)
    panel.show(poi)
    const item = { kind: 'bakery', name: 'Bäcker', distance: 300, lat: 48.2, lon: 11.3 }
    panel.updateNearby([item])
    const row = container.querySelector<HTMLButtonElement>('.nearby-item')
    expect(row).not.toBeNull()
    row!.click()
    expect(cb).toHaveBeenCalledWith(item)
    expect(row!.classList.contains('active')).toBe(true)
  })

  it('does not render the kebab menu for OSM POIs', () => {
    const container = document.createElement('div')
    new PoiDetailPanel(container).show(poi) // id 1 → OSM POI
    expect(container.querySelector('.poi-menu-wrap')).toBeNull()
    expect(container.querySelector('.btn-favorite')).not.toBeNull() // heart stays for OSM
  })

  it('renders the kebab menu with edit/delete for custom POIs', () => {
    const container = document.createElement('div')
    const onEdit = vi.fn()
    const onDelete = vi.fn()
    new PoiDetailPanel(container).show(
      { ...poi, id: -1 },
      { config: { isCustom: true, onEdit, onDelete } },
    )
    const wrap = container.querySelector('.poi-menu-wrap')
    expect(wrap).not.toBeNull()
    expect((wrap as HTMLElement).hidden).toBe(false)
    container.querySelector<HTMLButtonElement>('.poi-menu-item')!.click() // edit
    expect(onEdit).toHaveBeenCalledOnce()
  })

  it('escapes HTML in tag values', () => {
    const container = document.createElement('div')
    const panel = new PoiDetailPanel(container)
    panel.show({ ...poi, tags: { ...poi.tags, operator: '<script>xss</script>' } })
    expect(container.innerHTML).not.toContain('<script>')
    expect(container.innerHTML).toContain('&lt;script&gt;')
  })

  describe('mobile collapse/expand', () => {
    it('collapse() adds the --collapsed modifier class', () => {
      const container = document.createElement('div')
      const panel = new PoiDetailPanel(container)
      panel.show(poi)
      panel.collapse()
      expect(container.querySelector('.poi-detail-panel')?.classList.contains('poi-detail-panel--collapsed')).toBe(true)
    })

    it('expand() removes the --collapsed modifier class', () => {
      const container = document.createElement('div')
      const panel = new PoiDetailPanel(container)
      panel.show(poi)
      panel.collapse()
      panel.expand()
      expect(container.querySelector('.poi-detail-panel')?.classList.contains('poi-detail-panel--collapsed')).toBe(false)
    })

    it('show() always clears the collapsed state', () => {
      const container = document.createElement('div')
      const panel = new PoiDetailPanel(container)
      panel.show(poi)
      panel.collapse()
      panel.show(poi)
      expect(container.querySelector('.poi-detail-panel')?.classList.contains('poi-detail-panel--collapsed')).toBe(false)
    })

    it('tapping the collapsed strip (not ✕) expands the panel', () => {
      const container = document.createElement('div')
      const panel = new PoiDetailPanel(container)
      panel.show(poi)
      panel.collapse()
      container.querySelector('.poi-detail-panel')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(container.querySelector('.poi-detail-panel')?.classList.contains('poi-detail-panel--collapsed')).toBe(false)
    })

    it('clicking the close button while collapsed hides the panel instead of expanding', () => {
      const container = document.createElement('div')
      const panel = new PoiDetailPanel(container)
      panel.show(poi)
      panel.collapse()
      container.querySelector<HTMLButtonElement>('.btn-close')?.click()
      expect(container.querySelector('.poi-detail-panel')?.classList.contains('hidden')).toBe(true)
    })

    it('collapse() is a no-op when the panel is hidden', () => {
      const container = document.createElement('div')
      const panel = new PoiDetailPanel(container)
      panel.collapse()
      expect(container.querySelector('.poi-detail-panel')?.classList.contains('poi-detail-panel--collapsed')).toBe(false)
    })
  })
})

describe('PoiDetailPanel cemetery water hint', () => {
  const cemetery: OsmPoi = { id: 2, type: 'cemetery', lat: 48, lon: 11, tags: { name: 'Friedhof Nord' } }
  const parking: OsmPoi = { id: 3, type: 'parking', lat: 48, lon: 11, tags: { name: 'P1' } }
  const make = (d: Date) => {
    const container = document.createElement('div')
    const panel = new PoiDetailPanel(container, () => d)
    return { container, panel }
  }
  const hint = (c: HTMLElement) => c.querySelector<HTMLElement>('.cemetery-hint')!
  const winterEl = (c: HTMLElement) => c.querySelector<HTMLElement>('.cemetery-hint-winter')!

  it('shows the all-year text in July without the winter sentence', () => {
    const { container, panel } = make(new Date(2026, 6, 15))
    panel.show(cemetery)
    expect(hint(container).hidden).toBe(false)
    expect(hint(container).textContent).toContain('Meist Wasserhahn vorhanden – keine geprüfte Trinkwasserqualität.')
    expect(hint(container).querySelector('svg')).not.toBeNull()
    expect(winterEl(container).hidden).toBe(true)
  })

  it('emphasises the winter sentence in January', () => {
    const { container, panel } = make(new Date(2026, 0, 15))
    panel.show(cemetery)
    expect(winterEl(container).hidden).toBe(false)
    expect(winterEl(container).textContent).toBe('Im Winter ist das Wasser oft abgestellt.')
  })

  it('is hidden for a parking POI', () => {
    const { container, panel } = make(new Date(2026, 0, 15))
    panel.show(parking)
    expect(hint(container).hidden).toBe(true)
  })

  it('is hidden again when a non-cemetery POI follows a cemetery', () => {
    const { container, panel } = make(new Date(2026, 0, 15))
    panel.show(cemetery)
    expect(hint(container).hidden).toBe(false)
    panel.show(parking)
    expect(hint(container).hidden).toBe(true)
    expect(winterEl(container).hidden).toBe(true)
  })
})

describe('nearbyIconSvg', () => {
  it('returns svg markup for every nearby kind and undefined for unknown ones', () => {
    for (const k of ['fuel', 'supermarket', 'pharmacy', 'bakery', 'water', 'dump']) {
      expect(nearbyIconSvg(k)).toMatch(/^<svg/)
    }
    expect(nearbyIconSvg('nope')).toBeUndefined()
  })
})
