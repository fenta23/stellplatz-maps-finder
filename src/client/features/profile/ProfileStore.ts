import { PROFILES, isProfile, type Profile } from './profileModel.js'

export interface IProfileStore {
  get(): readonly Profile[]
  set(profiles: readonly Profile[]): void
  onChange(listener: (p: readonly Profile[]) => void): () => void
}

/** De-duplicated, unknown values dropped, ordered as in PROFILES. */
function normalize(input: readonly unknown[]): Profile[] {
  const set = new Set(input.filter(isProfile))
  return PROFILES.map(p => p.id).filter(id => set.has(id))
}

export class LocalProfileStore implements IProfileStore {
  static readonly KEY = 'stellplatz:profiles'
  private readonly listeners: Array<(p: readonly Profile[]) => void> = []

  get(): readonly Profile[] {
    try {
      const raw = localStorage.getItem(LocalProfileStore.KEY)
      if (!raw) return []
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed) ? normalize(parsed) : []
    } catch {
      return []
    }
  }

  set(profiles: readonly Profile[]): void {
    const clean = normalize(profiles)
    try { localStorage.setItem(LocalProfileStore.KEY, JSON.stringify(clean)) } catch { /* quota */ }
    for (const l of [...this.listeners]) l(clean)
  }

  onChange(listener: (p: readonly Profile[]) => void): () => void {
    this.listeners.push(listener)
    return () => {
      const i = this.listeners.indexOf(listener)
      if (i !== -1) this.listeners.splice(i, 1)
    }
  }
}
