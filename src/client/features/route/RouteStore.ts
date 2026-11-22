import { isTravelMode } from '@/core/travelMode.js'
import {
  MAX_CORRIDOR_M, MIN_CORRIDOR_M, MAX_SAVED_ROUTES, isRouteSource,
  type RoutePlan, type RoutePoint, type SavedRoute, type Route, type LinePoint,
} from './routeTypes.js'

export interface IRouteStore {
  /** The ACTIVE route. */
  get(): SavedRoute | null
  /** All saved routes, newest first. */
  list(): readonly SavedRoute[]
  /** Saves and activates; a route equal to a saved one is re-activated instead of duplicated. */
  set(route: Route): SavedRoute
  /**
   * Swaps the line of a saved route for an edited one: name, points, length and plan
   * change; id, age, corridor and the active state stay. Unknown id: nothing happens.
   */
  replace(id: string, route: Route): void
  activate(id: string): void
  /** Of the active route. */
  setCorridor(m: number): void
  /** Deactivates the active route — it stays saved. */
  clear(): void
  /** Deletes from the library (deactivating first if it was active). */
  remove(id: string): void
  /** Fires on every change, including list-only ones. */
  onChange(listener: (active: SavedRoute | null) => void): () => void
}

const clampCorridor = (m: number) => Math.min(MAX_CORRIDOR_M, Math.max(MIN_CORRIDOR_M, m))
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** The plan of a planned route; a broken one is dropped (the route stays, it just cannot be edited). */
function parsePlan(d: unknown): RoutePlan | null {
  if (!d || typeof d !== 'object') return null
  const r = d as Record<string, unknown>
  if (!isTravelMode(r.mode) || !Array.isArray(r.waypoints) || r.waypoints.length < 2) return null
  const waypoints: RoutePoint[] = []
  for (const w of r.waypoints as unknown[]) {
    if (!w || typeof w !== 'object') return null
    const { lat, lon, label } = w as Record<string, unknown>
    if (!isNum(lat) || !isNum(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
    if (label !== undefined && typeof label !== 'string') return null
    waypoints.push({ lat, lon, ...(label ? { label } : {}) })
  }
  return { mode: r.mode, waypoints }
}

/** Validates the fields of one route (shared by the v1 key and v2 entries); null if broken. */
function parseRouteFields(d: unknown): Route | null {
  if (!d || typeof d !== 'object') return null
  const r = d as Record<string, unknown>
  if (typeof r.name !== 'string') return null
  if (!isRouteSource(r.source)) return null
  if (!isNum(r.lengthM) || r.lengthM < 0 || !isNum(r.corridorM)) return null
  if (!Array.isArray(r.points) || r.points.length < 2) return null
  const points: LinePoint[] = []
  for (const p of r.points as unknown[]) {
    if (!Array.isArray(p) || p.length !== 2 || !isNum(p[0]) || !isNum(p[1])) return null
    points.push([p[0], p[1]])
  }
  const plan = r.source === 'planned' ? parsePlan(r.plan) : null
  return {
    name: r.name, source: r.source, points, lengthM: r.lengthM, corridorM: clampCorridor(r.corridorM),
    ...(plan ? { plan } : {}),
  }
}

interface Library {
  readonly activeId: string | null
  /** Newest first. */
  readonly routes: readonly SavedRoute[]
}

const EMPTY: Library = { activeId: null, routes: [] }

function parseLibrary(raw: string): Library {
  try {
    const d = JSON.parse(raw) as Record<string, unknown> | null
    // The persisted field keeps its old name `tracks` (stored data stays readable).
    if (!d || typeof d !== 'object' || d.v !== 2 || !Array.isArray(d.tracks)) return EMPTY
    const routes: SavedRoute[] = []
    const seen = new Set<string>()
    for (const e of d.tracks as unknown[]) {
      const t = parseRouteFields(e)
      const r = e as Record<string, unknown>
      if (!t || typeof r.id !== 'string' || !r.id || seen.has(r.id)) continue
      seen.add(r.id)
      routes.push({ ...t, id: r.id, addedAt: isNum(r.addedAt) ? r.addedAt : 0 })
    }
    routes.sort((a, b) => b.addedAt - a.addedAt) // stable: equal stamps keep stored order
    const activeId = typeof d.activeId === 'string' && seen.has(d.activeId) ? d.activeId : null
    return { activeId, routes }
  } catch {
    return EMPTY
  }
}

function sameRoute(a: Route, b: Route): boolean {
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

export interface LocalRouteStoreOptions {
  readonly now?: () => number
  readonly newId?: () => string
}

export class LocalRouteStore implements IRouteStore {
  static readonly KEY = 'stellplatz:tracks'
  static readonly LEGACY_KEY = 'stellplatz:track'
  private readonly listeners: Array<(active: SavedRoute | null) => void> = []
  private readonly now: () => number
  private readonly newId: () => string
  /** Loaded lazily; the in-memory state is the truth (persisting may fail with a quota error). */
  private state: Library | null = null

  constructor(private readonly storage: Storage = localStorage, opts: LocalRouteStoreOptions = {}) {
    this.now = opts.now ?? Date.now
    this.newId = opts.newId ?? defaultId
  }

  get(): SavedRoute | null {
    const s = this.load()
    return s.routes.find(t => t.id === s.activeId) ?? null
  }

  list(): readonly SavedRoute[] { return this.load().routes }

  set(route: Route): SavedRoute {
    const s = this.load()
    const at = this.now()
    const existing = s.routes.find(t => sameRoute(t, route))
    const saved: SavedRoute = existing
      ? { ...existing, addedAt: at, ...(route.plan ? { plan: route.plan } : {}) }
      : {
        name: route.name, source: route.source, points: route.points, lengthM: route.lengthM,
        corridorM: clampCorridor(route.corridorM), id: this.newId(), addedAt: at,
        ...(route.plan ? { plan: route.plan } : {}),
      }
    const others = s.routes.filter(t => t.id !== saved.id)
    this.commit({ activeId: saved.id, routes: this.evict([saved, ...others], saved.id) })
    return saved
  }

  replace(id: string, route: Route): void {
    const s = this.load()
    const old = s.routes.find(t => t.id === id)
    if (!old) return
    const next: SavedRoute = {
      name: route.name, source: route.source, points: route.points, lengthM: route.lengthM,
      corridorM: old.corridorM, id: old.id, addedAt: old.addedAt,
      ...(route.plan ? { plan: route.plan } : {}),
    }
    this.commit({ ...s, routes: s.routes.map(t => (t.id === id ? next : t)) })
  }

  activate(id: string): void {
    const s = this.load()
    if (s.activeId === id || !s.routes.some(t => t.id === id)) return
    this.commit({ ...s, activeId: id })
  }

  setCorridor(m: number): void {
    if (!Number.isFinite(m)) return
    const s = this.load()
    const cur = this.get()
    if (!cur) return
    const corridorM = clampCorridor(m)
    if (corridorM === cur.corridorM) return
    this.commit({ ...s, routes: s.routes.map(t => (t.id === cur.id ? { ...t, corridorM } : t)) })
  }

  clear(): void {
    const s = this.load()
    if (s.activeId === null) return
    this.commit({ ...s, activeId: null })
  }

  remove(id: string): void {
    const s = this.load()
    if (!s.routes.some(t => t.id === id)) return
    this.commit({ activeId: s.activeId === id ? null : s.activeId, routes: s.routes.filter(t => t.id !== id) })
  }

  onChange(listener: (active: SavedRoute | null) => void): () => void {
    this.listeners.push(listener)
    return () => {
      const i = this.listeners.indexOf(listener)
      if (i !== -1) this.listeners.splice(i, 1)
    }
  }

  // ── internals ──

  /** Drops the oldest NON-active routes beyond the limit (list is newest first). */
  private evict(routes: readonly SavedRoute[], activeId: string | null): readonly SavedRoute[] {
    const out = [...routes]
    while (out.length > MAX_SAVED_ROUTES) {
      const i = findLastIndex(out, t => t.id !== activeId)
      if (i === -1) break
      out.splice(i, 1)
    }
    return out
  }

  private load(): Library {
    if (this.state) return this.state
    let raw: string | null = null
    try { raw = this.storage.getItem(LocalRouteStore.KEY) } catch { /* unreadable → empty */ }
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
    try { raw = this.storage.getItem(LocalRouteStore.LEGACY_KEY) } catch { return EMPTY }
    if (raw === null) return EMPTY
    let t: Route | null = null
    try {
      const d = JSON.parse(raw) as Record<string, unknown> | null
      if (d && typeof d === 'object' && d.v === 1) t = parseRouteFields(d)
    } catch { /* invalid → ignored */ }
    if (!t) return EMPTY
    const id = this.newId()
    const lib: Library = { activeId: id, routes: [{ ...t, id, addedAt: this.now() }] }
    if (this.write(lib)) {
      try { this.storage.removeItem(LocalRouteStore.LEGACY_KEY) } catch { /* ignore */ }
    }
    return lib
  }

  private write(lib: Library): boolean {
    try {
      this.storage.setItem(LocalRouteStore.KEY, JSON.stringify({ v: 2, activeId: lib.activeId, tracks: lib.routes }))
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
      const i = findLastIndex(lib.routes, t => t.id !== lib.activeId && t.id !== protectedId)
      if (i === -1) break // only the active route left: keep it in memory for this session
      lib = { ...lib, routes: lib.routes.filter((_, j) => j !== i) }
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
