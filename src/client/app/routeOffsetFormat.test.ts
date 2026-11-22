import { describe, it, expect } from 'vitest'
import { formatOffset } from '@/features/route/RoutePanel.js'
import { routeInfoText } from '@/features/poi-detail/poiLabels.js'

describe('route offset wording is identical in route list and POI detail', () => {
  for (const offsetM of [0, 4, 5, 9, 14, 15, 65, 994, 995, 1000, 1234, 2000]) {
    it(`${offsetM} m`, () => {
      const list = formatOffset(offsetM)
      const detail = routeInfoText({ kmAlong: 1, kmToEnd: 2, offsetM })
      expect(detail.endsWith(` · ${list}`)).toBe(true)
    })
  }
})
