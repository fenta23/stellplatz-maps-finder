import { fetchPois, poiKey, type LatLngBounds, type OsmPoi } from '@/features/pois/OverpassClient.js'
import { isFilterActive, tileLayerOf, TILE_LAYER_IDS, type FilterDef } from '@/features/filters/filterModel.js'
import { markCovered, uncoveredBounds, withinBounds } from '@/features/pois/coverage.js'
import { planTileFilters, tileKeysFor, tiledFilterIds, type PoiTileSource, type TileLayer } from '@/features/pois/poiTiles.js'
import { overpassErrorMessage, poiCountMessage } from '@/features/pois/statusMessages.js'

const MAX_SPAN_DEG = 1.5 // refuse to query an over-wide viewport
const SLOW_HINT_MS = 8000

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
 * whether a filter of an optional tile layer (parking, supply, food, …) is
 * active — those layers are only downloaded while used. Colour/name edits and
 * toggling filters of the always-loaded `rest` layer (markers are only hidden)
 * leave it unchanged, so they don't trigger a refresh that would abort an
 * in-flight Overpass query.
 */
export function fetchSignature(filters: readonly FilterDef[]): string {
  return JSON.stringify(filters.map(f => [f.id, f.selectors, tileLayerOf(f.id) !== 'rest' && isFilterActive(f)]))
}

/**
 * Two sources, each with its own coverage, accumulated into one store:
 *   • built-in filters → static tiles (fast), as far as the tile manifest lists
 *     them. Loaded tiles are remembered per layer; optional layers (parking,
 *     supply, food, …) only while one of their filters is active. If the tiles
 *     fail, the built-ins fall back to Overpass for the viewport.
 *   • user / AI filters and built-ins the tiles do not contain → Overpass, one query per genuinely-new area (0.05°
 *     cells, see coverage.ts). The coverage resets when those filters change,
 *     so a new filter also loads in already-seen areas.
 * A refresh renders the store clipped to the viewport. The previous in-flight
 * refresh is aborted when a newer one starts.
 */
export interface PoiRefresher {
  refresh(): Promise<void>
  /** Aborts an in-flight refresh and turns every later refresh() into a no-op until resume(). */
  suspend(): void
  /** Lifts the suspension; the next refresh() repaints even an unchanged viewport. Does not refresh itself. */
  resume(): void
  isSuspended(): boolean
}

export function createPoiRefresher(deps: PoiRefresherDeps): PoiRefresher {
  const store = new Map<string, OsmPoi>()
  const loadedTiles = Object.fromEntries(TILE_LAYER_IDS.map(l => [l, new Set<string>()])) as Record<TileLayer, Set<string>>
  let fallbackCovered = new Set<string>() // built-ins via Overpass after a tile failure
  let fallbackSignature = ''
  let covered = new Set<string>() // live filters (user/AI, untiled built-ins) via Overpass
  let coveredSignature = ''
  let tileSignature = ''
  let inFlight: AbortController | null = null
  let generation = 0
  // null = unknown what is on the map (initially, or after a suspension during
  // which someone else owned the markers) → the next render always paints.
  let lastRenderedKeys: Set<string> | null = new Set<string>()
  let suspended = false

  function render(bounds: LatLngBounds): number {
    const pois: OsmPoi[] = []
    for (const p of store.values()) if (withinBounds(p, bounds)) pois.push(p)
    // Skip redundant re-renders (e.g. the pre-fetch paint on zoom-out shows the
    // same markers already on screen) — re-running setMarkers would churn the
    // marker-cluster layer and make POIs flicker.
    const keys = new Set(pois.map(poiKey))
    if (!lastRenderedKeys || !sameKeys(keys, lastRenderedKeys)) {
      lastRenderedKeys = keys
      deps.setMarkers(pois)
    }
    return pois.length
  }

  const addAll = (pois: readonly OsmPoi[]) => { for (const p of pois) store.set(poiKey(p), p) }

  async function refresh(): Promise<void> {
    if (suspended) return
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

    // What the tiles contain decides which built-ins they serve → manifest first.
    let cellDeg = 0
    let tiled: ReadonlySet<string> | null = null
    if (tiles && builtins.length > 0) {
      try {
        const m = await tiles.manifest()
        if (m.cellDeg > 0) { cellDeg = m.cellDeg; tiled = tiledFilterIds(m) }
      } catch { /* handled below: no manifest → fallback */ }
      if (generation !== myGen) return
    }
    const tilesUnavailable = tiles !== undefined && builtins.length > 0 && tiled === null
    // Tiles down → all built-ins via Overpass (own coverage); `live` stays the user filters.
    const plan = tiled ? planTileFilters(filters, tiled) : null
    const tileFilters = plan ? plan.tileFilters : []
    const live = plan ? plan.liveFilters : custom
    const layers = plan ? plan.layers : []

    // Tile records are classified at load time against the tile filters in store
    // order. Un-hiding or reordering one → re-read the tiles (versioned URLs, so
    // this comes from the HTTP cache) to classify them afresh. Not touched while
    // the tiles are down, so their memory survives a transient outage.
    if (!tilesUnavailable) {
      const ids = JSON.stringify(tileFilters.map(f => f.id))
      if (ids !== tileSignature) {
        tileSignature = ids
        for (const l of TILE_LAYER_IDS) loadedTiles[l].clear()
      }
    }

    const signature = JSON.stringify(live.map(f => [f.id, f.selectors]))
    if (signature !== coveredSignature) {
      coveredSignature = signature
      covered = new Set()
    }

    // Built-ins that fall back to Overpass: everything while the tiles are down,
    // else the tile filters if their download fails below.
    const fallbackFilters = tilesUnavailable ? builtins : tileFilters
    const fbSignature = JSON.stringify(fallbackFilters.map(f => [f.id, f.selectors]))
    if (fbSignature !== fallbackSignature) {
      fallbackSignature = fbSignature
      fallbackCovered = new Set()
    }

    // ── what is missing for this viewport ──
    const wanted = new Map<TileLayer, string[]>()
    if (cellDeg > 0) {
      const keys = tileKeysFor(bounds, cellDeg)
      for (const layer of layers) {
        const missing = keys.filter(k => !loadedTiles[layer].has(k))
        if (missing.length > 0) wanted.set(layer, missing)
      }
    }
    const fallbackArea = tilesUnavailable ? uncoveredBounds(bounds, fallbackCovered) : null
    // Without a tile source everything goes through here, exactly as before tiles.
    const customArea = !tiles || live.length > 0 ? uncoveredBounds(bounds, covered) : null

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
      addAll(await fetchPois(area, fallbackFilters, signal))
      markCovered(bounds, fallbackCovered)
    }

    const tileTask = async () => {
      if (fallbackArea) return overpassBuiltins(fallbackArea)
      if (wanted.size === 0) return
      try {
        addAll(await tiles!.fetchTilePois(wanted, tileFilters, signal))
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
      addAll(await fetchPois(customArea, live, signal))
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

  return {
    refresh,
    suspend() {
      if (suspended) return
      suspended = true
      generation++ // in-flight refresh and its pending status timers become stale
      inFlight?.abort()
      inFlight = null
    },
    resume() {
      suspended = false
      lastRenderedKeys = null // the map was repainted by someone else meanwhile
    },
    isSuspended: () => suspended,
  }
}

function sameKeys(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false
  for (const k of a) if (!b.has(k)) return false
  return true
}
