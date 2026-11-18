import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SearchBox } from './SearchBox.js'
import type { PlaceSuggestion } from '@/core/PlaceField.js'

const koeln: PlaceSuggestion = { label: 'Köln, NRW, Deutschland', lat: 50.94, lon: 6.96 }
const bonn: PlaceSuggestion = { label: 'Bonn, NRW, Deutschland', lat: 50.73, lon: 7.1 }

function setup(results: readonly PlaceSuggestion[] = [koeln, bonn]) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const suggest = vi.fn(async (_q: string): Promise<readonly PlaceSuggestion[]> => results)
  const box = new SearchBox(container, { suggest })
  const q = <T extends HTMLElement>(sel: string) => container.querySelector<T>(sel)!
  const input = q<HTMLInputElement>('.sbx-input')
  const type = (v: string) => { input.value = v; input.dispatchEvent(new Event('input')) }
  const options = () => [...container.querySelectorAll<HTMLElement>('.place-option')]
  const mousedown = (el: HTMLElement) => el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  return { container, box, suggest, q, input, type, options, mousedown }
}

const settle = async (ms = 400) => { await vi.advanceTimersByTimeAsync(ms) }

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
  document.body.className = ''
})

describe('SearchBox', () => {
  it('renders the search field and starts in search mode', () => {
    const { box, input, q } = setup()
    expect(input.placeholder).toBe('Ort suchen…')
    expect(input.getAttribute('aria-label')).toBe('Ort suchen')
    expect(box.mode()).toBe('search')
    expect(q('.sbx').getAttribute('data-mode')).toBe('search')
    expect(q('.sbx-head').hidden).toBe(true)
    expect(q('.sbx-panel').hidden).toBe(true)
    expect(q('.sbx-form').hidden).toBe(false)
  })

  it('shows suggestions and reports a clicked hit', async () => {
    const { box, type, options, mousedown, input } = setup()
    const spy = vi.fn()
    box.onPlaceSelected(spy)
    type('Köln')
    await settle()
    expect(options().map(o => o.textContent)).toEqual([koeln.label, bonn.label])
    mousedown(options()[0]!)
    expect(spy).toHaveBeenCalledWith(koeln)
    expect(input.value).toBe(koeln.label)
  })

  it('leaves the field after a selection (closes the keyboard)', async () => {
    const { type, options, mousedown, input } = setup()
    input.focus()
    type('Köln')
    await settle()
    mousedown(options()[0]!)
    expect(document.activeElement).not.toBe(input)
  })

  it('submit jumps to the first hit; without hits nothing is reported', async () => {
    const a = setup()
    const spy = vi.fn()
    a.box.onPlaceSelected(spy)
    a.type('Köln')
    a.q<HTMLFormElement>('.sbx-form').dispatchEvent(new Event('submit', { cancelable: true }))
    await settle(0)
    expect(spy).toHaveBeenCalledWith(koeln)
    document.body.innerHTML = ''

    const b = setup([])
    const spy2 = vi.fn()
    b.box.onPlaceSelected(spy2)
    b.type('Nirgendwo')
    b.q<HTMLFormElement>('.sbx-form').dispatchEvent(new Event('submit', { cancelable: true }))
    await settle(0)
    expect(spy2).not.toHaveBeenCalled()
  })

  it('clear button appears with text, empties the field and hides itself', () => {
    const { type, q, input } = setup()
    const clear = q<HTMLButtonElement>('.sbx-clear')
    expect(clear.hidden).toBe(true)
    type('Kö')
    expect(clear.hidden).toBe(false)
    clear.click()
    expect(input.value).toBe('')
    expect(clear.hidden).toBe(true)
    expect(document.activeElement).toBe(input)
  })

  it('clear button stays visible after a selection', async () => {
    const { type, options, mousedown, q } = setup()
    type('Köln')
    await settle()
    mousedown(options()[0]!)
    expect(q<HTMLButtonElement>('.sbx-clear').hidden).toBe(false)
  })

  describe('AI gate', () => {
    it('adds the sparkle button only while AI is enabled', () => {
      const { box, q, container } = setup()
      expect(container.querySelector('.sbx-ai')).toBeNull()
      box.setAiEnabled(true)
      const ai = q('.sbx-ai')
      expect(ai.previousElementSibling).toBe(q('.sbx-route'))
      expect(ai.nextElementSibling).toBe(q('.sbx-input'))
      box.setAiEnabled(true)
      expect(container.querySelectorAll('.sbx-ai')).toHaveLength(1)
      box.setAiEnabled(false)
      expect(container.querySelector('.sbx-ai')).toBeNull()
    })

    it('offers the AI row only when enabled', async () => {
      const { box, type, options } = setup()
      type('Köln')
      await settle()
      expect(options().some(o => o.classList.contains('place-option-action'))).toBe(false)
      box.setAiEnabled(true)
      type('Bonn')
      await settle()
      const row = options().find(o => o.classList.contains('place-option-action'))
      expect(row?.textContent).toContain('Mit KI suchen: „Bonn“')
    })

    it('AI row and sparkle button report the query', async () => {
      const { box, type, options, mousedown, q } = setup()
      box.setAiEnabled(true)
      const spy = vi.fn()
      box.onAiSearch(spy)
      type(' Bonn ')
      await settle()
      mousedown(options().find(o => o.classList.contains('place-option-action'))!)
      expect(spy).toHaveBeenLastCalledWith('Bonn')
      q<HTMLButtonElement>('.sbx-ai').click()
      expect(spy).toHaveBeenCalledTimes(2)
      expect(spy).toHaveBeenLastCalledWith('Bonn')
    })
  })

  describe('route button', () => {
    it('reports null without a place and does not switch mode itself', () => {
      const { box, q } = setup()
      const spy = vi.fn()
      box.onRouteRequested(spy)
      q<HTMLButtonElement>('.sbx-route').click()
      expect(spy).toHaveBeenCalledWith(null)
      expect(box.mode()).toBe('search')
    })

    it('says "Route hierher" after a selection and reports the place', async () => {
      const { box, type, options, mousedown, q } = setup()
      const spy = vi.fn()
      box.onRouteRequested(spy)
      type('Köln')
      await settle()
      mousedown(options()[0]!)
      const btn = q<HTMLButtonElement>('.sbx-route')
      expect(q('.sbx-route-label').hidden).toBe(false)
      expect(btn.getAttribute('aria-label')).toBe('Route hierher')
      expect(btn.title).toBe('Route hierher')
      btn.click()
      expect(spy).toHaveBeenCalledWith(koeln)
    })

    it('falls back to "Route planen" after typing', async () => {
      const { box, type, options, mousedown, q } = setup()
      const spy = vi.fn()
      box.onRouteRequested(spy)
      type('Köln')
      await settle()
      mousedown(options()[0]!)
      type('Köl')
      expect(q('.sbx-route-label').hidden).toBe(true)
      expect(q('.sbx-route').getAttribute('aria-label')).toBe('Route planen')
      q<HTMLButtonElement>('.sbx-route').click()
      expect(spy).toHaveBeenCalledWith(null)
    })

    it('falls back to "Route planen" after clearing', async () => {
      const { type, options, mousedown, q } = setup()
      type('Köln')
      await settle()
      mousedown(options()[0]!)
      q<HTMLButtonElement>('.sbx-clear').click()
      expect(q('.sbx-route-label').hidden).toBe(true)
      expect(q('.sbx-route').title).toBe('Route planen')
    })
  })

  describe('modes', () => {
    it('route mode shows header, card and route slot', () => {
      const { box, q } = setup()
      const spy = vi.fn()
      box.onModeChange(spy)
      box.setMode('route')
      expect(box.mode()).toBe('route')
      expect(q('.sbx').getAttribute('data-mode')).toBe('route')
      expect(q('.sbx-form').hidden).toBe(true)
      expect(q('.sbx-head').hidden).toBe(false)
      expect(q('.sbx-title').textContent).toBe('Route planen')
      expect(q('.sbx-panel').hidden).toBe(false)
      expect(box.slot('route').hidden).toBe(false)
      expect(box.slot('ai').hidden).toBe(true)
      expect(document.body.classList.contains('searchbox-open')).toBe(true)
      expect(q('.sbx-route').getAttribute('aria-expanded')).toBe('true')
      expect(spy).toHaveBeenCalledWith('route', 'search')
    })

    it('ai mode shows the AI slot', () => {
      const { box, q } = setup()
      const spy = vi.fn()
      box.onModeChange(spy)
      box.setMode('ai')
      expect(q('.sbx-title').textContent).toBe('KI-Suche')
      expect(box.slot('ai').hidden).toBe(false)
      expect(box.slot('route').hidden).toBe(true)
      expect(q('.sbx-route').getAttribute('aria-expanded')).toBe('false')
      expect(document.body.classList.contains('searchbox-open')).toBe(true)
      expect(spy).toHaveBeenCalledWith('ai', 'search')
    })

    it('going back to search cleans up', () => {
      const { box, q } = setup()
      box.setMode('route')
      const spy = vi.fn()
      box.onModeChange(spy)
      box.setMode('search')
      expect(q('.sbx-form').hidden).toBe(false)
      expect(q('.sbx-head').hidden).toBe(true)
      expect(q('.sbx-panel').hidden).toBe(true)
      expect(box.slot('route').hidden).toBe(true)
      expect(q('.sbx-route').getAttribute('aria-expanded')).toBe('false')
      expect(document.body.classList.contains('searchbox-open')).toBe(false)
      expect(spy).toHaveBeenCalledWith('search', 'route')
    })

    it('same mode fires nothing', () => {
      const { box } = setup()
      const spy = vi.fn()
      box.onModeChange(spy)
      box.setMode('search')
      box.setMode('route')
      box.setMode('route')
      expect(spy).toHaveBeenCalledTimes(1)
    })

    it('close button returns to search', () => {
      const { box, q } = setup()
      const spy = vi.fn()
      box.setMode('ai')
      box.onModeChange(spy)
      q<HTMLButtonElement>('.sbx-close').click()
      expect(box.mode()).toBe('search')
      expect(spy).toHaveBeenCalledWith('search', 'ai')
    })

    it('closes the suggestion list when leaving search', async () => {
      const { box, type, options } = setup()
      type('Köln')
      await settle()
      expect(options().length).toBeGreaterThan(0)
      box.setMode('route')
      expect(options()).toHaveLength(0)
    })

    it('keeps text and chosen place across mode changes', async () => {
      const { box, type, options, mousedown, input } = setup()
      const spy = vi.fn()
      box.onRouteRequested(spy)
      type('Köln')
      await settle()
      mousedown(options()[0]!)
      box.setMode('route')
      box.setMode('search')
      expect(input.value).toBe(koeln.label)
      expect(document.querySelector('.sbx-route-label')!.hasAttribute('hidden')).toBe(false)
    })
  })

  describe('focus return', () => {
    it('route -> search focuses the route button', () => {
      const { box, q } = setup()
      box.setMode('route')
      const inner = document.createElement('button')
      box.slot('route').appendChild(inner)
      inner.focus()
      box.setMode('search')
      expect(document.activeElement).toBe(q('.sbx-route'))
    })

    it('ai -> search focuses the sparkle button, or the route button without it', () => {
      const a = setup()
      a.box.setAiEnabled(true)
      a.box.setMode('ai')
      const inner = document.createElement('button')
      a.box.slot('ai').appendChild(inner)
      inner.focus()
      a.box.setMode('search')
      expect(document.activeElement).toBe(a.q('.sbx-ai'))
      document.body.innerHTML = ''

      const b = setup()
      b.box.setMode('ai')
      const inner2 = document.createElement('button')
      b.box.slot('ai').appendChild(inner2)
      inner2.focus()
      b.box.setMode('search')
      expect(document.activeElement).toBe(b.q('.sbx-route'))
    })

    it('does not touch focus that is outside the box', () => {
      const { box } = setup()
      const other = document.createElement('button')
      document.body.appendChild(other)
      box.setMode('route')
      other.focus()
      box.setMode('search')
      expect(document.activeElement).toBe(other)
    })
  })

  it('slots are distinct and stable', () => {
    const { box } = setup()
    const r = box.slot('route')
    const a = box.slot('ai')
    expect(r).not.toBe(a)
    box.setMode('route')
    expect(box.slot('route')).toBe(r)
    expect(box.slot('ai')).toBe(a)
  })

  it('focusSearch only works in search mode', () => {
    const { box, input } = setup()
    box.setMode('route')
    box.focusSearch()
    expect(document.activeElement).not.toBe(input)
    box.setMode('search')
    box.focusSearch()
    expect(document.activeElement).toBe(input)
  })

  it('unsubscribe functions work', () => {
    const { box, q } = setup()
    const route = vi.fn()
    const mode = vi.fn()
    const off1 = box.onRouteRequested(route)
    const off2 = box.onModeChange(mode)
    off1(); off2()
    q<HTMLButtonElement>('.sbx-route').click()
    box.setMode('route')
    expect(route).not.toHaveBeenCalled()
    expect(mode).not.toHaveBeenCalled()
  })

  it('destroy removes the root and the body class', () => {
    const { box, container } = setup()
    box.setMode('route')
    box.destroy()
    expect(container.querySelector('.sbx')).toBeNull()
    expect(document.body.classList.contains('searchbox-open')).toBe(false)
  })
})
