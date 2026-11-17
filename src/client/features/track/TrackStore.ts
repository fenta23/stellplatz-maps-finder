import {
  MAX_CORRIDOR_M, MIN_CORRIDOR_M,
  type Track, type TrackPoint,
} from './trackTypes.js'

export interface ITrackStore {
  get(): Track | null
  set(track: Track): void
  setCorridor(m: number): void
  clear(): void
  onChange(listener: (track: Track | null) => void): () => void
}

const clampCorridor = (m: number) => Math.min(MAX_CORRIDOR_M, Math.max(MIN_CORRIDOR_M, m))
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function parseTrack(raw: string): Track | null {
  try {
    const d = JSON.parse(raw) as Record<string, unknown> | null
    if (!d || typeof d !== 'object' || d.v !== 1) return null
    if (typeof d.name !== 'string') return null
    if (d.source !== 'gpx' && d.source !== 'komoot') return null
    if (!isNum(d.lengthM) || d.lengthM < 0 || !isNum(d.corridorM)) return null
    if (!Array.isArray(d.points) || d.points.length < 2) return null
    const points: TrackPoint[] = []
    for (const p of d.points as unknown[]) {
      if (!Array.isArray(p) || p.length !== 2 || !isNum(p[0]) || !isNum(p[1])) return null
      points.push([p[0], p[1]])
    }
    return {
      name: d.name, source: d.source, points,
      lengthM: d.lengthM, corridorM: clampCorridor(d.corridorM),
    }
  } catch {
    return null
  }
}

export class LocalTrackStore implements ITrackStore {
  static readonly KEY = 'stellplatz:track'
  private readonly listeners: Array<(track: Track | null) => void> = []
  /** Set when persisting failed (quota): the track lives in memory for this session. */
  private memory: Track | null = null
  private memoryOnly = false
  private cachedRaw: string | null = null
  private cachedTrack: Track | null = null

  constructor(private readonly storage: Storage = localStorage) {}

  get(): Track | null {
    if (this.memoryOnly) return this.memory
    let raw: string | null
    try {
      raw = this.storage.getItem(LocalTrackStore.KEY)
    } catch {
      return null
    }
    if (raw === null) return null
    if (raw !== this.cachedRaw) {
      this.cachedRaw = raw
      this.cachedTrack = parseTrack(raw)
    }
    return this.cachedTrack
  }

  set(track: Track): void {
    const stored: Track = {
      name: track.name, source: track.source, points: track.points,
      lengthM: track.lengthM, corridorM: clampCorridor(track.corridorM),
    }
    try {
      this.storage.setItem(LocalTrackStore.KEY, JSON.stringify({ v: 1, ...stored }))
      this.memoryOnly = false
      this.memory = null
    } catch {
      // Quota exceeded: drop the stale persisted track so it can't resurface, keep this one in memory.
      try { this.storage.removeItem(LocalTrackStore.KEY) } catch { /* ignore */ }
      this.memory = stored
      this.memoryOnly = true
    }
    this.notify(this.get())
  }

  setCorridor(m: number): void {
    if (!Number.isFinite(m)) return
    const cur = this.get()
    if (!cur) return
    const corridorM = clampCorridor(m)
    if (corridorM === cur.corridorM) return
    this.set({ ...cur, corridorM })
  }

  clear(): void {
    try { this.storage.removeItem(LocalTrackStore.KEY) } catch { /* ignore */ }
    this.memory = null
    this.memoryOnly = false
    this.notify(null)
  }

  onChange(listener: (track: Track | null) => void): () => void {
    this.listeners.push(listener)
    return () => {
      const i = this.listeners.indexOf(listener)
      if (i !== -1) this.listeners.splice(i, 1)
    }
  }

  private notify(track: Track | null): void {
    for (const l of [...this.listeners]) l(track)
  }
}
