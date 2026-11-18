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
  'route-disabled',
  'route-same-point',
  'route-busy',
  'route-not-found',
  'route-no-road',
  'route-too-many-vias',
  'route-unreachable',
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

  it.each([
    ['route-disabled', 'Der Routenplaner ist derzeit abgeschaltet.'],
    ['route-same-point', 'Start und Ziel liegen am selben Ort.'],
    ['route-busy', 'Die Routenberechnung ist gerade ausgelastet – bitte gleich noch einmal versuchen.'],
    ['route-not-found', 'Keine Route zwischen Start und Ziel gefunden – anderes Verkehrsmittel oder andere Punkte versuchen.'],
    // Not "Start oder Ziel": a via point dragged onto the map can be the one off the road.
    ['route-no-road', 'Ein Punkt der Route liegt zu weit von einem Weg entfernt – bitte näher an einer Straße wählen.'],
    ['route-too-many-vias', 'Mehr als 10 Zwischenpunkte sind nicht möglich – bitte einen entfernen.'],
    ['route-unreachable', 'Die Routenberechnung ist gerade nicht erreichbar – bitte später erneut versuchen.'],
  ] as const)('uses the agreed wording for %s', (kind, text) => {
    expect(trackImportErrorMessage(new TrackImportError(kind))).toBe(text)
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
