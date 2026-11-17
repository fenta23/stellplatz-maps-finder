import { describe, expect, it } from 'vitest'
import { TrackImportError, trackImportErrorMessage, type TrackImportErrorKind } from './trackErrors.js'

const KINDS: readonly TrackImportErrorKind[] = [
  'invalid-file',
  'no-points',
  'file-too-large',
  'track-too-long',
  'komoot-link-invalid',
  'komoot-link-unsupported',
  'komoot-private',
  'komoot-not-found',
  'komoot-unreachable',
  'komoot-disabled',
]

describe('trackImportErrorMessage', () => {
  it.each(KINDS)('has a non-empty German text for %s', (kind) => {
    const msg = trackImportErrorMessage(new TrackImportError(kind))
    expect(msg.length).toBeGreaterThan(10)
    expect(msg).not.toBe(kind)
    expect(msg).toMatch(/[A-ZÄÖÜ][a-zäöüß]/)
  })

  it('has distinct texts per kind', () => {
    const msgs = new Set(KINDS.map((k) => trackImportErrorMessage(new TrackImportError(k))))
    expect(msgs.size).toBe(KINDS.length)
  })

  it('ignores the detail in the user message', () => {
    expect(trackImportErrorMessage(new TrackImportError('no-points', 'x'))).toBe(
      trackImportErrorMessage(new TrackImportError('no-points')),
    )
  })

  it('falls back to a generic text for other errors', () => {
    const generic = 'Die Route konnte nicht geladen werden.'
    expect(trackImportErrorMessage(new Error('boom'))).toBe(generic)
    expect(trackImportErrorMessage('boom')).toBe(generic)
    expect(trackImportErrorMessage(undefined)).toBe(generic)
  })
})

describe('TrackImportError', () => {
  it('carries kind and name', () => {
    const e = new TrackImportError('invalid-file', 'xml')
    expect(e).toBeInstanceOf(Error)
    expect(e.kind).toBe('invalid-file')
    expect(e.name).toBe('TrackImportError')
    expect(e.message).toBe('invalid-file: xml')
  })
})
