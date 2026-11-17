// One error type for every way a track import can fail, so the dialog can show
// a specific German message and always point to the GPX upload as the way out.

export type TrackImportErrorKind =
  | 'invalid-file'
  | 'no-points'
  | 'file-too-large'
  | 'track-too-long'
  | 'komoot-link-invalid'
  | 'komoot-link-unsupported'
  | 'komoot-private'
  | 'komoot-not-found'
  | 'komoot-unreachable'
  | 'komoot-disabled'

export class TrackImportError extends Error {
  readonly kind: TrackImportErrorKind

  constructor(kind: TrackImportErrorKind, detail?: string) {
    super(detail ? `${kind}: ${detail}` : kind)
    this.name = 'TrackImportError'
    this.kind = kind
  }
}

const MESSAGES: Readonly<Record<TrackImportErrorKind, string>> = {
  'invalid-file': 'Die Datei ist keine gültige GPX-Datei.',
  'no-points': 'Die Datei enthält keine Route (mindestens zwei Punkte nötig).',
  'file-too-large': 'Die Datei ist zu groß (maximal 10 MB) – bitte in Etappen teilen.',
  'track-too-long': 'Die Route ist zu lang (maximal 1000 km) – bitte in Etappen teilen.',
  'komoot-link-invalid': 'Das ist kein Komoot-Tourlink. Beispiel: https://www.komoot.com/de-de/tour/123456789',
  'komoot-link-unsupported': 'Dieser Komoot-Link wird nicht unterstützt – bitte die Tour als GPX exportieren und hochladen.',
  'komoot-private': 'Die Tour ist nicht öffentlich – bitte als GPX exportieren und hochladen.',
  'komoot-not-found': 'Tour nicht gefunden – bitte den Link prüfen.',
  'komoot-unreachable': 'Komoot ist gerade nicht erreichbar – bitte die Tour als GPX hochladen.',
  'komoot-disabled': 'Der Komoot-Import ist derzeit abgeschaltet – bitte die Tour als GPX hochladen.',
}

/** German message for the import dialog; unknown errors get a generic text. */
export function trackImportErrorMessage(err: unknown): string {
  if (err instanceof TrackImportError) return MESSAGES[err.kind]
  return 'Die Route konnte nicht geladen werden.'
}
