import { isTravelMode, type TravelMode } from './plannerModel.js'

/** Merkt sich das zuletzt gewählte Verkehrsmittel (nur lokal). */
export class TravelModeStore {
  static readonly KEY = 'stellplatz:route-mode'

  constructor(private readonly storage: Storage = localStorage) {}

  get(): TravelMode | null {
    try {
      const raw = this.storage.getItem(TravelModeStore.KEY)
      return isTravelMode(raw) ? raw : null
    } catch {
      return null
    }
  }

  set(mode: TravelMode): void {
    try { this.storage.setItem(TravelModeStore.KEY, mode) } catch { /* Quota / Privatmodus */ }
  }
}
