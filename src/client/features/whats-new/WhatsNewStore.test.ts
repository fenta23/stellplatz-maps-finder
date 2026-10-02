import { describe, it, expect, beforeEach, vi } from 'vitest'
import { WhatsNewStore, shouldShowWhatsNew } from './WhatsNewStore.js'

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks() })

describe('WhatsNewStore', () => {
  it('is unseen by default and seen after markSeen', () => {
    const s = new WhatsNewStore()
    expect(s.isSeen('2.0.0')).toBe(false)
    s.markSeen('2.0.0')
    expect(s.isSeen('2.0.0')).toBe(true)
    expect(new WhatsNewStore().isSeen('2.0.0')).toBe(true)
  })

  it('treats a newer version as unseen again', () => {
    const s = new WhatsNewStore()
    s.markSeen('2.0.0')
    expect(s.isSeen('2.1.0')).toBe(false)
  })

  it('does not crash when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    const s = new WhatsNewStore()
    expect(() => s.markSeen('2.0.0')).not.toThrow()
    expect(s.isSeen('2.0.0')).toBe(false)
  })
})

describe('shouldShowWhatsNew', () => {
  it('hides for new users (help not seen)', () => {
    expect(shouldShowWhatsNew(false, null, '2.0.0')).toBe(false)
  })
  it('shows for existing users who have not seen the version', () => {
    expect(shouldShowWhatsNew(true, null, '2.0.0')).toBe(true)
    expect(shouldShowWhatsNew(true, '1.0.0', '2.0.0')).toBe(true)
  })
  it('hides when already seen', () => {
    expect(shouldShowWhatsNew(true, '2.0.0', '2.0.0')).toBe(false)
  })
})
