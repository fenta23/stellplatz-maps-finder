import { describe, it, expect } from 'vitest'
import { CEMETERY_TYPE_ID, cemeteryWaterHint, cemeteryRowHint } from './cemeteryHint.js'

// Local-time constructors (month is 0-based)
const cases: ReadonlyArray<readonly [string, Date, boolean]> = [
  ['31 Oct', new Date(2026, 9, 31, 12), false],
  ['1 Nov', new Date(2026, 10, 1, 0, 0), true],
  ['mid-winter (15 Jan)', new Date(2026, 0, 15), true],
  ['31 Mar', new Date(2026, 2, 31, 23, 59), true],
  ['1 Apr', new Date(2026, 3, 1, 0, 0), false],
  ['mid-summer (15 Jul)', new Date(2026, 6, 15), false],
  ['31 Dec', new Date(2026, 11, 31), true],
]

describe('cemetery hint', () => {
  it('exposes the type id', () => expect(CEMETERY_TYPE_ID).toBe('cemetery'))

  it.each(cases)('%s: winter=%s', (_n, date, winter) => {
    const h = cemeteryWaterHint(date)
    expect(h.text).toBe('Meist Wasserhahn vorhanden – keine geprüfte Trinkwasserqualität.')
    expect(h.winter).toBe(winter)
    expect(h.winterText).toBe(winter ? 'Im Winter ist das Wasser oft abgestellt.' : null)
    expect(cemeteryRowHint(date)).toBe(winter ? 'Wasser im Winter oft abgestellt' : undefined)
  })
})
