import L from 'leaflet'

/** Marks a place that has no marker of its own (e.g. a tapped "In der Nähe" entry). */
export interface TargetMarker {
  /** Mark a place that has no marker of its own; replaces any previous target. */
  show(
    pos: { readonly lat: number; readonly lon: number },
    opts: { readonly label: string; readonly iconSvg?: string },
  ): void
  clear(): void
}

export const TARGET_PANE = 'target-marker'
/** Above the marker pane (600) with clusters and the selection highlight (620), below tooltips (650). */
const PANE_Z_INDEX = '630'
const BADGE = 36

/**
 * Leaflet implementation: a round badge (kind icon or dot) standing on the
 * position, with the name permanently shown below it. Ignores the pointer.
 * `iconSvg` is trusted markup from the app's own icon set; the label is set as text.
 */
export function createLeafletTargetMarker(map: L.Map): TargetMarker {
  const pane = map.getPane(TARGET_PANE) ?? map.createPane(TARGET_PANE)
  pane.style.zIndex = PANE_Z_INDEX
  pane.style.pointerEvents = 'none'
  let marker: L.Marker | null = null

  const clear = () => {
    marker?.remove()
    marker = null
  }

  return {
    show(pos, opts) {
      clear()
      const el = document.createElement('div')
      el.className = 'target-marker-body'
      const badge = document.createElement('span')
      badge.className = 'target-marker-badge'
      if (opts.iconSvg) badge.innerHTML = opts.iconSvg
      else badge.classList.add('target-marker-dot')
      const label = document.createElement('span')
      label.className = 'target-marker-label'
      label.textContent = opts.label
      el.append(badge, label)
      marker = L.marker([pos.lat, pos.lon], {
        icon: L.divIcon({
          className: 'target-marker',
          html: el,
          iconSize: [BADGE, BADGE],
          iconAnchor: [BADGE / 2, BADGE / 2],
        }),
        pane: TARGET_PANE,
        interactive: false,
        keyboard: false,
      }).addTo(map)
    },
    clear,
  }
}
