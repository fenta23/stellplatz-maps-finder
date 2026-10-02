import type { OsmPoi, PoiType } from './OverpassClient.js'
import { isPrivateParking, poiKey } from './OverpassClient.js'
import { DEFAULT_FILTERS, filterIconPath } from '@/features/filters/filterModel.js'

export interface MarkerHandle {
  setVisible(visible: boolean): void
  remove(): void
  updateIcon(icon: string): void
}

export interface MapAdapter {
  createMarker(options: {
    lat: number
    lon: number
    title: string
    icon: string
    onClick: () => void
  }): MarkerHandle
}

/** Visual style of a filter group: marker colour + Lucide icon paths. */
export interface FilterStyle {
  readonly color: string
  readonly iconPath: string
}

export type StyleResolver = (filterId: string) => FilterStyle

interface TrackedMarker {
  readonly handle: MarkerHandle
  readonly poiType: PoiType
  readonly poiId: number
  readonly isPrivate: boolean
}

// Helper: wrap Lucide paths inside a coloured circle marker.
function svgMarker(fill: string, paths: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <circle cx="16" cy="16" r="15" fill="${fill}" stroke="#fff" stroke-width="2"/>
    <g transform="translate(4,4)" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none">${paths}</g>
  </svg>`
}

// Built-in styles, used as the default resolver (and when buildIcon gets no style).
const DEFAULT_STYLE = new Map<string, FilterStyle>(
  DEFAULT_FILTERS.map(f => [f.id, { color: f.color, iconPath: filterIconPath(f.iconId) }]),
)
const PARKING_PATH = '<path d="M9 17V7h4a3 3 0 0 1 0 6H9"/>'
const defaultStyleFor = (id: string): FilterStyle => DEFAULT_STYLE.get(id) ?? DEFAULT_STYLE.get('parking')!

// Grey "P" variant for private/restricted parking — same Lucide path, muted colour
const PRIVATE_PARKING_ICON = svgMarker('#616161', PARKING_PATH)

// Red heart badge (top-right corner) — Lucide heart
const HEART_BADGE = `<circle cx="26" cy="6" r="7" fill="#E53935" stroke="#fff" stroke-width="1.5"/><g transform="translate(21.2,1.2) scale(0.4)" fill="#fff"><path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"/></g>`

// Note badge (bottom-right corner) — Lucide sticky-note
const NOTE_BADGE = `<circle cx="26" cy="26" r="6.5" fill="#4CAF50" stroke="#fff" stroke-width="1.5"/><g transform="translate(21.8,21.8) scale(0.35)" fill="#fff"><path d="M21 9a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z"/><path d="M15 3v5a1 1 0 0 0 1 1h5"/></g>`

// Lock badge sits bottom-left so it never collides with badges on right side
const LOCK_BADGE = `<circle cx="7" cy="26" r="6.5" fill="#fff" stroke="#616161" stroke-width="1"/><rect x="4" y="25.5" width="6" height="5" rx="1" fill="#616161"/><path d="M5.2 25.5 v-1.3 a1.8 1.8 0 0 1 3.6 0 V25.5" fill="none" stroke="#fff" stroke-width="1.2"/>`

/**
 * Build the marker SVG for a POI group. `style` carries the configured colour +
 * icon; when omitted it falls back to the built-in default for that id. Private
 * parking always renders as a grey "P" with a lock, regardless of style.
 */
export function buildIcon(
  type: PoiType,
  isFavorite: boolean,
  hasNote = false,
  isPrivate = false,
  style?: FilterStyle,
): string {
  const privateParking = isPrivate && type === 'parking'
  const s = style ?? defaultStyleFor(type)
  const base = privateParking ? PRIVATE_PARKING_ICON : svgMarker(s.color, s.iconPath)
  const badges = `${privateParking ? LOCK_BADGE : ''}${isFavorite ? HEART_BADGE : ''}${hasNote ? NOTE_BADGE : ''}`
  return badges ? base.replace('</svg>', `${badges}</svg>`) : base
}

export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export class PoiMarkerManager {
  private readonly markers = new Map<string, TrackedMarker>() // keyed by poiKey()
  private readonly activeTypes: Set<string>
  private favoriteIds: ReadonlySet<string> = new Set()
  private noteIds: ReadonlySet<string> = new Set()
  private resolveStyle: StyleResolver

  constructor(
    private readonly adapter: MapAdapter,
    private readonly onSelect: (poi: OsmPoi) => void,
    initialTypes: ReadonlySet<string> = new Set(['parking', 'camper', 'campsite']),
    resolveStyle: StyleResolver = defaultStyleFor,
  ) {
    this.activeTypes = new Set(initialTypes)
    this.resolveStyle = resolveStyle
  }

  private iconFor(tracked: { poiType: PoiType; poiId: number; isPrivate: boolean }): string {
    const isFav = this.favoriteIds.has(String(tracked.poiId))
    const hasNote = this.noteIds.has(String(tracked.poiId))
    return svgToDataUrl(buildIcon(tracked.poiType, isFav, hasNote, tracked.isPrivate, this.resolveStyle(tracked.poiType)))
  }

  updatePois(pois: readonly OsmPoi[]): void {
    const incoming = new Set(pois.map(poiKey))

    for (const [id, tracked] of this.markers) {
      if (!incoming.has(id)) {
        tracked.handle.remove()
        this.markers.delete(id)
      }
    }

    for (const poi of pois) {
      const key = poiKey(poi)
      if (this.markers.has(key)) continue
      const isPrivate = isPrivateParking(poi)
      const handle = this.adapter.createMarker({
        lat: poi.lat,
        lon: poi.lon,
        title: poi.tags.name ?? poi.type,
        icon: this.iconFor({ poiType: poi.type, poiId: poi.id, isPrivate }),
        onClick: () => this.onSelect(poi),
      })
      this.markers.set(key, { handle, poiType: poi.type, poiId: poi.id, isPrivate })
    }

    for (const [, tracked] of this.markers) {
      tracked.handle.setVisible(this.activeTypes.has(tracked.poiType))
    }
  }

  setFavorites(ids: ReadonlySet<string>): void {
    this.favoriteIds = ids
    this.refreshIcons()
  }

  setNotes(ids: ReadonlySet<string>): void {
    this.noteIds = ids
    this.refreshIcons()
  }

  /** Re-render every marker's icon (e.g. after a filter's colour/icon changed). */
  refreshIcons(): void {
    for (const [, tracked] of this.markers) {
      tracked.handle.updateIcon(this.iconFor(tracked))
    }
  }

  /** Swap the style resolver (live filter colours/icons) and re-render. */
  setStyleResolver(resolve: StyleResolver): void {
    this.resolveStyle = resolve
    this.refreshIcons()
  }

  setTypeVisible(type: string, visible: boolean): void {
    if (visible) {
      this.activeTypes.add(type)
    } else {
      this.activeTypes.delete(type)
    }
    for (const [, tracked] of this.markers) {
      if (tracked.poiType === type) {
        tracked.handle.setVisible(visible)
      }
    }
  }

  /** Replace the whole active set (e.g. after the enabled filters changed). */
  setActiveTypes(types: ReadonlySet<string>): void {
    this.activeTypes.clear()
    for (const t of types) this.activeTypes.add(t)
    for (const [, tracked] of this.markers) {
      tracked.handle.setVisible(this.activeTypes.has(tracked.poiType))
    }
  }

  getActiveTypes(): ReadonlySet<string> {
    return this.activeTypes
  }

  clear(): void {
    for (const [, tracked] of this.markers) {
      tracked.handle.remove()
    }
    this.markers.clear()
  }

  get count(): number {
    return this.markers.size
  }
}
