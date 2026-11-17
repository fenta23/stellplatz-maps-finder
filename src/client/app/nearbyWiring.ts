import type { TargetMarker } from '@/features/map/targetMarker.js'
import type { NearbyItem } from '@/features/poi-detail/PoiDetailPanel.js'
import { nearbyMessage } from '@/features/poi-detail/nearbyMessage.js'

export interface NearbyWiringDeps {
  readonly target: TargetMarker
  /** Centres the position in the free map area at a close zoom. */
  readonly centerOn: (pos: { lat: number; lon: number }) => void
  readonly iconFor: (kind: string) => string | undefined
  readonly flash: (msg: string) => void
}

export interface NearbyWiring {
  select(item: NearbyItem): void
  clear(): void
}

/** A tapped "In der Nähe" entry has no marker of its own → mark it, bring it into view, say what it is. */
export function createNearbyWiring(deps: NearbyWiringDeps): NearbyWiring {
  return {
    select(item) {
      const iconSvg = deps.iconFor(item.kind)
      deps.target.show(item, { label: item.name, ...(iconSvg ? { iconSvg } : {}) })
      deps.centerOn(item)
      deps.flash(nearbyMessage(item))
    },
    clear: () => deps.target.clear(),
  }
}
