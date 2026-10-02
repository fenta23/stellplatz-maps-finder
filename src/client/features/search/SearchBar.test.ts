import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { SearchBar } from './SearchBar.js'

afterEach(() => vi.unstubAllGlobals())

function stubFetch(results: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(results),
  }))
}

describe('SearchBar', () => {
  let container: HTMLElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    container.remove()
  })

  it('renders an input field', () => {
    new SearchBar(container)
    const input = container.querySelector('input')
    expect(input).toBeTruthy()
    expect(input?.placeholder).toBe('Ort suchen…')
  })

  it('KI-Suche button is absent from DOM until setAiEnabled(true) — login gate', () => {
    const sb = new SearchBar(container)
    expect(container.querySelector('.search-ai')).toBeNull()
    sb.setAiEnabled(true)
    expect(container.querySelector('.search-ai')).toBeTruthy()
    sb.setAiEnabled(false)
    expect(container.querySelector('.search-ai')).toBeNull()
  })

  it('dropdown is hidden initially', () => {
    new SearchBar(container)
    const dropdown = container.querySelector('.search-dropdown')
    expect(dropdown?.classList.contains('hidden')).toBe(true)
  })

  it('calls fetch with query when input changes', async () => {
    stubFetch([])
    const sb = new SearchBar(container)
    const input = container.querySelector('input') as HTMLInputElement
    input.value = 'München'
    input.dispatchEvent(new Event('input'))
    await vi.waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalled()
    })
    const url = String(vi.mocked(fetch).mock.calls[0]?.[0])
    expect(url).toContain('nominatim.openstreetmap.org/search')
    expect(url).not.toContain('/api/geocode')
    expect(url).toContain('M%C3%BCnchen')
    void sb
  })

  it('shows dropdown items for search results', async () => {
    stubFetch([
      { lat: '48.1', lon: '11.5', display_name: 'München, Bayern, Deutschland' },
      { lat: '48.2', lon: '11.6', display_name: 'München Ost, Bayern' },
    ])
    const sb = new SearchBar(container)
    const input = container.querySelector('input') as HTMLInputElement
    input.value = 'München'
    input.dispatchEvent(new Event('input'))
    await vi.waitFor(() => {
      const items = container.querySelectorAll('.search-dropdown-item')
      expect(items.length).toBe(2)
    })
    void sb
  })

  it('fires onPlaceSelected when item is clicked', async () => {
    stubFetch([{ lat: '48.137', lon: '11.576', display_name: 'München' }])
    const sb = new SearchBar(container)
    const listener = vi.fn()
    sb.onPlaceSelected(listener)

    const input = container.querySelector('input') as HTMLInputElement
    input.value = 'München'
    input.dispatchEvent(new Event('input'))

    await vi.waitFor(() => {
      expect(container.querySelectorAll('.search-dropdown-item').length).toBeGreaterThan(0)
    })

    const item = container.querySelector('.search-dropdown-item') as HTMLElement
    item.dispatchEvent(new MouseEvent('mousedown'))

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ lat: 48.137, lng: 11.576 }),
    )
  })

  it('submitting the form jumps to the first result (mobile "Search" key / Enter)', async () => {
    stubFetch([
      { lat: '48.137', lon: '11.576', display_name: 'München, Bayern' },
      { lat: '48.2', lon: '11.6', display_name: 'München Ost' },
    ])
    const sb = new SearchBar(container)
    const listener = vi.fn()
    sb.onPlaceSelected(listener)

    const input = container.querySelector('input') as HTMLInputElement
    input.value = 'München'
    const form = container.querySelector('form') as HTMLFormElement
    form.dispatchEvent(new Event('submit', { cancelable: true }))

    await vi.waitFor(() => {
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ lat: 48.137, lng: 11.576 }),
      )
    })
    // dropdown collapsed after picking the best match
    expect(container.querySelector('.search-dropdown')?.classList.contains('hidden')).toBe(true)
  })

  it('submitting with no results does not fire onPlaceSelected', async () => {
    stubFetch([])
    const sb = new SearchBar(container)
    const listener = vi.fn()
    sb.onPlaceSelected(listener)
    const input = container.querySelector('input') as HTMLInputElement
    input.value = 'asdfqwer'
    const form = container.querySelector('form') as HTMLFormElement
    form.dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled())
    expect(listener).not.toHaveBeenCalled()
  })

  it('includes viewbox in request after updateBounds', async () => {
    stubFetch([])
    const sb = new SearchBar(container)
    sb.updateBounds({ south: 48.0, west: 11.0, north: 48.5, east: 11.5 })
    const input = container.querySelector('input') as HTMLInputElement
    input.value = 'Test'
    input.dispatchEvent(new Event('input'))
    await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled())
    const url = String(vi.mocked(fetch).mock.calls[0]?.[0])
    expect(url).toContain('viewbox')
  })

  it('unregisters listener when returned function is called', async () => {
    stubFetch([{ lat: '48.1', lon: '11.5', display_name: 'Test' }])
    const sb = new SearchBar(container)
    const listener = vi.fn()
    const unsubscribe = sb.onPlaceSelected(listener)
    unsubscribe()

    const input = container.querySelector('input') as HTMLInputElement
    input.value = 'Test'
    input.dispatchEvent(new Event('input'))

    await vi.waitFor(() => {
      expect(container.querySelectorAll('.search-dropdown-item').length).toBeGreaterThan(0)
    })
    const item = container.querySelector('.search-dropdown-item') as HTMLElement
    item.dispatchEvent(new MouseEvent('mousedown'))
    expect(listener).not.toHaveBeenCalled()
  })
})
