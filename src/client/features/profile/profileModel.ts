import {
  filterIconSvg, isFilterActive, type FilterDef,
} from '@/features/filters/filterModel.js'
import type { IFilterStore } from '@/features/filters/FilterStore.js'

export type Profile = 'hiker' | 'cyclist' | 'camper'

export interface ProfileInfo {
  readonly id: Profile
  readonly label: string
  readonly description: string
  readonly iconId: string
}

export const PROFILES: readonly ProfileInfo[] = [
  { id: 'hiker', label: 'Wandern', iconId: 'hiking', description: 'Hütten, Wasser, Einkehr und Unterkunft entlang des Wegs' },
  { id: 'cyclist', label: 'Radfahren', iconId: 'bike', description: 'Rastplätze, Trinkwasser, Einkehr, Fahrrad-Service und E-Bike-Laden' },
  { id: 'camper', label: 'Camping', iconId: 'camper', description: 'Parkplätze, Stellplätze, Campingplätze sowie Entsorgung und Wasser' },
]

/** Filter ids (all built-in, kind 'osm') each profile needs. */
export const PROFILE_FILTERS: Readonly<Record<Profile, readonly string[]>> = {
  hiker: ['hut', 'shelter', 'drinking_water', 'cemetery', 'toilets', 'restaurant', 'cafe', 'bakery', 'supermarket', 'hotel', 'campsite', 'climbing'],
  cyclist: ['shelter', 'drinking_water', 'cemetery', 'toilets', 'restaurant', 'cafe', 'bakery', 'supermarket', 'hotel', 'campsite', 'bike_service', 'ebike_charging'],
  camper: ['parking', 'camper', 'campsite', 'dump', 'water', 'cemetery', 'supermarket', 'bakery'],
}

export function isProfile(v: unknown): v is Profile {
  return typeof v === 'string' && PROFILES.some(p => p.id === v)
}

/** Union of the filter ids of all given profiles; empty input gives an empty set. */
export function presetFor(profiles: readonly Profile[]): ReadonlySet<string> {
  const out = new Set<string>()
  for (const p of profiles) for (const id of PROFILE_FILTERS[p] ?? []) out.add(id)
  return out
}

export interface ProfilePlan {
  readonly show: readonly string[]
  readonly hide: readonly string[]
}

/**
 * What choosing these profiles would change. Only built-in OSM filters are touched;
 * user filters and the personal filter never appear. No profile → empty plan.
 */
export function planProfileChange(filters: readonly FilterDef[], profiles: readonly Profile[]): ProfilePlan {
  if (profiles.length === 0) return { show: [], hide: [] }
  const preset = presetFor(profiles)
  const builtin = filters.filter(f => f.builtin && f.kind === 'osm')
  return {
    show: builtin.filter(f => preset.has(f.id) && !isFilterActive(f)).map(f => f.id),
    hide: builtin.filter(f => !preset.has(f.id) && !f.hidden).map(f => f.id),
  }
}

/**
 * Applies a plan with one `put` (= one change notification) per affected filter:
 * shown filters become un-hidden AND enabled (visible = !hidden && enabled, as in the
 * help wizard); hidden filters only get `hidden` set, their chip state stays untouched.
 */
export function applyProfilePlan(store: Pick<IFilterStore, 'get' | 'put'>, plan: ProfilePlan): void {
  for (const id of plan.show) {
    const cur = store.get(id)
    if (!cur || isFilterActive(cur)) continue
    const { hidden: _hidden, ...rest } = cur
    store.put({ ...rest, enabled: true })
  }
  for (const id of plan.hide) {
    const cur = store.get(id)
    if (!cur || cur.hidden) continue
    store.put({ ...cur, hidden: true })
  }
}

export interface ProfileOption {
  readonly id: Profile
  readonly label: string
  readonly description: string
  readonly iconSvg: string
}

/** View-model for UIs that list the profiles (wizard, dialog). */
export function profileOptions(): readonly ProfileOption[] {
  return PROFILES.map(p => ({ id: p.id, label: p.label, description: p.description, iconSvg: filterIconSvg(p.iconId) }))
}
