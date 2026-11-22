import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AiSearchDialog, type AiSearchDialogDeps } from './AiSearchDialog.js'
import { KNOWN_FILTER_IDS, type AiChatResponse, type AiIntent } from './intentSchema.js'

const intent: AiIntent = {
  place: 'Bodensee',
  enableFilters: [KNOWN_FILTER_IDS[0]!, KNOWN_FILTER_IDS[1]!],
  adHocFilters: [],
  route: null,
}
const clarify = (reply = 'Wie meinst du das?'): AiChatResponse => ({ status: 'clarify', reply, intent: null })
const ready: AiChatResponse = { status: 'ready', reply: 'Hier ist deine Auswahl.', intent }

function setup(over: Partial<AiSearchDialogDeps> = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const send = vi.fn(async (_m: readonly unknown[]): Promise<AiChatResponse> => clarify())
  const onApply = vi.fn()
  const onClose = vi.fn()
  const dialog = new AiSearchDialog(container, { onApply, onClose, send: send as never, ...over })
  const q = <T extends HTMLElement>(sel: string) => container.querySelector<T>(sel)!
  const root = () => q('.ai-dialog')
  const input = () => q<HTMLInputElement>('[data-ref="input"]')
  const texts = () => [...container.querySelectorAll('.ai-bubble')].map(b => b.textContent)
  const ask = (text: string) => {
    input().value = text
    q<HTMLFormElement>('[data-ref="form"]').dispatchEvent(new Event('submit', { cancelable: true }))
  }
  const flush = async () => { await vi.advanceTimersByTimeAsync(0) }
  const esc = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  return { container, dialog, send, onApply, onClose, q, root, input, texts, ask, flush, esc }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = '' })

describe('AiSearchDialog', () => {
  it('is hidden until opened and has no header or close button', () => {
    const t = setup()
    expect(t.dialog.isOpen()).toBe(false)
    expect(t.root().hidden).toBe(true)
    expect(t.container.querySelector('[data-ref="close"]')).toBeNull()
  })

  it('sends the seed as the first question', async () => {
    const t = setup()
    t.dialog.open('Bodensee')
    await t.flush()
    expect(t.send).toHaveBeenCalledTimes(1)
    expect(t.send.mock.calls[0]![0]).toEqual([{ role: 'user', content: 'Bodensee' }])
    expect(t.dialog.isOpen()).toBe(true)
  })

  it('sends nothing without a seed and focuses the input', async () => {
    const t = setup()
    t.dialog.open()
    await vi.advanceTimersByTimeAsync(60)
    expect(t.send).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(t.input())
    expect(t.texts()).toHaveLength(1)
  })

  it('clarify shows the reply and keeps the input active', async () => {
    const t = setup()
    t.dialog.open('x')
    await t.flush()
    expect(t.texts().at(-1)).toBe('Wie meinst du das?')
    expect(t.input().disabled).toBe(false)
    expect(t.container.querySelector('.ai-bubble--muted')).toBeNull()
  })

  it.each(['offtopic', 'error'] as const)('%s is shown muted', async (status) => {
    const t = setup()
    t.send.mockResolvedValue({ status, reply: 'Nö.', intent: null })
    t.dialog.open('x')
    await t.flush()
    expect(t.container.querySelector('.ai-bubble--muted')?.textContent).toBe('Nö.')
    expect(t.input().disabled).toBe(false)
  })

  it('ready shows the result card and focuses "Auf Karte zeigen"', async () => {
    const t = setup()
    t.send.mockResolvedValue(ready)
    t.dialog.open('x')
    await t.flush()
    expect(t.q('.ai-result-recap').textContent).toBe('📍 Bodensee · 2 Kategorien')
    const btn = t.q<HTMLButtonElement>('.ai-result-apply')
    expect(btn.textContent).toBe('Auf Karte zeigen')
    expect(document.activeElement).toBe(btn)
  })

  it.each([
    ['full', { from: 'Konstanz', to: 'Lindau', mode: 'bike' as const }, 'Konstanz → Lindau · Rad · 1 Kategorie'],
    ['no from', { from: null, to: 'Lindau', mode: 'bike' as const }, 'Mein Standort → Lindau · Rad · 1 Kategorie'],
    ['no mode', { from: 'Konstanz', to: 'Lindau', mode: null }, 'Konstanz → Lindau · 1 Kategorie'],
  ])('route card (%s)', async (_n, route, recap) => {
    const t = setup()
    const ri: AiIntent = { place: 'Lindau', enableFilters: [KNOWN_FILTER_IDS[0]!], adHocFilters: [], route }
    t.send.mockResolvedValue({ status: 'ready', reply: 'Route.', intent: ri })
    t.dialog.open('x')
    await t.flush()
    expect(t.q('.ai-result-recap').textContent).toBe(recap)
    const btn = t.q<HTMLButtonElement>('.ai-result-apply')
    expect(btn.textContent).toBe('Route vorbereiten')
    btn.click()
    expect(t.onApply).toHaveBeenCalledWith(ri)
    expect(t.dialog.isOpen()).toBe(false)
  })

  it('limit locks the input', async () => {
    const t = setup()
    t.send.mockResolvedValue({ status: 'limit', reply: 'Limit.', intent: null })
    t.dialog.open('x')
    await t.flush()
    expect(t.input().disabled).toBe(true)
  })

  it('locks locally after maxTurns without another request', async () => {
    const t = setup({ maxTurns: 2 })
    t.dialog.open('eins')
    await t.flush()
    t.ask('zwei')
    await t.flush()
    t.ask('drei')
    await t.flush()
    expect(t.send).toHaveBeenCalledTimes(2)
    expect(t.input().disabled).toBe(true)
    expect(t.texts().at(-1)).toContain('Frage-Limit von 2')
  })

  it('ignores a second submit while busy', async () => {
    const t = setup()
    t.send.mockReturnValue(new Promise(() => {}))
    t.dialog.open('eins')
    await t.flush()
    t.ask('zwei')
    await t.flush()
    expect(t.send).toHaveBeenCalledTimes(1)
  })

  it('"Auf Karte zeigen" applies the intent and closes exactly once', async () => {
    const t = setup()
    t.send.mockResolvedValue(ready)
    t.dialog.open('x')
    await t.flush()
    t.q<HTMLButtonElement>('.ai-result-apply').click()
    expect(t.onApply).toHaveBeenCalledWith(intent)
    expect(t.onClose).toHaveBeenCalledTimes(1)
    expect(t.dialog.isOpen()).toBe(false)
  })

  it('drops a stale answer that arrives after close + reopen', async () => {
    const t = setup()
    let resolve!: (r: AiChatResponse) => void
    t.send.mockReturnValueOnce(new Promise<AiChatResponse>(r => { resolve = r }))
    t.dialog.open('alt')
    await t.flush()
    t.dialog.close()
    t.dialog.open()
    resolve(clarify('Antwort auf alt'))
    await t.flush()
    expect(t.texts()).toHaveLength(1)
    expect(t.texts()[0]).toContain('Wonach suchst du?')
    expect(t.input().disabled).toBe(false)
    t.ask('neu')
    await t.flush()
    expect(t.send.mock.calls[1]![0]).toEqual([{ role: 'user', content: 'neu' }])
  })

  it('close() on a closed dialog does not call onClose', () => {
    const t = setup()
    t.dialog.close()
    expect(t.onClose).not.toHaveBeenCalled()
  })

  it('Escape closes only when open', () => {
    const t = setup()
    t.esc()
    expect(t.onClose).not.toHaveBeenCalled()
    t.dialog.open()
    t.esc()
    expect(t.dialog.isOpen()).toBe(false)
    expect(t.onClose).toHaveBeenCalledTimes(1)
  })

  it('destroy() removes the root and detaches Escape', () => {
    const t = setup()
    t.dialog.open()
    t.dialog.destroy()
    expect(t.container.querySelector('.ai-dialog')).toBeNull()
    expect(() => t.esc()).not.toThrow()
    expect(t.onClose).not.toHaveBeenCalled()
  })
})
