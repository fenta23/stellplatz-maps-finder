import { fetchPois, poiKey, type LatLngBounds, type OsmPoi } from '@/features/pois/OverpassClient.js'
import { isFilterActive, type FilterDef } from '@/features/filters/filterModel.js'
import { markCovered, uncoveredBounds, withinBounds } from '@/features/pois/coverage.js'
import { tileKeysFor, type PoiTileSource, type TileLayer } from '@/features/pois/poiTiles.js'
import { overpassErrorMessage, poiCountMessage } from '@/features/pois/statusMessages.js'

const MAX_SPAN_DEG = 1.5 // refuse to query an over-wide viewport
const SLOW_HINT_MS = 8000
const PARKING_FILTER_ID = 'parking'

export interface PoiRefresherDeps {
  readonly getBounds: () => LatLngBounds | null
  readonly setMarkers: (pois: readonly OsmPoi[]) => void
  readonly setStatus: (msg: string, isError?: boolean) => void
  /** Returns all OSM filter definitions (built-in + user-created) for the fetch. */
  readonly getOsmFilters: () => readonly FilterDef[]
  /** Static tiles for the built-in filters. Absent → everything via Overpass. */
  readonly tiles?: PoiTileSource
}

/**
 * Everything about the filters that changes what has to be fetched or how tiles
 * are classified: which filters are visible, their order and selectors, and
 * whether the parking layer is wanted. Colour/name edits and toggling other
 * filters (markers are only hidden) leave it unchanged, so they don't trigger a
 * refresh that would abort an in-flight Overpass query.
 */
export function fetchSignature(filters: readonly FilterDef[]): string {
  return JSON.stringify(filters.map(f => [f.id, f.selectors, f.id === PARKING_FILTER_ID && isFilterActive(f)]))
}

/**
 * Two sources, each with its own coverage, accumulated into one store:
 *   • built-in filters → static tiles (fast). Loaded tiles are remembered per
 *     layer; the big `parking` layer only while the parking filter is active.
 *     If the tiles fail, the built-ins fall back to Overpass for the viewport.
 *   • user / AI filters → Overpass, one query per genuinely-new area (0.05°
 *     cells, see coverage.ts). The coverage resets when those filters change,
 *     so a new filter also loads in already-seen areas.
 * A refresh renders the store clipped to the viewport. The previous in-flight
 * refresh is aborted when a newer one starts.
 */
export function createPoiRefresher(deps: PoiRefresherDeps): { refresh(): Promise<void> } {
  const store = new Map<string, OsmPoi>()
  const loadedTiles: Record<TileLayer, Set<string>> = { parking: new Set(), rest: new Set() }
  const fallbackCovered = new Set<string>() // built-ins via Overpass after a tile failure
  let covered = new Set<string>() // user filters via Overpass
  let coveredSignature = ''
  let builtinSignature = ''
  let inFlight: AbortController | null = null
  let generation = 0
  let lastRenderedKeys = new Set<string>()

  function render(bounds: LatLngBounds): number {
    const pois: OsmPoi[] = []
    for (const p of store.values()) if (withinBounds(p, bounds)) pois.push(p)
    // Skip redundant re-renders (e.g. the pre-fetch paint on zoom-out shows the
    // same markers already on screen) — re-running setMarkers would churn the
    // marker-cluster layer and make POIs flicker.
    const keys = new Set(pois.map(poiKey))
    if (!sameKeys(keys, lastRenderedKeys)) {
      lastRenderedKeys = keys
      deps.setMarkers(pois)
    }
    return pois.length
  }

  const addAll = (pois: readonly OsmPoi[]) => { for (const p of pois) store.set(poiKey(p), p) }

  async function refresh(): Promise<void> {
    const bounds = deps.getBounds()
    if (!bounds) return

    if (bounds.north - bounds.south > MAX_SPAN_DEG || bounds.east - bounds.west > MAX_SPAN_DEG) {
      deps.setStatus('Bitte weiter reinzoomen…')
      return
    }

    const myGen = ++generation
    const filters = deps.getOsmFilters()
    const tiles = deps.tiles
    const builtins = tiles ? filters.filter(f => f.builtin) : []
    const custom = tiles ? filters.filter(f => !f.builtin) : filters

    // Tile records are classified at load time against the visible built-ins in
    // store order. Un-hiding or reordering one → re-read the tiles (versioned
    // URLs, so this comes from the HTTP cache) to classify them afresh.
    const builtinIds = JSON.stringify(builtins.map(f => f.id))
    if (builtinIds !== builtinSignature) {
      builtinSignature = builtinIds
      loadedTiles.parking.clear()
      loadedTiles.rest.clear()
    }

    const signature = JSON.stringify(custom.map(f => [f.id, f.selectors]))
    if (signature !== coveredSignature) {
      coveredSignature = signature
      covered = new Set()
    }

    // ── what is missing for this viewport ──
    const wanted = new Map<TileLayer, string[]>()
    let cellDeg = 0
    if (tiles && builtins.length > 0) {
      const layers: TileLayer[] = ['rest']
      if (builtins.some(f => f.id === PARKING_FILTER_ID && isFilterActive(f))) layers.push('parking')
      try {
        cellDeg = (await tiles.manifest()).cellDeg
      } catch { /* handled below: no cellDeg → fallback */ }
      if (generation !== myGen) return
      if (cellDeg > 0) {
        const keys = tileKeysFor(bounds, cellDeg)
        for (const layer of layers) {
          const missing = keys.filter(k => !loadedTiles[layer].has(k))
          if (missing.length > 0) wanted.set(layer, missing)
        }
      }
    }
    const tilesUnavailable = tiles !== undefined && builtins.length > 0 && cellDeg === 0
    const fallbackArea = tilesUnavailable ? uncoveredBounds(bounds, fallbackCovered) : null
    // Without a tile source everything goes through here, exactly as before tiles.
    const customArea = !tiles || custom.length > 0 ? uncoveredBounds(bounds, covered) : null

    // Whole viewport already loaded → paint from the store, no request.
    if (wanted.size === 0 && !fallbackArea && !customArea) {
      deps.setStatus(poiCountMessage(render(bounds)))
      setTimeout(() => { if (generation === myGen) deps.setStatus('') }, 2000)
      return
    }

    render(bounds) // show what we already have while the rest loads
    inFlight?.abort()
    const controller = new AbortController()
    inFlight = controller
    const { signal } = controller
    deps.setStatus('Suche Orte…')
    const slowTimer = setTimeout(() => {
      if (generation === myGen) deps.setStatus('Warte auf Overpass-Server – kann etwas dauern…')
    }, SLOW_HINT_MS)

    const overpassBuiltins = async (area: LatLngBounds) => {
      addAll(await fetchPois(area, builtins, signal))
      markCovered(bounds, fallbackCovered)
    }

    const tileTask = async () => {
      if (fallbackArea) return overpassBuiltins(fallbackArea)
      if (wanted.size === 0) return
      try {
        addAll(await tiles!.fetchTilePois(wanted, builtins, signal))
        for (const [layer, keys] of wanted) for (const k of keys) loadedTiles[layer].add(k)
      } catch (err) {
        if (signal.aborted) throw err
        console.warn('POI tiles failed, falling back to Overpass:', err)
        const area = uncoveredBounds(bounds, fallbackCovered)
        if (area) await overpassBuiltins(area)
      }
      // Tiles are fast — paint now instead of waiting for a slow Overpass query.
      if (generation === myGen) render(bounds)
    }

    const customTask = async () => {
      if (!customArea) return
      addAll(await fetchPois(customArea, custom, signal))
      markCovered(bounds, covered)
    }

    const results = await Promise.allSettled([tileTask(), customTask()])
    clearTimeout(slowTimer)
    if (signal.aborted || generation !== myGen) return
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    const count = render(bounds)
    if (failed) {
      console.error('POI fetch failed:', failed.reason)
      deps.setStatus(overpassErrorMessage(failed.reason), true)
      return
    }
    deps.setStatus(poiCountMessage(count))
    setTimeout(() => { if (generation === myGen) deps.setStatus('') }, 3000)
  }

  return { refresh }
}

function sameKeys(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false
  for (const k of a) if (!b.has(k)) return false
  return true
}
