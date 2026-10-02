const KEY = 'stellplatz:whats-new-seen'

export class WhatsNewStore {
  isSeen(version: string): boolean {
    try { return localStorage.getItem(KEY) === version } catch { return false }
  }

  markSeen(version: string): void {
    try { localStorage.setItem(KEY, version) } catch { /* quota */ }
  }
}

/** Bestandsnutzer (Hilfe schon gesehen), die diese Version noch nicht kennen. */
export function shouldShowWhatsNew(helpSeen: boolean, seenVersion: string | null, appVersion: string): boolean {
  return helpSeen && seenVersion !== appVersion
}
