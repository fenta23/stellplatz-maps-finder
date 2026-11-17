import { describe, it, expect, vi, afterEach } from 'vitest'
import { TrackPanel, formatOffset, COLLAPSED_STRIP_PX, type TrackPanelRow } from './TrackPanel.js'
import { readFileSync } from 'node:fs'
import type { Track } from './trackTypes.js'

const trackCss = readFileSync('src/client/features/track/track.css', 'utf8')

const track: Track = {
  name: 'Eifelrunde', source: 'gpx',
  points: [[50, 7], [50.1, 7.1]], lengthM: 86_432, corridorM: 500,
}

const row = (i: number, over: Partial<TrackPanelRow> = {}): TrackPanelRow => ({
  key: `k${i}`, title: `Ort ${i}`, subtitle: 'Stellplatz', color: '#2e7d32',
  kmAlong: i * 1.25, offsetM: 180, ...over,
})

let panels: TrackPanel[] = []
afterEach(() => {
  panels.forEach(p => p.destroy())
  panels = []
  document.body.innerHTML = ''
  document.body.className = ''
})

function setup() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const deps = {
    onSelectRow: vi.fn(), onCorridorChange: vi.fn(), onFit: vi.fn(), onRemove: vi.fn(), onStatusClick: vi.fn(),
  }
  const panel = new TrackPanel(container, deps)
  panels.push(panel)
  const q = <T extends HTMLElement>(r: string) => container.querySelector<T>(`[data-ref="${r}"]`)!
  const rows = () => [...container.querySelectorAll<HTMLElement>('.track-row')]
  return { container, deps, panel, q, rows }
}

describe('formatOffset', () => {
  it('rounds to 10 m below 1 km, else km with decimal comma', () => {
    expect(formatOffset(183)).toBe('180 m abseits')
    expect(formatOffset(4)).toBe('0 m abseits')
    expect(formatOffset(994)).toBe('990 m abseits')
    expect(formatOffset(996)).toBe('1,0 km abseits')
    expect(formatOffset(1234)).toBe('1,2 km abseits')
  })
})

describe('TrackPanel', () => {
  it('is hidden without a track and has no body classes', () => {
    const { panel, container } = setup()
    expect(panel.isVisible()).toBe(false)
    expect(container.querySelector<HTMLElement>('.track-sheet')!.hidden).toBe(true)
    expect(document.body.classList.contains('track-open')).toBe(false)
  })

  it('shows header texts and sets track-open', () => {
    const { panel, q } = setup()
    panel.setTrack(track)
    panel.setRows([row(1), row(2)])
    expect(panel.isVisible()).toBe(true)
    expect(q('name').textContent).toBe('Eifelrunde')
    expect(q('meta').textContent).toBe('86,4 km · 2 Orte')
    expect(q('fit').textContent).toBe('Einpassen')
    expect(q('remove').textContent).toBe('Route entfernen')
    expect(document.body.classList.contains('track-open')).toBe(true)
  })

  it('uses the singular for one place', () => {
    const { panel, q } = setup()
    panel.setTrack(track)
    panel.setRows([row(1)])
    expect(q('meta').textContent).toBe('86,4 km · 1 Ort')
  })

  it('wires fit and remove buttons', () => {
    const { panel, q, deps } = setup()
    panel.setTrack(track)
    q('fit').click()
    q('remove').click()
    expect(deps.onFit).toHaveBeenCalledTimes(1)
    expect(deps.onRemove).toHaveBeenCalledTimes(1)
  })

  it('slider: limits, initial value, live label on input, callback only on change', () => {
    const { panel, q, deps } = setup()
    panel.setTrack({ ...track, corridorM: 750 })
    const slider = q<HTMLInputElement>('corridor')
    expect([slider.min, slider.max, slider.step, slider.value]).toEqual(['50', '2000', '50', '750'])
    expect(q('corridorLabel').textContent).toBe('Abstand zur Route: 750 m')
    slider.value = '1200'
    slider.dispatchEvent(new Event('input'))
    expect(q('corridorLabel').textContent).toBe('Abstand zur Route: 1200 m')
    expect(deps.onCorridorChange).not.toHaveBeenCalled()
    slider.dispatchEvent(new Event('change'))
    expect(deps.onCorridorChange).toHaveBeenCalledExactlyOnceWith(1200)
  })

  it('renders rows in the given order with formatted km and offset', () => {
    const { panel, rows } = setup()
    panel.setTrack(track)
    panel.setRows([row(10, { title: 'Zweiter', kmAlong: 12.4, offsetM: 183 }), row(1, { title: 'Erster', kmAlong: 40, offsetM: 1234 })])
    const els = rows()
    expect(els).toHaveLength(2)
    expect(els[0]!.querySelector('.track-row-title')!.textContent).toBe('Zweiter')
    expect(els[0]!.querySelector('.track-row-sub')!.textContent).toBe('Stellplatz')
    expect(els[0]!.querySelector('.track-row-km')!.textContent).toBe('km 12,4')
    expect(els[0]!.querySelector('.track-row-off')!.textContent).toBe('180 m abseits')
    expect(els[1]!.querySelector('.track-row-km')!.textContent).toBe('km 40,0')
    expect(els[1]!.querySelector('.track-row-off')!.textContent).toBe('1,2 km abseits')
  })

  it('shows the hint line only when given; icon svg replaces the dot', () => {
    const { panel, rows } = setup()
    panel.setTrack(track)
    panel.setRows([
      row(1, { hint: 'Saisonal geschlossen', iconSvg: '<svg viewBox="0 0 1 1"></svg>' }),
      row(2),
    ])
    const [a, b] = rows()
    const hintA = a!.querySelector<HTMLElement>('.track-row-hint')!
    expect(hintA.hidden).toBe(false)
    expect(hintA.textContent).toBe('Saisonal geschlossen')
    expect(b!.querySelector<HTMLElement>('.track-row-hint')!.hidden).toBe(true)
    expect(a!.querySelector('.track-row-icon svg')).not.toBeNull()
    expect(b!.querySelector('.track-row-icon svg')).toBeNull()
    expect(a!.querySelector<HTMLElement>('.track-row-icon')!.style.getPropertyValue('--track-row-color')).toBe('#2e7d32')
  })

  it('row click and keyboard activation call onSelectRow(key)', () => {
    const { panel, rows, deps } = setup()
    panel.setTrack(track)
    panel.setRows([row(1), row(2)])
    const second = rows()[1]!
    expect(second.tagName).toBe('BUTTON') // native button: Enter/Space fire click
    second.click()
    expect(deps.onSelectRow).toHaveBeenCalledWith('k2')
  })

  it('shows the empty state only without rows', () => {
    const { panel, container } = setup()
    panel.setTrack(track)
    const empty = container.querySelector<HTMLElement>('[data-empty]')!
    panel.setRows([])
    expect(empty.hidden).toBe(false)
    expect(empty.textContent).toContain('Keine Orte im Korridor')
    panel.setRows([row(1)])
    expect(empty.hidden).toBe(true)
  })

  it('status has live-region semantics, text and error class', () => {
    const { panel, q } = setup()
    panel.setTrack(track)
    const status = q('status')
    expect(status.getAttribute('role')).toBe('status')
    expect(status.getAttribute('aria-live')).toBe('polite')
    panel.setStatus('km 0–40 geladen')
    expect(status.textContent).toBe('km 0–40 geladen')
    expect(status.classList.contains('track-status-error')).toBe(false)
    panel.setStatus('Fehler – erneut versuchen', true)
    expect(status.classList.contains('track-status-error')).toBe(true)
    panel.setStatus('Lade Orte…')
    expect(status.classList.contains('track-status-error')).toBe(false)
  })

  it('collapse/expand toggles body classes, strip text and the remove button', () => {
    const { panel, q, deps } = setup()
    panel.setTrack(track)
    panel.setRows([row(1), row(2), row(3)])
    panel.collapse()
    expect(panel.isCollapsed()).toBe(true)
    expect(document.body.classList.contains('track-collapsed')).toBe(true)
    expect(q('strip').hidden).toBe(false)
    expect(q('strip').textContent).toBe('Eifelrunde · 86,4 km · 3 Orte')
    expect(q('body').hidden).toBe(true)
    expect(q('removeSmall').hidden).toBe(false)
    q('removeSmall').click()
    expect(deps.onRemove).toHaveBeenCalledTimes(1)
    panel.expand()
    expect(panel.isCollapsed()).toBe(false)
    expect(document.body.classList.contains('track-collapsed')).toBe(false)
    expect(document.body.classList.contains('track-open')).toBe(true)
    expect(q('body').hidden).toBe(false)
    expect(q('strip').hidden).toBe(true)
  })

  it('the toggle button collapses and expands', () => {
    const { panel, q } = setup()
    panel.setTrack(track)
    q('toggle').click()
    expect(panel.isCollapsed()).toBe(true)
    expect(q('toggle').getAttribute('aria-expanded')).toBe('false')
    q('toggle').click()
    expect(panel.isCollapsed()).toBe(false)
  })

  it('setTrack(null) hides and clears body classes', () => {
    const { panel } = setup()
    panel.setTrack(track)
    panel.collapse()
    panel.setTrack(null)
    expect(panel.isVisible()).toBe(false)
    expect(document.body.classList.contains('track-open')).toBe(false)
    expect(document.body.classList.contains('track-collapsed')).toBe(false)
  })

  it('destroy removes the element and body classes', () => {
    const { panel, container } = setup()
    panel.setTrack(track)
    panel.destroy()
    expect(container.querySelector('.track-sheet')).toBeNull()
    expect(document.body.classList.contains('track-open')).toBe(false)
  })

  it('renders a track name with markup as text', () => {
    const { panel, container, q } = setup()
    const evil = '<img src=x onerror="alert(1)">Tour'
    panel.setTrack({ ...track, name: evil })
    panel.collapse()
    expect(q('name').textContent).toBe(evil)
    expect(q('strip').textContent).toContain(evil)
    expect(container.querySelector('img')).toBeNull()
  })

  it('renders row titles with markup as text', () => {
    const { panel, container, rows } = setup()
    panel.setTrack(track)
    panel.setRows([row(1, { title: '<b onclick=x>fett</b>', hint: '<i>x</i>' })])
    expect(rows()[0]!.querySelector('.track-row-title')!.textContent).toBe('<b onclick=x>fett</b>')
    expect(container.querySelector('.track-row b, .track-row i')).toBeNull()
  })

  it('paginates large row sets instead of rendering all rows', () => {
    const { panel, rows, container, deps } = setup()
    panel.setTrack(track)
    panel.setRows(Array.from({ length: 5000 }, (_, i) => row(i)))
    expect(rows().length).toBeLessThan(100)
    expect(rows()[0]!.querySelector('.track-row-title')!.textContent).toBe('Ort 0')
    const next = container.querySelector<HTMLButtonElement>('[data-ref="next"]')!
    next.click()
    expect(rows()[0]!.querySelector('.track-row-title')!.textContent).not.toBe('Ort 0')
    rows()[0]!.click()
    expect(deps.onSelectRow).toHaveBeenCalledWith(expect.stringMatching(/^k\d+$/))
    expect(deps.onSelectRow).not.toHaveBeenCalledWith('k0')
  })

  it('keeps the page when rows refresh and clamps it when the list shrinks', () => {
    const { panel, rows, container } = setup()
    panel.setTrack(track)
    panel.setRows(Array.from({ length: 100 }, (_, i) => row(i)))
    container.querySelector<HTMLButtonElement>('[data-ref="next"]')!.click()
    panel.setRows(Array.from({ length: 100 }, (_, i) => row(i)))
    expect(rows()[0]!.querySelector('.track-row-title')!.textContent).toBe('Ort 25')
    panel.setRows([row(1)])
    expect(rows()).toHaveLength(1)
  })

  it('an actionable status line fires onStatusClick on click and Enter; a plain one does not', () => {
    const { panel, deps, q } = setup()
    const status = q('status')
    panel.setStatus('Fehler – erneut versuchen', true, true)
    expect(status.getAttribute('role')).toBe('button')
    status.click()
    status.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(deps.onStatusClick).toHaveBeenCalledTimes(2)
    panel.setStatus('Lade Orte…')
    expect(status.getAttribute('role')).toBe('status')
    expect(status.hasAttribute('tabindex')).toBe(false)
    status.click()
    expect(deps.onStatusClick).toHaveBeenCalledTimes(2)
  })
})

function stubViewport(desktop: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: desktop && q.includes('min-width'), media: q }))
}
const rect = (o: Partial<DOMRect>) => () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {}, ...o }) as DOMRect

describe('TrackPanel.mapInsets', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('is zero while hidden', () => {
    stubViewport(true)
    const { panel } = setup()
    expect(panel.mapInsets()).toEqual({ left: 0, bottom: 0 })
  })

  it('desktop: left is the right edge of the panel', () => {
    stubViewport(true)
    const { panel, container } = setup()
    panel.setTrack(track)
    container.querySelector<HTMLElement>('.track-sheet')!.getBoundingClientRect = rect({ right: 352 })
    expect(panel.mapInsets()).toEqual({ left: 352, bottom: 0 })
  })

  it('mobile: bottom is the measured collapsed strip, fallback constant without layout', () => {
    stubViewport(false)
    const { panel, container } = setup()
    panel.setTrack(track)
    panel.collapse()
    expect(panel.mapInsets()).toEqual({ left: 0, bottom: COLLAPSED_STRIP_PX })
    container.querySelector<HTMLElement>('.track-sheet-bar')!.getBoundingClientRect = rect({ height: 44 })
    expect(panel.mapInsets()).toEqual({ left: 0, bottom: 44 })
  })

  it('mobile: an expanded sheet still reports only the strip height', () => {
    stubViewport(false)
    const { panel, container } = setup()
    panel.setTrack(track)
    container.querySelector<HTMLElement>('.track-sheet-bar')!.getBoundingClientRect = rect({ height: 60 })
    expect(panel.mapInsets()).toEqual({ left: 0, bottom: COLLAPSED_STRIP_PX })
  })

  it('collapseOnMobile collapses on mobile only', () => {
    stubViewport(false)
    const a = setup(); a.panel.setTrack(track); a.panel.collapseOnMobile()
    expect(a.panel.isCollapsed()).toBe(true)
    stubViewport(true)
    const b = setup(); b.panel.setTrack(track); b.panel.collapseOnMobile()
    expect(b.panel.isCollapsed()).toBe(false)
  })
})

describe('TrackPanel row subtitle', () => {
  it('renders no subtitle line for an empty subtitle', () => {
    const { panel, rows } = setup()
    panel.setTrack(track)
    panel.setRows([row(1, { subtitle: '' }), row(2)])
    const subs = rows().map(r => r.querySelector<HTMLElement>('.track-row-sub')!)
    expect(subs[0]!.hidden).toBe(true)
    expect(subs[1]!.hidden).toBe(false)
    expect(subs[1]!.textContent).toBe('Stellplatz')
  })
})

describe('TrackPanel collapsed strip', () => {
  const summaryEls = (c: HTMLElement) =>
    [...c.querySelectorAll<HTMLElement>('[data-ref="heading"], [data-ref="strip"]')]

  it('shows exactly one summary when collapsed and only the header when expanded', () => {
    const { panel, container } = setup()
    panel.setTrack(track)
    expect(summaryEls(container).filter(e => !e.hidden).map(e => e.dataset.ref)).toEqual(['heading'])
    panel.collapse()
    expect(summaryEls(container).filter(e => !e.hidden).map(e => e.dataset.ref)).toEqual(['strip'])
    expect(container.querySelector<HTMLElement>('[data-ref="removeSmall"]')!.hidden).toBe(false)
    expect(container.querySelector<HTMLElement>('[data-ref="toggle"]')).not.toBeNull()
  })

  it('CSS lets the hidden attribute win over display:flex of the header', () => {
    // jsdom applies no stylesheets; `.track-sheet-heading { display:flex }` would
    // otherwise override [hidden] and show both summaries side by side.
    expect(trackCss).toMatch(/\.track-sheet-heading\[hidden\][^{]*\{[^}]*display:\s*none/)
  })
})
