import { describe, it, expect, vi, afterEach } from 'vitest'
import { WhatsNewOverlay } from './WhatsNewOverlay.js'

function stubMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduce && q.includes('reduce'), media: q }))
}
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = '' })

function make(opts: ConstructorParameters<typeof WhatsNewOverlay>[1] = {}) {
  const c = document.createElement('div')
  document.body.appendChild(c)
  const o = new WhatsNewOverlay(c, opts)
  return { c, o, root: c.querySelector('.whats-new') as HTMLElement, btn: c.querySelector('button') as HTMLButtonElement }
}

describe('WhatsNewOverlay', () => {
  it('renders title, main message and highlights', () => {
    stubMotion(false)
    const { c } = make()
    expect(c.textContent).toContain('Version 3.0')
    expect(c.textContent).toContain('Orte entlang deiner Route')
    expect(c.textContent).toContain('Komoot-Link oder GPX')
    expect(c.textContent).toContain('Zehn neue Kategorien')
    expect(c.textContent).toContain('Wandern, Radfahren und Camping')
    expect(c.textContent).toContain('Fahrradkarte')
    expect(c.textContent).toContain('Navigation übernimmt Google bzw. Apple Maps')
    expect(c.textContent).toContain('Routen planst du im Routenplaner')
    expect(c.querySelector('[role="dialog"]')?.getAttribute('aria-modal')).toBe('true')
    expect(c.querySelector('[aria-hidden="true"].whats-new-confetti')).not.toBeNull()
  })

  it('open() shows the overlay and focuses the button', () => {
    stubMotion(false)
    const { o, root, btn } = make()
    o.open()
    expect(root.classList.contains('open')).toBe(true)
    expect(document.activeElement).toBe(btn)
  })

  it.each([
    ['button', (r: HTMLElement, b: HTMLButtonElement) => b.click()],
    ['backdrop', (r: HTMLElement) => r.click()],
    ['escape', () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))],
  ])('%s closes and calls onDismiss exactly once', (_n, trigger) => {
    stubMotion(false)
    const onDismiss = vi.fn()
    const { o, root, btn } = make({ onDismiss })
    o.open()
    trigger(root, btn)
    trigger(root, btn)
    expect(root.classList.contains('open')).toBe(false)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('creates confetti pieces with CSS variables (deterministic random)', () => {
    stubMotion(false)
    const { o, c } = make({ random: () => 0.5, confettiCount: 12 })
    o.open()
    const pieces = c.querySelectorAll<HTMLElement>('.confetti-piece')
    expect(pieces).toHaveLength(12)
    for (const v of ['--x', '--dx', '--delay', '--dur', '--rot', '--color']) {
      expect(pieces[0]!.style.getPropertyValue(v)).not.toBe('')
    }
  })

  it('removes confetti after the last animationend', () => {
    stubMotion(false)
    const { o, c } = make({ random: () => 0.5, confettiCount: 3 })
    o.open()
    c.querySelectorAll('.confetti-piece').forEach(p => p.dispatchEvent(new Event('animationend')))
    expect(c.querySelectorAll('.confetti-piece')).toHaveLength(0)
  })

  it('renders no confetti with prefers-reduced-motion', () => {
    stubMotion(true)
    const { o, c } = make()
    o.open()
    expect(c.querySelectorAll('.confetti-piece')).toHaveLength(0)
  })

  it('without action there is a single "Los geht’s" button', () => {
    stubMotion(false)
    const { c } = make()
    const btns = c.querySelectorAll('button')
    expect(btns).toHaveLength(1)
    expect(btns[0]!.textContent).toBe('Los geht’s')
  })

  describe('with action', () => {
    const setup = () => {
      stubMotion(false)
      const calls: string[] = []
      const onSelect = vi.fn(() => { calls.push('select') })
      const onDismiss = vi.fn(() => { calls.push('dismiss') })
      const made = make({ onDismiss, action: { label: 'Profil wählen', onSelect } })
      made.o.open()
      return { ...made, calls, onSelect, onDismiss }
    }

    it('shows the action label as primary and "Später" as secondary', () => {
      const { c, btn } = setup()
      const btns = c.querySelectorAll('button')
      expect(btns).toHaveLength(2)
      expect(btn.textContent).toBe('Profil wählen')
      expect(btns[1]!.textContent).toBe('Später')
      expect(document.activeElement).toBe(btn)
    })

    it('primary dismisses first, then calls onSelect', () => {
      const { btn, root, calls, onSelect, onDismiss } = setup()
      btn.click()
      expect(root.classList.contains('open')).toBe(false)
      expect(calls).toEqual(['dismiss', 'select'])
      expect(onDismiss).toHaveBeenCalledTimes(1)
      expect(onSelect).toHaveBeenCalledTimes(1)
    })

    it('primary double click calls onSelect only once', () => {
      const { btn, onSelect } = setup()
      btn.click(); btn.click()
      expect(onSelect).toHaveBeenCalledTimes(1)
    })

    it.each([
      ['"Später"', (c: HTMLElement) => (c.querySelectorAll('button')[1] as HTMLButtonElement).click()],
      ['backdrop', (c: HTMLElement) => (c.querySelector('.whats-new') as HTMLElement).click()],
      ['escape', () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))],
    ])('%s only dismisses, never calls onSelect', (_n, trigger) => {
      const { c, root, onSelect, onDismiss } = setup()
      trigger(c)
      expect(root.classList.contains('open')).toBe(false)
      expect(onDismiss).toHaveBeenCalledTimes(1)
      expect(onSelect).not.toHaveBeenCalled()
    })

    it('confetti still launches', () => {
      stubMotion(false)
      const { o, c } = make({ confettiCount: 5, action: { label: 'X', onSelect: () => {} } })
      o.open()
      expect(c.querySelectorAll('.confetti-piece')).toHaveLength(5)
    })
  })
})
