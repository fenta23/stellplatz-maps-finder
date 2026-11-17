import type { NearbyItem } from './PoiDetailPanel.js'
import { formatMeters } from './poiLabels.js'

/**
 * Plain-text status-toast for a tapped nearby POI. The status toast is
 * rendered via `textContent`, so this must be plain text — no icons/markup.
 * (A previous version interpolated a non-existent `item.icon`, which showed as
 * a literal "undefined" before the name.)
 */
export function nearbyMessage(item: NearbyItem): string {
  return `${item.name} · ${formatMeters(item.distance)} Luftlinie`
}
