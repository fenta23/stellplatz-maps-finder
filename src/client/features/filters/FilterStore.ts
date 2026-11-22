import {
  DEFAULT_FILTERS, BUILTIN_FILTER_IDS, FILTER_ICONS, FORMER_DEFAULT_NAMES, isValidSelector,
  type FilterDef,
} from './filterModel.js'

export interface IFilterStore {
  /** Effective filter list, sorted by order (defaults merged with overrides + user filters). */
  list(): readonly FilterDef[]
  get(id: string): FilterDef | undefined
  /** All OSM-kind filters (used to build the Overpass query + classify). */
  osmFilters(): readonly FilterDef[]
  /** Signature of the OSM fetch set — changes only when selectors are added/edited/removed. */
  osmSignature(): string
  /** Add or update a filter. Built-in selectors/kind are preserved (tags locked). */
  put(def: FilterDef): void
  /** Delete a user filter, or reset a built-in to its default. */
  remove(id: string): void
  setEnabled(id: string, enabled: boolean): void
  setHidden(id: string, hidden: boolean): void
  isBuiltin(id: string): boolean
  onChange(cb: () => void): () => void
}

const mutableOf = (d: FilterDef) => ({
  name: d.name, iconId: d.iconId, color: d.color, enabled: d.enabled, hidden: d.hidden, order: d.order,
})

function isValidUserFilter(d: FilterDef): boolean {
  return (
    typeof d.id === 'string' && d.id.length > 0 &&
    typeof d.name === 'string' && d.name.trim().length > 0 &&
    typeof d.color === 'string' &&
    FILTER_ICONS.some(i => i.id === d.iconId) &&
    Array.isArray(d.selectors) && d.selectors.length > 0 && d.selectors.every(isValidSelector)
  )
}

/** A built-in's stored name, unless it is empty or a former default (then the current default). */
function storedBuiltinName(stored: string | undefined, base: FilterDef): string {
  const name = stored?.trim()
  if (!name || FORMER_DEFAULT_NAMES[base.id]?.includes(name)) return base.name
  return name
}

/** Normalise an incoming def: built-ins keep their default selectors/kind (tags locked). */
function normalize(def: FilterDef): FilterDef | null {
  if (BUILTIN_FILTER_IDS.has(def.id)) {
    const base = DEFAULT_FILTERS.find(d => d.id === def.id)!
    return {
      ...base,
      name: storedBuiltinName(def.name, base),
      iconId: FILTER_ICONS.some(i => i.id === def.iconId) ? def.iconId : base.iconId,
      color: def.color || base.color,
      enabled: def.enabled,
      hidden: def.hidden === true ? true : undefined,
      order: typeof def.order === 'number' ? def.order : base.order,
    }
  }
  if (!isValidUserFilter(def)) return null
  return {
    id: def.id, name: def.name.trim(), iconId: def.iconId, color: def.color,
    enabled: def.enabled, hidden: def.hidden === true ? true : undefined,
    kind: 'osm', builtin: false,
    order: typeof def.order === 'number' ? def.order : 100,
    selectors: def.selectors,
  }
}

export class LocalFilterStore implements IFilterStore {
  private static readonly KEY = 'stellplatz:filter-defs'
  /** Persisted customisations: built-in overrides + user filters, keyed by id. */
  private records = new Map<string, FilterDef>()
  private readonly listeners: Array<() => void> = []

  constructor() {
    try {
      const raw = localStorage.getItem(LocalFilterStore.KEY)
      const parsed: unknown = raw ? JSON.parse(raw) : []
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          const def = normalize(entry as FilterDef)
          if (def) this.records.set(def.id, def)
        }
      }
    } catch {
      this.records = new Map()
    }
  }

  list(): readonly FilterDef[] {
    const out: FilterDef[] = []
    const seen = new Set<string>()
    for (const d of DEFAULT_FILTERS) {
      const rec = this.records.get(d.id)
      out.push(rec ? { ...d, ...mutableOf(rec) } : d)
      seen.add(d.id)
    }
    for (const [id, rec] of this.records) {
      if (!seen.has(id)) out.push(rec)
    }
    return out.sort((a, b) => a.order - b.order)
  }

  get(id: string): FilterDef | undefined {
    return this.list().find(f => f.id === id)
  }

  osmFilters(): readonly FilterDef[] {
    return this.list().filter(f => f.kind === 'osm')
  }

  osmSignature(): string {
    return JSON.stringify(this.osmFilters().map(f => [f.id, f.selectors]))
  }

  put(def: FilterDef): void {
    const norm = normalize(def)
    if (!norm) return
    this.records.set(norm.id, norm)
    this.persist()
    this.notify()
  }

  remove(id: string): void {
    if (this.records.delete(id)) {
      this.persist()
      this.notify()
    }
  }

  setEnabled(id: string, enabled: boolean): void {
    const cur = this.get(id)
    if (!cur || cur.enabled === enabled) return
    this.put({ ...cur, enabled })
  }

  setHidden(id: string, hidden: boolean): void {
    const cur = this.get(id)
    if (!cur || (cur.hidden ?? false) === hidden) return
    this.put({ ...cur, hidden: hidden || undefined })
  }

  isBuiltin(id: string): boolean {
    return BUILTIN_FILTER_IDS.has(id)
  }

  /** Adopt remote records that the local mirror hasn't customised (local wins ties). */
  applyRemote(records: Iterable<FilterDef>): void {
    let changed = false
    for (const r of records) {
      const norm = normalize(r)
      if (norm && !this.records.has(norm.id)) {
        this.records.set(norm.id, norm)
        changed = true
      }
    }
    if (changed) {
      this.persist()
      this.notify()
    }
  }

  /** Replace the entire set atomically; persists + notifies once. */
  replaceAll(records: Iterable<FilterDef>): void {
    this.records = new Map()
    for (const r of records) {
      const norm = normalize(r)
      if (norm) this.records.set(norm.id, norm)
    }
    this.persist()
    this.notify()
  }

  /** The persisted records (built-in overrides + user filters) — used for sync push. */
  records_(): readonly FilterDef[] {
    return [...this.records.values()]
  }

  onChange(cb: () => void): () => void {
    this.listeners.push(cb)
    return () => {
      const idx = this.listeners.indexOf(cb)
      if (idx !== -1) this.listeners.splice(idx, 1)
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(LocalFilterStore.KEY, JSON.stringify([...this.records.values()]))
    } catch { /* ignore quota */ }
  }

  private notify(): void {
    for (const cb of this.listeners) cb()
  }
}
