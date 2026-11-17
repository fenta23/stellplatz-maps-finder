import L from 'leaflet'

/** Marks the selected place on the map. */
export interface PoiHighlight {
  /** Mark this position, replacing any previous mark. `iconUrl` = the place's marker icon, drawn enlarged. */
  show(pos: { readonly lat: number; readonly lon: number }, iconUrl?: string): void
  clear(): void
}

export const HIGHLIGHT_PANE = 'poi-highlight'
/** Above the marker pane (600) with its clusters, below tooltips (650) and popups (700). */
const PANE_Z_INDEX = '620'
const SIZE = 44
/** POI markers are 32 px circles standing on their coordinate → their centre is 16 px above it. */
const MARKER_CENTER_ABOVE = 16

/**
 * Leaflet implementation: an own pane above markers and clusters, so the
 * selected place stays visible even while its marker is folded into a cluster.
 * The mark ignores the pointer — clicks reach the marker underneath.
 */
export function createLeafletPoiHighlight(map: L.Map): PoiHighlight {
  const pane = map.getPane(HIGHLIGHT_PANE) ?? map.createPane(HIGHLIGHT_PANE)
  pane.style.zIndex = PANE_Z_INDEX
  pane.style.pointerEvents = 'none'
  let marker: L.Marker | null = null

  const clear = () => {
    marker?.remove()
    marker = null
  }

  return {
    show(pos, iconUrl) {
      clear()
      const el = document.createElement('div')
      el.className = 'poi-highlight-body'
      const ring = document.createElement('span')
      ring.className = 'poi-highlight-ring'
      el.appendChild(ring)
      if (iconUrl) {
        const img = document.createElement('img')
        img.className = 'poi-highlight-icon'
        img.src = iconUrl
        img.alt = ''
        el.appendChild(img)
      }
      marker = L.marker([pos.lat, pos.lon], {
        icon: L.divIcon({
          className: 'poi-highlight',
          html: el,
          iconSize: [SIZE, SIZE],
          iconAnchor: [SIZE / 2, SIZE / 2 + MARKER_CENTER_ABOVE],
        }),
        pane: HIGHLIGHT_PANE,
        interactive: false,
        keyboard: false,
      }).addTo(map)
    },
    clear,
  }
}
