import type { OsmPoi } from '@/features/pois/OverpassClient.js'
import type { PoiDetailPanel, PanelConfig } from '@/features/poi-detail/PoiDetailPanel.js'
import type { IFavoritesStore } from '@/features/favorites/FavoritesStore.js'
import type { Session } from './session.js'

export interface SelectionDeps {
  readonly session: Session
  readonly panel: PoiDetailPanel
  readonly favorites: IFavoritesStore
  readonly panIntoView: (poi: { lat: number; lon: number }) => void
  readonly loadDetails: (poi: OsmPoi) => void
  readonly getNote?: (poi: OsmPoi) => string
  /** For custom POIs: open the edit dialog. */
  readonly onEditCustomPoi?: () => void
  /** For custom POIs: delete the POI and close panel. */
  readonly onDeleteCustomPoi?: () => void
  /** Whether the user is logged in (gates premium features like park4night). */
  readonly isLoggedIn?: () => boolean
}

export interface Selection {
  select(poi: OsmPoi): void
  clear(): void
}

export function createSelection(deps: SelectionDeps): Selection {
  const { session, panel, favorites } = deps
  const isFav = (poi: OsmPoi) => favorites.has(String(poi.id))
  const noteOf = (poi: OsmPoi) => deps.getNote?.(poi) ?? ''

  const isCustom = (poi: OsmPoi) => poi.id < 0

  function buildConfig(poi: OsmPoi): PanelConfig {
    return {
      isCustom: isCustom(poi) || undefined,
      isLoggedIn: deps.isLoggedIn?.(),
      onEdit: isCustom(poi) ? () => deps.onEditCustomPoi?.() : undefined,
      onDelete: isCustom(poi) ? () => deps.onDeleteCustomPoi?.() : undefined,
    }
  }

  return {
    select(poi) {
      session.selectedPoi = poi
      deps.panIntoView(poi)
      panel.show(poi, { isFavorite: isFav(poi), noteText: noteOf(poi), config: buildConfig(poi) })
      if (!isCustom(poi)) deps.loadDetails(poi)
    },

    clear() {
      session.selectedPoi = null
    },
  }
}
