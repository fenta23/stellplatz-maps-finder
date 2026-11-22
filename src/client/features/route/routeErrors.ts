// One error type for every way a route import can fail, so the dialog can show
// a specific German message and always point to the GPX upload as the way out.

export type RouteImportErrorKind =
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
  | 'route-disabled'
  | 'route-same-point'
  | 'route-busy'
  | 'route-not-found'
  | 'route-no-road'
  | 'route-too-many-vias'
  | 'route-unreachable'

export class RouteImportError extends Error {
  readonly kind: RouteImportErrorKind

  constructor(kind: RouteImportErrorKind, detail?: string) {
    super(detail ? `${kind}: ${detail}` : kind)
    this.name = 'RouteImportError'
    this.kind = kind
  }
}

const MESSAGES: Readonly<Record<RouteImportErrorKind, string>> = {
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
  'route-disabled': 'Der Routenplaner ist derzeit abgeschaltet.',
  'route-same-point': 'Start und Ziel liegen am selben Ort.',
  'route-busy': 'Die Routenberechnung ist gerade ausgelastet – bitte gleich noch einmal versuchen.',
  'route-not-found': 'Keine Route zwischen Start und Ziel gefunden – anderes Verkehrsmittel oder andere Punkte versuchen.',
  'route-no-road': 'Ein Punkt der Route liegt zu weit von einem Weg entfernt – bitte näher an einer Straße wählen.',
  'route-too-many-vias': 'Mehr als 10 Zwischenpunkte sind nicht möglich – bitte einen entfernen.',
  'route-unreachable': 'Die Routenberechnung ist gerade nicht erreichbar – bitte später erneut versuchen.',
}

/** German message for the import dialog; unknown errors get a generic text. */
export function routeImportErrorMessage(err: unknown): string {
  if (err instanceof RouteImportError) return MESSAGES[err.kind]
  return 'Die Route konnte nicht geladen werden.'
}
