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
    expect(c.textContent).toContain('Version 2.0')
    expect(c.textContent).toContain('POIs laden jetzt in Sekundenbruchteilen')
    expect(c.textContent).toContain('Hütte')
    expect(c.textContent).toContain('Filter-Auswahl')
    expect(c.textContent).toContain('Verantwortungsvoll unterwegs')
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
})
