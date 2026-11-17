// Pure status-text helpers for POI loading — testable without DOM.

export function overpassErrorMessage(err: unknown): string {
  const msg = (err as Error)?.message ?? ''
  if (msg.includes('429')) {
    return 'Overpass API überlastet – bitte 30 Sekunden warten und erneut zoomen'
  }
  if (msg.includes('503') || msg.includes('fetch')) {
    return 'Overpass API nicht erreichbar – Server vorübergehend down'
  }
  return 'Fehler beim Laden der Daten'
}

export function poiCountMessage(count: number): string {
  return count > 0 ? `${count} Orte gefunden` : 'Keine Orte in diesem Bereich'
}

export function trackPoiCountMessage(count: number): string {
  return `${count} ${count === 1 ? 'Ort' : 'Orte'} entlang der Route`
}
