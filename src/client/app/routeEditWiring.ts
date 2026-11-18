import type { ITrackStore } from '@/features/track/TrackStore.js'
import type { TrackLayer } from '@/features/track/TrackLayer.js'
import { fetchPlannedRoute, ROUTE_PLANNING_ENABLED } from '@/features/track/osrmRoute.js'
import { insertVia, moveWaypoint, planRequest, removeVia } from '@/features/track/routeEdit.js'
import { prepareTrack } from '@/features/track/trackImport.js'
import { trackImportErrorMessage } from '@/features/track/trackErrors.js'
import { formatKm } from '@/features/track/TrackImportDialog.js'
import type { RoutePlan, SavedTrack, TrackPoint } from '@/features/track/trackTypes.js'

export interface RouteEditWiringDeps {
  readonly store: ITrackStore
  readonly layer: Pick<TrackLayer, 'setEditing'>
  readonly flash: (msg: string) => void
  readonly fetchFn?: typeof fetch | undefined
  /** Default: the route planner's kill switch — no planning, no editing. */
  readonly enabled?: boolean | undefined
}

type EditableTrack = SavedTrack & { readonly plan: RoutePlan }

const toLatLon = ([lat, lon]: TrackPoint) => ({ lat, lon })

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

  const editable = (t: SavedTrack | null): t is EditableTrack =>
    enabled && t !== null && t.source === 'planned' && t.plan !== undefined

  /**
   * Start and end handles sit on the ends of the line, not on the planned places:
   * a searched place ("Dresden") can be well off the road the route starts on.
   * Only an end the user has just dragged (pending plan) is shown where it was dropped.
   */
  function handlesOf(track: EditableTrack, plan: RoutePlan = track.plan): TrackPoint[] {
    const points = plan.waypoints.map((w): TrackPoint => [w.lat, w.lon])
    const last = plan.waypoints.length - 1
    if (plan.waypoints[0] === track.plan.waypoints[0]) points[0] = track.points[0]!
    if (plan.waypoints[last] === track.plan.waypoints[track.plan.waypoints.length - 1]) {
      points[last] = track.points[track.points.length - 1]!
    }
    return points
  }

  function show(track: EditableTrack, pending?: RoutePlan): void {
    layer.setEditing({
      waypoints: handlesOf(track, pending),
      ...(pending ? { busy: true } : {}),
      onInsert: (grab, drop) => change(t => insertVia(t.plan, t.points, toLatLon(grab), toLatLon(drop))),
      onMove: (index, to) => change(t => moveWaypoint(t.plan, index, toLatLon(to))),
      onRemove: index => change(t => removeVia(t.plan, index)),
    })
  }

  function sync(): void {
    const track = store.get()
    if (editable(track)) show(track)
    else layer.setEditing(null)
  }

  function change(edit: (track: EditableTrack) => RoutePlan): void {
    const track = store.get()
    if (running || !editable(track)) return
    const plan = edit(track)
    if (plan === track.plan) { sync(); return } // nothing to do; puts a dragged handle back
    void recalculate(track, plan)
  }

  async function recalculate(track: EditableTrack, plan: RoutePlan): Promise<void> {
    const ctrl = new AbortController()
    running = { id: track.id, ctrl }
    show(track, plan) // handles where the user put them, locked while the request runs
    try {
      const imported = await fetchPlannedRoute(planRequest(plan), deps.fetchFn, ctrl.signal, { enabled })
      if (ctrl.signal.aborted) return
      const next = prepareTrack(imported, track.corridorM)
      running = null // before `replace`: its onChange unlocks the handles
      store.replace(track.id, next)
      flash(`Route angepasst · ${formatKm(next.lengthM)}`)
    } catch (err) {
      if (ctrl.signal.aborted) return // the route was switched or closed meanwhile
      running = null
      flash(trackImportErrorMessage(err))
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
