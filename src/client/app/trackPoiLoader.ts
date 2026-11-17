// Loads the POIs along the active track: static tiles for the built-in filters
// (loaded once for the maximum corridor), Overpass `around:` queries in chunks
// for custom/AI filters, for built-ins the tiles do not contain, and as tile
// fallback. Orchestrates the pure helpers of the track slice; knows nothing
// about the DOM or the map.

import { fetchPoisAround, poiKey, type OsmPoi } from '@/features/pois/OverpassClient.js'
import type { FilterDef } from '@/features/filters/filterModel.js'
import type { PoiTileSource, TileLayer } from '@/features/pois/poiTiles.js'
import { planTileFilters, tileKeysFor, tiledFilterIds } from '@/features/pois/poiTiles.js'
import { trackPoiCountMessage } from '@/features/pois/statusMessages.js'
import { createSegmentIndex, type SegmentIndex } from '@/features/track/trackGeometry.js'
import {
  chunkForOverpass, corridorBoxes, matchCorridor, overpassRadiusBucket, type CorridorHit,
} from '@/features/track/corridor.js'
import { MAX_CORRIDOR_M, type Track, type TrackPoint, type TrackPosition } from '@/features/track/trackTypes.js'

export const TILE_BATCH_SIZE = 12
export const MAX_OVERPASS_TRACK_M = 300_000
export const MAX_HITS = 5000
const RETRY_DELAY_MS = 2000
const CLEAR_STATUS_MS = 3000
const RADIUS_SLACK_M = 30

export const MSG_LOADING = 'Lade Orte entlang der Route…'
export const MSG_TOO_LONG = 'Eigene Filter werden entlang sehr langer Routen (über 300 km) nicht geladen.'
export const MSG_CHUNKS_FAILED = 'Einige Abschnitte konnten nicht geladen werden.'
export const MSG_TOO_MANY = 'Sehr viele Orte – Abstand verkleinern oder Kategorien ausblenden.'

export interface TrackPoiLoaderDeps {
  /** Same list the viewport refresher gets (visible OSM filters). */
  readonly getOsmFilters: () => readonly FilterDef[]
  /** Static tiles for the built-in filters. Absent → everything via Overpass. */
  readonly tiles?: PoiTileSource
  readonly fetchAround?: typeof fetchPoisAround
  readonly onUpdate: (hits: readonly CorridorHit<OsmPoi>[], done: boolean) => void
  readonly setStatus: (text: string, isError?: boolean) => void
  readonly wait?: (ms: number) => Promise<void>
}

export interface TrackPoiLoader {
  /** Start for a (new) track; aborts whatever ran before. */
  load(track: Track): Promise<void>
  /** Re-filter what is in memory; network only if the Overpass bucket grew. */
  setCorridor(corridorM: number): void
  /** Filters changed → load again for the current track. */
  reload(): Promise<void>
  /** Re-request only the Overpass chunks that failed. */
  retryFailed(): Promise<void>
  /** Track removed: abort, drop state, no further callbacks. */
  cancel(): void
  /** For the detail panel; null when no track or farther than MAX_CORRIDOR_M. */
  positionOf(poi: OsmPoi): TrackPosition | null
}

type Mode = 'full' | 'auto' | 'failed'

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

export function createTrackPoiLoader(deps: TrackPoiLoaderDeps): TrackPoiLoader {
  const fetchAround = deps.fetchAround ?? fetchPoisAround
  const wait = deps.wait ?? sleep

  let track: Track | null = null
  let index: SegmentIndex | null = null
  let chunks: TrackPoint[][] | null = null
  let corridorM = 0
  const candidates = new Map<string, OsmPoi>()

  // Per-track load state (reset by a full run).
  let tilesDone = false
  let fallback = false // tiles unusable → built-ins go through Overpass as well
  let tiledIds: ReadonlySet<string> | null = null // filter ids the tiles contain (null = manifest not read yet)
  let runBucket = 0 // Overpass radius bucket of the last/current Overpass phase; 0 = none yet
  let failed = new Set<number>() // chunk indices that failed twice
  let skippedLong = false
  let warnedTooMany = false

  let controller: AbortController | null = null
  let generation = 0
  let running = false
  let clearTimer: ReturnType<typeof setTimeout> | undefined

  const hitsNow = () => (track && index
    ? matchCorridor(index, track.lengthM, [...candidates.values()], corridorM)
    : [])

  function partition(): { builtins: FilterDef[]; custom: FilterDef[]; all: readonly FilterDef[] } {
    const all = deps.getOsmFilters()
    return {
      all,
      builtins: deps.tiles ? all.filter(f => f.builtin) : [],
      custom: deps.tiles ? all.filter(f => !f.builtin) : [...all],
    }
  }

  /** Filters for the Overpass path: user/AI ones plus built-ins the tiles lack — everything after a tile failure. */
  function overpassFiltersNow(): readonly FilterDef[] {
    const { all, custom } = partition()
    if (fallback) return all
    return tiledIds ? planTileFilters(all, tiledIds).liveFilters : custom
  }

  function stop(): void {
    generation++
    controller?.abort()
    controller = null
    running = false
    clearTimeout(clearTimer)
  }

  function resetState(): void {
    candidates.clear()
    tilesDone = false
    fallback = false
    tiledIds = null
    runBucket = 0
    failed = new Set()
    skippedLong = false
    warnedTooMany = false
  }

  /** Re-filtered delivery for the memory-only paths (slider without network). */
  function deliverIdle(): void {
    const hits = hitsNow()
    deps.onUpdate(hits, !running)
    if (running) return
    if (hits.length > MAX_HITS) { warnedTooMany = true; deps.setStatus(MSG_TOO_MANY) }
    else if (warnedTooMany) { warnedTooMany = false; deps.setStatus('') }
  }

  async function execute(mode: Mode): Promise<void> {
    const t = track
    const idx = index
    if (!t || !idx) return
    stop()
    const gen = generation
    const ctl = new AbortController()
    controller = ctl
    const { signal } = ctl
    const live = () => gen === generation && !signal.aborted
    running = true
    const { builtins } = partition()

    try {
      // ── Phase 1: static tiles for the built-ins ──
      if (mode !== 'failed' && !tilesDone && deps.tiles && builtins.length > 0) {
        const tiles = deps.tiles
        let cellDeg = 0
        try {
          const m = await tiles.manifest(signal)
          cellDeg = m.cellDeg
          tiledIds = tiledFilterIds(m)
        } catch { /* no cellDeg → fallback below */ }
        if (!live()) return
        let ok = cellDeg > 0
        if (ok) {
          const plan = planTileFilters(deps.getOsmFilters(), tiledIds)
          const seen = new Set<string>()
          const keys: string[] = []
          for (const box of corridorBoxes(t.points, MAX_CORRIDOR_M)) {
            for (const k of tileKeysFor(box, cellDeg)) if (!seen.has(k)) { seen.add(k); keys.push(k) }
          }
          const pairs: Array<[TileLayer, string]> = plan.layers
            .flatMap(layer => keys.map((k): [TileLayer, string] => [layer, k]))
          const batches = Math.ceil(pairs.length / TILE_BATCH_SIZE)
          for (let b = 0; b < batches && ok; b++) {
            const wanted = new Map<TileLayer, string[]>()
            for (const [layer, key] of pairs.slice(b * TILE_BATCH_SIZE, (b + 1) * TILE_BATCH_SIZE)) {
              const list = wanted.get(layer)
              if (list) list.push(key)
              else wanted.set(layer, [key])
            }
            try {
              const pois = await tiles.fetchTilePois(wanted, plan.tileFilters, signal)
              if (!live()) return
              for (const p of pois) candidates.set(poiKey(p), p)
              deps.onUpdate(hitsNow(), false)
              deps.setStatus(`${MSG_LOADING} (${b + 1} von ${batches})`)
            } catch (err) {
              if (!live()) return
              console.warn('Track POI tiles failed, falling back to Overpass:', err)
              ok = false
            }
          }
        }
        if (ok) tilesDone = true
        else fallback = true
      }

      // ── Phase 2: Overpass (custom filters, or everything after a tile failure) ──
      const overpassFilters = overpassFiltersNow()
      const tooLong = t.lengthM > MAX_OVERPASS_TRACK_M
      const bucket = overpassRadiusBucket(corridorM)
      const wantOverpass = overpassFilters.length > 0 && (
        mode === 'failed' ? failed.size > 0 : mode === 'full' || runBucket === 0 || bucket > runBucket
      )
      if (overpassFilters.length > 0 && tooLong) skippedLong = true
      if (wantOverpass && !tooLong) {
        chunks ??= chunkForOverpass(t.points)
        const list = chunks
        const radius = (mode === 'failed' && runBucket > 0 ? runBucket : bucket) + RADIUS_SLACK_M
        if (mode !== 'failed') runBucket = bucket
        const todo = mode === 'failed' ? [...failed].sort((a, b) => a - b) : list.map((_, i) => i)
        failed = new Set()
        let n = 0
        for (const i of todo) {
          n++
          let pois: readonly OsmPoi[] | null = null
          for (let attempt = 0; attempt < 2 && !pois; attempt++) {
            try {
              pois = await fetchAround(list[i]!, radius, overpassFilters, signal)
            } catch (err) {
              if (!live()) return
              if (attempt === 0) {
                await wait(RETRY_DELAY_MS)
                if (!live()) return
              } else {
                console.warn('Track POI chunk failed:', err)
              }
            }
          }
          if (!live()) return
          if (!pois) { failed.add(i); continue }
          for (const p of pois) candidates.set(poiKey(p), p)
          deps.onUpdate(hitsNow(), false)
          deps.setStatus(`${MSG_LOADING} (${n} von ${todo.length})`)
        }
      }

      // ── Done ──
      if (!live()) return
      running = false
      const hits = hitsNow()
      deps.onUpdate(hits, true)
      warnedTooMany = hits.length > MAX_HITS
      if (failed.size > 0) deps.setStatus(MSG_CHUNKS_FAILED, true)
      else if (warnedTooMany) deps.setStatus(MSG_TOO_MANY)
      else if (skippedLong) deps.setStatus(MSG_TOO_LONG)
      else {
        deps.setStatus(trackPoiCountMessage(hits.length))
        clearTimer = setTimeout(() => { if (gen === generation) deps.setStatus('') }, CLEAR_STATUS_MS)
      }
    } finally {
      if (gen === generation) running = false
    }
  }

  return {
    load(next) {
      track = next
      index = createSegmentIndex(next.points, MAX_CORRIDOR_M)
      chunks = null
      corridorM = next.corridorM
      resetState()
      return execute('full')
    },

    setCorridor(m) {
      if (!track) return
      corridorM = m
      const overpassFilters = overpassFiltersNow()
      const grew = runBucket > 0 && overpassRadiusBucket(m) > runBucket
        && overpassFilters.length > 0 && track.lengthM <= MAX_OVERPASS_TRACK_M
      if (grew) { void execute('auto'); return }
      deliverIdle()
    },

    reload() {
      if (!track) return Promise.resolve()
      resetState()
      return execute('full')
    },

    retryFailed() {
      if (!track || failed.size === 0) return Promise.resolve()
      return execute('failed')
    },

    cancel() {
      stop()
      track = null
      index = null
      chunks = null
      resetState()
    },

    positionOf(poi) {
      if (!track || !index) return null
      const hit = matchCorridor(index, track.lengthM, [poi], MAX_CORRIDOR_M)[0]
      return hit ? { kmAlong: hit.kmAlong, kmToEnd: hit.kmToEnd, offsetM: hit.offsetM } : null
    },
  }
}
