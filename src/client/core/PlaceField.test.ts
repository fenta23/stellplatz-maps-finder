import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PlaceField, type PlaceFieldAction, type PlaceFieldDeps, type PlaceSuggestion } from './PlaceField.js'

const koeln: PlaceSuggestion = { label: 'Köln, NRW, Deutschland', lat: 50.94, lon: 6.96 }
const bonn: PlaceSuggestion = { label: 'Bonn, NRW, Deutschland', lat: 50.73, lon: 7.1 }

function setup(over: Partial<PlaceFieldDeps> = {}) {
  const input = document.createElement('input')
  const list = document.createElement('ul')
  document.body.append(input, list)
  const deps = {
    name: 'Start',
    suggest: vi.fn(async (_q: string): Promise<readonly PlaceSuggestion[]> => [koeln, bonn]),
    onSelect: vi.fn((_s: PlaceSuggestion) => {}),
    onInvalidate: vi.fn(),
  }
  const field = new PlaceField(input, list, { ...deps, ...over })
  const type = (value: string) => {
    input.value = value
    input.dispatchEvent(new Event('input'))
  }
  const key = (k: string) => {
    const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
    input.dispatchEvent(e)
    return e
  }
  const items = () => [...list.querySelectorAll<HTMLElement>('li')]
  return { input, list, deps, field, type, key, items }
}

/** Debounce ablaufen lassen und die Promise-Kette der Antwort abarbeiten. */
const settle = async (ms = 400) => { await vi.advanceTimersByTimeAsync(ms) }

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = '' })

describe('PlaceField', () => {
  it('sets aria-label and placeholder from the name', () => {
    const { input } = setup({ name: 'Ziel' })
    expect(input.getAttribute('aria-label')).toBe('Ziel')
    expect(input.placeholder).toContain('Ziel')
  })

  it('debounces: one request after the pause, with the trimmed query', async () => {
    const { type, deps } = setup()
    type('Köl')
    await settle(200)
    type(' Köln ')
    await settle(399)
    expect(deps.suggest).not.toHaveBeenCalled()
    await settle(1)
    expect(deps.suggest).toHaveBeenCalledTimes(1)
    expect(deps.suggest).toHaveBeenCalledWith('Köln')
  })

  it('honours a custom debounce', async () => {
    const { type, deps } = setup({ debounceMs: 50 })
    type('Köln')
    await settle(50)
    expect(deps.suggest).toHaveBeenCalledTimes(1)
  })

  it('does not search below three characters (trimmed)', async () => {
    const { type, deps } = setup()
    type('  Kö ')
    await settle(1000)
    expect(deps.suggest).not.toHaveBeenCalled()
  })

  it('closes an open list when the text drops below the minimum', async () => {
    const { type, field } = setup()
    type('Köln')
    await settle()
    expect(field.isListOpen()).toBe(true)
    type('Kö')
    expect(field.isListOpen()).toBe(false)
  })

  it('renders suggestions as options', async () => {
    const { type, items, list } = setup()
    type('Köln')
    await settle()
    expect(list.hidden).toBe(false)
    expect(items().map(li => li.textContent)).toEqual([koeln.label, bonn.label])
    expect(items()[0]!.getAttribute('role')).toBe('option')
  })

  it('discards a stale response when a newer query was typed', async () => {
    let resolveFirst!: (r: readonly PlaceSuggestion[]) => void
    const suggest = vi.fn((q: string): Promise<readonly PlaceSuggestion[]> =>
      q === 'Köln' ? new Promise(r => { resolveFirst = r }) : Promise.resolve([bonn]))
    const { type, items } = setup({ suggest })
    type('Köln')
    await settle()
    type('Bonn')
    await settle()
    expect(items().map(li => li.textContent)).toEqual([bonn.label])
    resolveFirst([koeln])
    await settle(0)
    expect(items().map(li => li.textContent)).toEqual([bonn.label])
  })

  it('discards a response that arrives after the text was replaced via setText', async () => {
    let resolve!: (r: readonly PlaceSuggestion[]) => void
    const suggest = vi.fn((): Promise<readonly PlaceSuggestion[]> => new Promise(r => { resolve = r }))
    const { type, field } = setup({ suggest })
    type('Köln')
    await settle()
    field.setText('Mein Standort')
    resolve([koeln])
    await settle(0)
    expect(field.isListOpen()).toBe(false)
  })

  it('does not repeat the same query back to back', async () => {
    const { type, deps } = setup()
    type('Köln')
    await settle()
    type('Köln ')
    await settle()
    expect(deps.suggest).toHaveBeenCalledTimes(1)
  })

  it('selects via mousedown (default prevented) and fills the input', async () => {
    const { type, items, deps, input, field } = setup()
    type('Köln')
    await settle()
    const e = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    items()[1]!.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(true)
    expect(deps.onSelect).toHaveBeenCalledWith(bonn)
    expect(input.value).toBe(bonn.label)
    expect(field.isListOpen()).toBe(false)
  })

  it('calls onInvalidate on typing, not on setText', () => {
    const { type, deps, field } = setup()
    type('K')
    expect(deps.onInvalidate).toHaveBeenCalledTimes(1)
    field.setText('Mein Standort')
    expect(deps.onInvalidate).toHaveBeenCalledTimes(1)
  })

  it('shows "Keine Treffer" for an empty result', async () => {
    const { type, items, field } = setup({ suggest: async () => [] })
    type('Nirgendwo')
    await settle()
    expect(field.isListOpen()).toBe(true)
    expect(items().map(li => li.textContent)).toEqual(['Keine Treffer'])
    expect(items()[0]!.getAttribute('role')).not.toBe('option')
  })

  it('survives a throwing suggest and allows a retry of the same query', async () => {
    const suggest = vi.fn(async (_q: string): Promise<readonly PlaceSuggestion[]> => { throw new Error('offline') })
    const { type, field, items } = setup({ suggest })
    type('Köln')
    await settle()
    expect(field.isListOpen()).toBe(true)
    expect(items()).toHaveLength(1)
    field.closeList()
    type('Köln')
    await settle()
    expect(suggest).toHaveBeenCalledTimes(2)
  })

  it('closes the list on Escape and stops propagation only when it was open', async () => {
    const { type, key, field } = setup()
    const onDoc = vi.fn()
    document.addEventListener('keydown', onDoc)
    type('Köln')
    await settle()
    key('Escape')
    expect(field.isListOpen()).toBe(false)
    expect(onDoc).not.toHaveBeenCalled()
    key('Escape')
    expect(onDoc).toHaveBeenCalledTimes(1)
    document.removeEventListener('keydown', onDoc)
  })

  it('supports arrow keys and Enter', async () => {
    const { type, key, items, deps, input } = setup()
    type('Köln')
    await settle()
    key('ArrowDown')
    key('ArrowDown')
    expect(items()[1]!.getAttribute('aria-selected')).toBe('true')
    expect(input.getAttribute('aria-activedescendant')).toBe(items()[1]!.id)
    key('ArrowUp')
    expect(items()[0]!.getAttribute('aria-selected')).toBe('true')
    const e = key('Enter')
    expect(e.defaultPrevented).toBe(true)
    expect(deps.onSelect).toHaveBeenCalledWith(koeln)
  })

  it('ignores Enter without an active entry', async () => {
    const { type, key, deps } = setup()
    type('Köln')
    await settle()
    key('Enter')
    expect(deps.onSelect).not.toHaveBeenCalled()
  })

  it('closes the list shortly after blur', async () => {
    const { type, field, input } = setup()
    type('Köln')
    await settle()
    input.dispatchEvent(new Event('blur'))
    expect(field.isListOpen()).toBe(true)
    await settle(150)
    expect(field.isListOpen()).toBe(false)
  })

  it('destroy stops pending lookups and listeners', async () => {
    const { type, deps, field, input } = setup()
    type('Köln')
    field.destroy()
    await settle(1000)
    expect(deps.suggest).not.toHaveBeenCalled()
    input.value = 'Bonn'
    input.dispatchEvent(new Event('input'))
    expect(deps.onInvalidate).toHaveBeenCalledTimes(1)
  })

  it('setDisabled disables the input and closes the list', async () => {
    const { type, field, input } = setup()
    type('Köln')
    await settle()
    field.setDisabled(true)
    expect(input.disabled).toBe(true)
    expect(field.isListOpen()).toBe(false)
    field.setDisabled(false)
    expect(input.disabled).toBe(false)
  })

  it('keeps the list closed before the response when there are no actions', async () => {
    const { type, field } = setup({ suggest: () => new Promise(() => {}) })
    type('Köln')
    await settle()
    expect(field.isListOpen()).toBe(false)
  })

  describe('actions', () => {
    const run = vi.fn()
    const act: PlaceFieldAction = { id: 'ai', label: 'Mit KI suchen: Köln', iconSvg: '<svg></svg>', run }
    const withAction = (over: Partial<PlaceFieldDeps> = {}) =>
      setup({ actions: (q: string) => [{ ...act, label: `Mit KI suchen: ${q}` }], ...over })
    beforeEach(() => { run.mockClear() })

    it('places actions after the results', async () => {
      const { type, items } = withAction()
      type('Köln')
      await settle()
      expect(items().map(li => li.textContent)).toEqual([koeln.label, bonn.label, 'Mit KI suchen: Köln'])
      const a = items()[2]!
      expect(a.getAttribute('role')).toBe('option')
      expect(a.classList.contains('place-option-action')).toBe(true)
      expect(a.querySelector('svg')).not.toBeNull()
    })

    it('places actions after "Keine Treffer"', async () => {
      const { type, items } = withAction({ suggest: async () => [] })
      type('Köln')
      await settle()
      expect(items().map(li => li.textContent)).toEqual(['Keine Treffer', 'Mit KI suchen: Köln'])
      expect(items()[0]!.getAttribute('role')).toBe('presentation')
    })

    it('places actions after "Suche nicht verfügbar"', async () => {
      const { type, items } = withAction({ suggest: async () => { throw new Error('x') } })
      type('Köln')
      await settle()
      expect(items().map(li => li.textContent)).toEqual(['Suche nicht verfügbar', 'Mit KI suchen: Köln'])
    })

    it('shows only the actions while the request is pending', async () => {
      const { type, items, field } = withAction({ suggest: () => new Promise(() => {}) })
      type('Köln')
      await settle()
      expect(field.isListOpen()).toBe(true)
      expect(items().map(li => li.textContent)).toEqual(['Mit KI suchen: Köln'])
    })

    it('reaches the action with arrow keys and runs it on Enter', async () => {
      const { type, key, items, input, field, deps } = withAction()
      type('Köln')
      await settle()
      key('ArrowUp')
      const a = items()[2]!
      expect(input.getAttribute('aria-activedescendant')).toBe(a.id)
      expect(a.getAttribute('aria-selected')).toBe('true')
      key('Enter')
      expect(run).toHaveBeenCalledTimes(1)
      expect(field.isListOpen()).toBe(false)
      expect(deps.onSelect).not.toHaveBeenCalled()
      expect(deps.onInvalidate).toHaveBeenCalledTimes(1) // nur vom Tippen
      expect(input.value).toBe('Köln')
    })

    it('runs the action via mousedown (default prevented) and cancels the pending request', async () => {
      let resolve!: (r: readonly PlaceSuggestion[]) => void
      const { type, items, field, deps } = withAction({ suggest: () => new Promise(r => { resolve = r }) })
      type('Köln')
      await settle()
      const e = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
      items()[0]!.dispatchEvent(e)
      expect(e.defaultPrevented).toBe(true)
      expect(run).toHaveBeenCalledTimes(1)
      expect(field.isListOpen()).toBe(false)
      resolve([koeln])
      await settle(0)
      expect(field.isListOpen()).toBe(false)
      expect(deps.onSelect).not.toHaveBeenCalled()
    })

    it('ignores Enter without an active row even with actions', async () => {
      const { type, key } = withAction()
      type('Köln')
      await settle()
      key('Enter')
      expect(run).not.toHaveBeenCalled()
    })
  })

  describe('submit', () => {
    it('selects the first loaded result without a second request', async () => {
      const { type, field, deps } = setup()
      type('Köln')
      await settle()
      expect(await field.submit()).toBe(true)
      expect(deps.suggest).toHaveBeenCalledTimes(1)
      expect(deps.onSelect).toHaveBeenCalledWith(koeln)
      expect(field.isListOpen()).toBe(false)
    })

    it('searches immediately without debounce', async () => {
      const { type, field, deps, input } = setup()
      type('Köln')
      const ok = await field.submit()
      expect(ok).toBe(true)
      expect(deps.suggest).toHaveBeenCalledTimes(1)
      expect(input.value).toBe(koeln.label)
      await settle(1000)
      expect(deps.suggest).toHaveBeenCalledTimes(1)
    })

    it('returns false and shows "Keine Treffer" for an empty result', async () => {
      const { type, field, items, deps } = setup({ suggest: async () => [] })
      type('Nirgendwo')
      expect(await field.submit()).toBe(false)
      expect(items().map(li => li.textContent)).toEqual(['Keine Treffer'])
      expect(deps.onSelect).not.toHaveBeenCalled()
    })

    it('returns false when the response is stale after typing', async () => {
      let resolve!: (r: readonly PlaceSuggestion[]) => void
      const { type, field, deps } = setup({ suggest: () => new Promise(r => { resolve = r }) })
      type('Köln')
      const p = field.submit()
      type('Bonn')
      resolve([koeln])
      expect(await p).toBe(false)
      expect(deps.onSelect).not.toHaveBeenCalled()
    })

    it('does not search below the minimum length', async () => {
      const { type, field, deps } = setup()
      type('Kö')
      expect(await field.submit()).toBe(false)
      expect(deps.suggest).not.toHaveBeenCalled()
    })

    it('returns false when suggest throws', async () => {
      const { type, field, items, deps } = setup({ suggest: async () => { throw new Error('offline') } })
      type('Köln')
      expect(await field.submit()).toBe(false)
      expect(items().map(li => li.textContent)).toEqual(['Suche nicht verfügbar'])
      expect(deps.onSelect).not.toHaveBeenCalled()
    })
  })
})
