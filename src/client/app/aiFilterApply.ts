import type { FilterDef } from '@/features/filters/filterModel.js'
import type { IFilterStore } from '@/features/filters/FilterStore.js'

/** What an AI search asks of the filters (structural subset of the AI intent). */
export interface AiFilterRequest {
  readonly enableFilters: readonly string[]
  readonly adHocFilters: readonly FilterDef[]
}

/** State of the OSM filters before the first AI search, for "restore". */
export interface AiFilterSnapshot {
  readonly states: readonly { readonly id: string; readonly enabled: boolean; readonly hidden: boolean }[]
  /** `ai:` filters that existed before and were removed by the AI search. */
  readonly removed: readonly FilterDef[]
}

export interface AiFilterPlan {
  /** Unhide + enable. */
  readonly enable: readonly string[]
  readonly disable: readonly string[]
  readonly remove: readonly string[]
  readonly put: readonly FilterDef[]
  readonly snapshot: AiFilterSnapshot
}

export const AI_FILTER_PREFIX = 'ai:'

/** null = the request names no filter at all (place or route only): leave the filters alone. */
export function planAiFilterApply(
  filters: readonly FilterDef[],
  req: AiFilterRequest,
  previous: AiFilterSnapshot | null,
): AiFilterPlan | null {
  const osm = filters.filter(f => f.kind === 'osm')
  const known = new Set(osm.map(f => f.id))
  const adHocIds = new Set(req.adHocFilters.map(f => f.id))
  const wanted = new Set<string>(adHocIds)
  for (const id of req.enableFilters) if (known.has(id)) wanted.add(id)
  if (wanted.size === 0) return null

  const remove = osm.filter(f => f.id.startsWith(AI_FILTER_PREFIX) && !wanted.has(f.id))
  const removeIds = new Set(remove.map(f => f.id))
  const isOn = (f: FilterDef): boolean => f.enabled && !f.hidden

  // Ad-hoc filters are written via `put` (enabled, visible), so they need no enable step.
  const enable = osm.filter(f => wanted.has(f.id) && !adHocIds.has(f.id) && !isOn(f)).map(f => f.id)
  const disable = osm.filter(f => !wanted.has(f.id) && !removeIds.has(f.id) && isOn(f)).map(f => f.id)

  const snapshot: AiFilterSnapshot = previous ?? {
    states: osm.map(f => ({ id: f.id, enabled: f.enabled, hidden: f.hidden === true })),
    removed: remove,
  }
  return { enable, disable, remove: [...removeIds], put: req.adHocFilters, snapshot }
}

export function applyAiFilterPlan(store: IFilterStore, plan: AiFilterPlan): void {
  for (const id of plan.remove) store.remove(id)
  for (const id of plan.disable) store.setEnabled(id, false)
  for (const id of plan.enable) {
    if (store.get(id)?.hidden) store.setHidden(id, false)
    store.setEnabled(id, true)
  }
  for (const def of plan.put) store.put(def)
}

export function restoreAiFilters(store: IFilterStore, snapshot: AiFilterSnapshot): void {
  const known = new Set(snapshot.states.map(s => s.id))
  for (const f of store.list()) {
    if (f.id.startsWith(AI_FILTER_PREFIX) && !known.has(f.id)) store.remove(f.id)
  }
  for (const def of snapshot.removed) store.put(def)
  for (const s of snapshot.states) {
    const cur = store.get(s.id)
    if (!cur) continue
    if ((cur.hidden ?? false) !== s.hidden) store.setHidden(s.id, s.hidden)
    if (cur.enabled !== s.enabled) store.setEnabled(s.id, s.enabled)
  }
}

/** Persists the pre-AI snapshot so "restore" survives a reload. */
export class AiFilterUndoStore {
  static readonly KEY = 'stellplatz:ai-filter-undo'

  constructor(private readonly storage: Storage = localStorage) {}

  get(): AiFilterSnapshot | null {
    try {
      const raw = this.storage.getItem(AiFilterUndoStore.KEY)
      if (!raw) return null
      const v = JSON.parse(raw) as Partial<AiFilterSnapshot> | null
      if (!v || !Array.isArray(v.states) || !Array.isArray(v.removed)) return null
      return v as AiFilterSnapshot
    } catch {
      return null
    }
  }

  set(snapshot: AiFilterSnapshot | null): void {
    try {
      if (snapshot) this.storage.setItem(AiFilterUndoStore.KEY, JSON.stringify(snapshot))
      else this.storage.removeItem(AiFilterUndoStore.KEY)
    } catch { /* ignore quota / blocked storage */ }
  }
}
