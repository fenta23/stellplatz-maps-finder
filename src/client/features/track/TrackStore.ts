import {
  MAX_CORRIDOR_M, MIN_CORRIDOR_M, MAX_SAVED_TRACKS, isTrackSource,
  type SavedTrack, type Track, type TrackPoint,
} from './trackTypes.js'

export interface ITrackStore {
  /** The ACTIVE route. */
  get(): SavedTrack | null
  /** All saved routes, newest first. */
  list(): readonly SavedTrack[]
  /** Saves and activates; a route equal to a saved one is re-activated instead of duplicated. */
  set(track: Track): SavedTrack
  activate(id: string): void
  /** Of the active route. */
  setCorridor(m: number): void
  /** Deactivates the active route — it stays saved. */
  clear(): void
  /** Deletes from the library (deactivating first if it was active). */
  remove(id: string): void
  /** Fires on every change, including list-only ones. */
  onChange(listener: (active: SavedTrack | null) => void): () => void
}

const clampCorridor = (m: number) => Math.min(MAX_CORRIDOR_M, Math.max(MIN_CORRIDOR_M, m))
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Validates the fields of one route (shared by the v1 key and v2 entries); null if broken. */
function parseTrackFields(d: unknown): Track | null {
  if (!d || typeof d !== 'object') return null
  const r = d as Record<string, unknown>
  if (typeof r.name !== 'string') return null
  if (!isTrackSource(r.source)) return null
  if (!isNum(r.lengthM) || r.lengthM < 0 || !isNum(r.corridorM)) return null
  if (!Array.isArray(r.points) || r.points.length < 2) return null
  const points: TrackPoint[] = []
  for (const p of r.points as unknown[]) {
    if (!Array.isArray(p) || p.length !== 2 || !isNum(p[0]) || !isNum(p[1])) return null
    points.push([p[0], p[1]])
  }
  return { name: r.name, source: r.source, points, lengthM: r.lengthM, corridorM: clampCorridor(r.corridorM) }
}

interface Library {
  readonly activeId: string | null
  /** Newest first. */
  readonly tracks: readonly SavedTrack[]
}

const EMPTY: Library = { activeId: null, tracks: [] }

function parseLibrary(raw: string): Library {
  try {
    const d = JSON.parse(raw) as Record<string, unknown> | null
    if (!d || typeof d !== 'object' || d.v !== 2 || !Array.isArray(d.tracks)) return EMPTY
    const tracks: SavedTrack[] = []
    const seen = new Set<string>()
    for (const e of d.tracks as unknown[]) {
      const t = parseTrackFields(e)
      const r = e as Record<string, unknown>
      if (!t || typeof r.id !== 'string' || !r.id || seen.has(r.id)) continue
      seen.add(r.id)
      tracks.push({ ...t, id: r.id, addedAt: isNum(r.addedAt) ? r.addedAt : 0 })
    }
    tracks.sort((a, b) => b.addedAt - a.addedAt) // stable: equal stamps keep stored order
    const activeId = typeof d.activeId === 'string' && seen.has(d.activeId) ? d.activeId : null
    return { activeId, tracks }
  } catch {
    return EMPTY
  }
}

function sameRoute(a: Track, b: Track): boolean {
  if (a.name !== b.name || a.source !== b.source || a.lengthM !== b.lengthM || a.points.length !== b.points.length) return false
  if (a.points === b.points) return true
  for (let i = 0; i < a.points.length; i++) {
    if (a.points[i]![0] !== b.points[i]![0] || a.points[i]![1] !== b.points[i]![1]) return false
  }
  return true
}

function defaultId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch { /* fall through */ }
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

export interface LocalTrackStoreOptions {
  readonly now?: () => number
  readonly newId?: () => string
}

export class LocalTrackStore implements ITrackStore {
  static readonly KEY = 'stellplatz:tracks'
  static readonly LEGACY_KEY = 'stellplatz:track'
  private readonly listeners: Array<(active: SavedTrack | null) => void> = []
  private readonly now: () => number
  private readonly newId: () => string
  /** Loaded lazily; the in-memory state is the truth (persisting may fail with a quota error). */
  private state: Library | null = null

  constructor(private readonly storage: Storage = localStorage, opts: LocalTrackStoreOptions = {}) {
    this.now = opts.now ?? Date.now
    this.newId = opts.newId ?? defaultId
  }

  get(): SavedTrack | null {
    const s = this.load()
    return s.tracks.find(t => t.id === s.activeId) ?? null
  }

  list(): readonly SavedTrack[] { return this.load().tracks }

  set(track: Track): SavedTrack {
    const s = this.load()
    const at = this.now()
    const existing = s.tracks.find(t => sameRoute(t, track))
    const saved: SavedTrack = existing
      ? { ...existing, addedAt: at }
      : {
        name: track.name, source: track.source, points: track.points, lengthM: track.lengthM,
        corridorM: clampCorridor(track.corridorM), id: this.newId(), addedAt: at,
      }
    const others = s.tracks.filter(t => t.id !== saved.id)
    this.commit({ activeId: saved.id, tracks: this.evict([saved, ...others], saved.id) })
    return saved
  }

  activate(id: string): void {
    const s = this.load()
    if (s.activeId === id || !s.tracks.some(t => t.id === id)) return
    this.commit({ ...s, activeId: id })
  }

  setCorridor(m: number): void {
    if (!Number.isFinite(m)) return
    const s = this.load()
    const cur = this.get()
    if (!cur) return
    const corridorM = clampCorridor(m)
    if (corridorM === cur.corridorM) return
    this.commit({ ...s, tracks: s.tracks.map(t => (t.id === cur.id ? { ...t, corridorM } : t)) })
  }

  clear(): void {
    const s = this.load()
    if (s.activeId === null) return
    this.commit({ ...s, activeId: null })
  }

  remove(id: string): void {
    const s = this.load()
    if (!s.tracks.some(t => t.id === id)) return
    this.commit({ activeId: s.activeId === id ? null : s.activeId, tracks: s.tracks.filter(t => t.id !== id) })
  }

  onChange(listener: (active: SavedTrack | null) => void): () => void {
    this.listeners.push(listener)
    return () => {
      const i = this.listeners.indexOf(listener)
      if (i !== -1) this.listeners.splice(i, 1)
    }
  }

  // ── internals ──

  /** Drops the oldest NON-active routes beyond the limit (list is newest first). */
  private evict(tracks: readonly SavedTrack[], activeId: string | null): readonly SavedTrack[] {
    const out = [...tracks]
    while (out.length > MAX_SAVED_TRACKS) {
      const i = findLastIndex(out, t => t.id !== activeId)
      if (i === -1) break
      out.splice(i, 1)
    }
    return out
  }

  private load(): Library {
    if (this.state) return this.state
    let raw: string | null = null
    try { raw = this.storage.getItem(LocalTrackStore.KEY) } catch { /* unreadable → empty */ }
    if (raw !== null) {
      this.state = parseLibrary(raw)
      return this.state
    }
    this.state = this.migrateLegacy()
    return this.state
  }

  /** v1 (`stellplatz:track`, a single route) → a library with that route active. */
  private migrateLegacy(): Library {
    let raw: string | null = null
    try { raw = this.storage.getItem(LocalTrackStore.LEGACY_KEY) } catch { return EMPTY }
    if (raw === null) return EMPTY
    let t: Track | null = null
    try {
      const d = JSON.parse(raw) as Record<string, unknown> | null
      if (d && typeof d === 'object' && d.v === 1) t = parseTrackFields(d)
    } catch { /* invalid → ignored */ }
    if (!t) return EMPTY
    const id = this.newId()
    const lib: Library = { activeId: id, tracks: [{ ...t, id, addedAt: this.now() }] }
    if (this.write(lib)) {
      try { this.storage.removeItem(LocalTrackStore.LEGACY_KEY) } catch { /* ignore */ }
    }
    return lib
  }

  private write(lib: Library): boolean {
    try {
      this.storage.setItem(LocalTrackStore.KEY, JSON.stringify({ v: 2, activeId: lib.activeId, tracks: lib.tracks }))
      return true
    } catch {
      return false
    }
  }

  /** Applies + persists; on a quota error drops the oldest inactive routes one by one, else stays in memory. */
  private commit(next: Library): void {
    let lib = next
    // The route that was active a moment ago (clear/activate) is protected too: closing it must not lose it.
    const protectedId = this.state?.activeId ?? null
    while (!this.write(lib)) {
      const i = findLastIndex(lib.tracks, t => t.id !== lib.activeId && t.id !== protectedId)
      if (i === -1) break // only the active route left: keep it in memory for this session
      lib = { ...lib, tracks: lib.tracks.filter((_, j) => j !== i) }
    }
    this.state = lib
    const active = this.get()
    for (const l of [...this.listeners]) l(active)
  }
}

function findLastIndex<T>(arr: readonly T[], pred: (v: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i]!)) return i
  return -1
}
