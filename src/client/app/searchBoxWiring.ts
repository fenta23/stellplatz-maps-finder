import type { OsmPoi } from '@/features/pois/OverpassClient.js'
import { SearchBox } from '@/features/search/SearchBox.js'
import { AiSearchDialog, type AiSearchDialogDeps } from '@/features/ai/AiSearchDialog.js'
import type { AiIntent } from '@/features/ai/intentSchema.js'
import type { PlanRole } from '@/features/route-planner/plannerModel.js'
import { createRoutePlannerWiring, type RoutePlannerWiringDeps } from './routePlannerWiring.js'
import { createPlaceSuggest } from './placeSuggest.js'

const SEARCH_SUGGESTION_LIMIT = 6

export interface SearchBoxWiringDeps {
  /** Host of the search box (`#search-bar`). */
  readonly container: HTMLElement
  /** Everything the route planner needs; its slot, close hook and import link come from here. */
  readonly planner: Omit<RoutePlannerWiringDeps, 'container' | 'onClose' | 'openImport'>
  /** Jump to a place picked in the search line. */
  readonly centerOn: (lat: number, lon: number) => void
  readonly applyAiIntent: (intent: AiIntent) => void | Promise<void>
  readonly sendAiChat?: AiSearchDialogDeps['send']
  /** Bring the header back (mobile folds it away while the map is moved). */
  readonly expandUi: () => void
  /** Link in the route form: import a route / saved routes. */
  readonly openImport: () => void
}

export interface SearchBoxWiring {
  /** Menu entry, import dialog: show the route form. */
  openRoute(): void
  /** POI detail "Als Start" / "Als Ziel". */
  planFromPoi(poi: OsmPoi, role: PlanRole): void
  /** Marker tapped while the planner is picking: true = taken as the point (caller must NOT select the POI). */
  offerPoi(poi: OsmPoi): boolean
  /** Back to the plain search line. */
  close(): void
  /** The box shows the route form or the AI dialog. */
  isExpanded(): boolean
  focusSearch(): void
  /** AI is for signed-in users only; signing out closes a running AI dialog. */
  setAiEnabled(enabled: boolean): void
}

/**
 * The search box and what lives in it: place search in the line, the route
 * planner and the AI dialog in its slots. The box's mode is the single source
 * of truth for which of the two is open.
 */
export function createSearchBoxWiring(deps: SearchBoxWiringDeps): SearchBoxWiring {
  const box = new SearchBox(deps.container, {
    suggest: createPlaceSuggest({
      geocode: deps.planner.geocode,
      getViewbox: deps.planner.getViewbox,
      limit: SEARCH_SUGGESTION_LIMIT,
    }),
  })

  // Planner and dialog can close on their own (Esc, route computed, intent applied).
  // Only then does the box follow — when the box itself changed mode, it is already elsewhere.
  const planner = createRoutePlannerWiring({
    ...deps.planner,
    container: box.slot('route'),
    onClose: () => { if (box.mode() === 'route') box.setMode('search') },
    openImport: () => { planner.close(); deps.openImport() },
  })
  const dialog = new AiSearchDialog(box.slot('ai'), {
    onApply: intent => {
      // A route wish only prefills the planner: the first geocoder hit can be the
      // wrong place, so the user checks the fields and computes the route.
      if (intent.route) {
        box.setMode('route')
        void planner.planFromNames(intent.route).then(() => {
          if (box.mode() === 'route') planner.focus()
        })
      }
      return deps.applyAiIntent(intent)
    },
    onClose: () => { if (box.mode() === 'ai') box.setMode('search') },
    ...(deps.sendAiChat ? { send: deps.sendAiChat } : {}),
  })

  box.onModeChange(mode => {
    if (mode !== 'route') planner.close()
    if (mode !== 'ai') dialog.close()
    if (mode !== 'search') deps.expandUi()
  })

  box.onPlaceSelected(place => deps.centerOn(place.lat, place.lon))

  box.onRouteRequested(place => {
    box.setMode('route')
    if (place) planner.planToPlace(place)
    else planner.open()
    planner.focus()
  })

  box.onAiSearch(query => {
    box.setMode('ai')
    dialog.open(query)
  })

  return {
    openRoute() {
      box.setMode('route')
      planner.open()
    },
    planFromPoi(poi, role) {
      box.setMode('route')
      planner.planFromPoi(poi, role)
    },
    offerPoi: poi => planner.offerPoi(poi),
    close: () => box.setMode('search'),
    isExpanded: () => box.mode() !== 'search',
    focusSearch: () => box.focusSearch(),
    setAiEnabled(enabled) {
      box.setAiEnabled(enabled)
      if (!enabled && box.mode() === 'ai') box.setMode('search')
    },
  }
}
