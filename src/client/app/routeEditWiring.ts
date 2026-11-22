import type { IRouteStore } from '@/features/route/RouteStore.js'
import type { RouteLayer } from '@/features/route/RouteLayer.js'
import { fetchPlannedRoute, ROUTE_PLANNING_ENABLED } from '@/features/route/osrmRoute.js'
import { insertVia, moveWaypoint, removeVia } from '@/features/route/routeEdit.js'
import { prepareRoute } from '@/features/route/routeImport.js'
import { routeImportErrorMessage } from '@/features/route/routeErrors.js'
import { formatKm } from '@/features/route/RouteImportDialog.js'
import type { RoutePlan, SavedRoute, LinePoint } from '@/features/route/routeTypes.js'

export interface RouteEditWiringDeps {
  readonly store: IRouteStore
  readonly layer: Pick<RouteLayer, 'setEditing'>
  readonly flash: (msg: string) => void
  readonly fetchFn?: typeof fetch | undefined
  /** Default: the route planner's kill switch — no planning, no editing. */
  readonly enabled?: boolean | undefined
}

type EditableRoute = SavedRoute & { readonly plan: RoutePlan }

const toLatLon = ([lat, lon]: LinePoint) => ({ lat, lon })

/**
 * Changing a planned route on the map: the layer reports a dragged line or handle,
 * this recalculates via OSRM and replaces the SAME saved route. One request per
 * drop (the server is a public one), and nothing can be dragged while it runs.
 * Imported routes and routes planned before plans were saved stay read-only.
 */
export function createRouteEditWiring(deps: RouteEditWiringDeps): void {
  const { store, layer, flash } = deps
  const enabled = deps.enabled ?? ROUTE_PLANNING_ENABLED

  /** The running recalculation and the route it belongs to. */
  let running: { readonly id: string; readonly ctrl: AbortController } | null = null

  const editable = (t: SavedRoute | null): t is EditableRoute =>
    enabled && t !== null && t.source === 'planned' && t.plan !== undefined

  /**
   * Start and end handles sit on the ends of the line, not on the planned places:
   * a searched place ("Dresden") can be well off the road the route starts on.
   * Only an end the user has just dragged (pending plan) is shown where it was dropped.
   */
  function handlesOf(route: EditableRoute, plan: RoutePlan = route.plan): LinePoint[] {
    const points = plan.waypoints.map((w): LinePoint => [w.lat, w.lon])
    const last = plan.waypoints.length - 1
    if (plan.waypoints[0] === route.plan.waypoints[0]) points[0] = route.points[0]!
    if (plan.waypoints[last] === route.plan.waypoints[route.plan.waypoints.length - 1]) {
      points[last] = route.points[route.points.length - 1]!
    }
    return points
  }

  function show(route: EditableRoute, pending?: RoutePlan): void {
    layer.setEditing({
      waypoints: handlesOf(route, pending),
      ...(pending ? { busy: true } : {}),
      onInsert: (grab, drop) => change(t => insertVia(t.plan, t.points, toLatLon(grab), toLatLon(drop))),
      onMove: (index, to) => change(t => moveWaypoint(t.plan, index, toLatLon(to))),
      onRemove: index => change(t => removeVia(t.plan, index)),
    })
  }

  function sync(): void {
    const route = store.get()
    if (editable(route)) show(route)
    else layer.setEditing(null)
  }

  function change(edit: (route: EditableRoute) => RoutePlan): void {
    const route = store.get()
    if (running || !editable(route)) return
    const plan = edit(route)
    if (plan === route.plan) { sync(); return } // nothing to do; puts a dragged handle back
    void recalculate(route, plan)
  }

  async function recalculate(route: EditableRoute, plan: RoutePlan): Promise<void> {
    const ctrl = new AbortController()
    running = { id: route.id, ctrl }
    show(route, plan) // handles where the user put them, locked while the request runs
    try {
      const imported = await fetchPlannedRoute(plan, deps.fetchFn, ctrl.signal, { enabled })
      if (ctrl.signal.aborted) return
      const next = prepareRoute(imported, route.corridorM)
      running = null // before `replace`: its onChange unlocks the handles
      store.replace(route.id, next)
      flash(`Route angepasst · ${formatKm(next.lengthM)}`)
    } catch (err) {
      if (ctrl.signal.aborted) return // the route was switched or closed meanwhile
      running = null
      flash(routeImportErrorMessage(err))
      sync() // handles back to the unchanged route
    }
  }

  store.onChange(active => {
    if (running && active?.id !== running.id) {
      running.ctrl.abort()
      running = null
    }
    // Same route while a request runs (e.g. a corridor change): keep the locked handles.
    if (!running) sync()
  })
  sync()
}
