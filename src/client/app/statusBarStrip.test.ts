import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// iOS 27 frosts the status bar over the green header unless a fixed, opaque
// element sits at the top edge (#topbar is position: relative). Regression guard.
describe('index.html status-bar strip (iOS 27 top blur)', () => {
  const html = readFileSync('index.html', 'utf8')
  const rule = (selector: string): string => {
    const m = html.match(new RegExp(`${selector.replace(/[.#]/g, '\\$&')}\\s*\\{([^}]*)\\}`))
    if (!m) throw new Error(`no rule for ${selector}`)
    return m[1]!
  }

  it('is the first element of <body>, hidden from assistive tech', () => {
    expect(html).toMatch(/<body>\s*<div id="statusbar-strip" aria-hidden="true"><\/div>/)
  })

  it('is fixed at the top edge, as tall as the safe area, opaque in the header colour', () => {
    const css = rule('#statusbar-strip')
    expect(css).toMatch(/position:\s*fixed/)
    expect(css).toMatch(/top:\s*0/)
    expect(css).toMatch(/height:\s*env\(safe-area-inset-top\)/)
    expect(css).toMatch(/background:\s*var\(--accent-strong\)/)
    expect(css).toMatch(/pointer-events:\s*none/)
  })

  it('goes away with the folded header, so the map runs up to the edge', () => {
    expect(rule('body.ui-collapsed #statusbar-strip')).toMatch(/display:\s*none/)
  })
})
