import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// iOS zooms the page when a text field with font-size < 16px gets focus and
// never zooms back out. Guards every stylesheet so new fields can't bring it back.

const cssFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return cssFiles(path)
    return path.endsWith('.css') ? [path] : []
  })

const sources = (): readonly { readonly file: string; readonly css: string }[] => {
  const html = readFileSync('index.html', 'utf8')
  const inline = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]!).join('\n')
  return [
    { file: 'index.html', css: inline },
    ...cssFiles('src/client').map((file) => ({ file, css: readFileSync(file, 'utf8') })),
  ]
}

interface Rule {
  readonly selector: string
  readonly body: string
}

// Innermost rules only (`sel { decls }` without nested braces); @media wrappers are skipped naturally.
const rules = (css: string): readonly Rule[] =>
  [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1]!.trim(),
    body: m[2]!,
  }))

const FIELD = /(^|[\s.#>+~,(_-])(input|textarea|select)(?![\w-])/i
const NON_TEXT = /type=["']?(range|checkbox|radio|file|color)|::placeholder|-webkit-search/i

/** True if the selector targets a text-entry field (element or class like `.track-input`). */
const targetsTextField = (selector: string): boolean =>
  selector
    .split(',')
    .some((part) => FIELD.test(part) && !NON_TEXT.test(part) && !/\.(fc-switch|layer-option)\b/.test(part))

/** Font size in px, assuming a 16px root. `max(16px, …)` counts as ≥ 16. */
const fontSizePx = (value: string): number | null => {
  const v = value.trim()
  if (/^max\(.*\b16px\b/.test(v)) return 16
  const m = v.match(/^(\d*\.?\d+)(px|rem|em)$/)
  if (!m) return null
  return m[2] === 'px' ? Number(m[1]) : Number(m[1]) * 16
}

describe('text fields are >= 16px (iOS focus zoom)', () => {
  it('helpers classify correctly', () => {
    expect(targetsTextField('.track-input')).toBe(true)
    expect(targetsTextField('.custom-poi-editor textarea')).toBe(true)
    expect(targetsTextField('.planner-input-wrap')).toBe(false)
    expect(targetsTextField('.sbx-input::placeholder')).toBe(false)
    expect(targetsTextField('.place-option[aria-selected="true"]')).toBe(false)
    expect(fontSizePx('0.9rem')).toBeCloseTo(14.4)
    expect(fontSizePx('16px')).toBe(16)
    expect(fontSizePx('max(16px, 1em)')).toBe(16)
  })

  it('no stylesheet sets a field font-size below 16px', () => {
    const offenders = sources().flatMap(({ file, css }) =>
      rules(css)
        .filter((r) => targetsTextField(r.selector))
        .flatMap((r) => {
          const m = r.body.match(/font-size:\s*([^;!]+)/)
          if (!m) return []
          const px = fontSizePx(m[1]!)
          return px !== null && px >= 16 ? [] : [`${file}: ${r.selector} { font-size: ${m[1]!.trim()} }`]
        }),
    )
    expect(offenders).toEqual([])
  })

  it('has a global 16px base rule for fields without their own font-size', () => {
    const shell = readFileSync('src/client/styles/shell.css', 'utf8')
    expect(shell).toMatch(/input,\s*textarea,\s*select\s*\{[^}]*font-size:\s*16px/)
  })
})
