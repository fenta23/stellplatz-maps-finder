import { describe, it, expect, vi, afterEach } from 'vitest'
import { initCustomPois } from './customPoiWiring.js'
import type { OsmPoi } from '@/features/pois/OverpassClient.js'
import type { MapAdapter, MarkerHandle } from '@/features/pois/PoiMarkerManager.js'
import type { MapService } from '@/features/map/MapService.js'
import type { Selection } from './selection.js'
import type { CustomPoi } from '@/features/custom-pois/CustomPoi.js'

function makeHandle(): MarkerHandle {
  return { setVisible() {}, remove() {}, updateIcon() {} }
}

/** Adapter that records the most recently created marker's click handler. */
function makeAdapter() {
  let lastClick: (() => void) | undefined
  const adapter: MapAdapter = {
    createMarker({ onClick }) { lastClick = onClick; return makeHandle() },
  }
  return { adapter, clickLast: () => lastClick?.() }
}

function makeMapService(): MapService {
  return {
    onContextMenu: () => () => {},
    onPlacement: () => () => {},
    setCenter: () => {},
  } as unknown as MapService
}

const samplePoi: CustomPoi = {
  id: 'abc', iconId: 'parking', lat: 48.1, lon: 11.5, name: 'Test', createdAt: 1, updatedAt: 1,
}

afterEach(() => localStorage.clear())

describe('initCustomPois — lazy selection wiring', () => {
  // Regression: `selection` is created *after* initCustomPois (circular dep:
  // selection needs customPois.editCurrent, customPois needs selection). The bug
  // was that initCustomPois destructured `selection` eagerly and froze `undefined`,
  // so clicking a custom POI threw "Cannot read properties of undefined (reading 'select')".
  it('resolves selection through the getter even when assigned after init', () => {
    const { adapter, clickLast } = makeAdapter()

    let selection: Selection | undefined
    const result = initCustomPois({
      adapter,
      mapService: makeMapService(),
      getSelection: () => selection!,
      color: '#fff',
    })

    // selection only exists now — after the wiring was built
    const select = vi.fn().mockResolvedValue(undefined)
    selection = { select, clear: vi.fn() } as unknown as Selection

    result.store.put(samplePoi)
    result.refreshMarkers()

    expect(() => clickLast()).not.toThrow()
    expect(select).toHaveBeenCalledOnce()
    expect(select.mock.calls[0]![0]).toMatchObject({ lat: 48.1, lon: 11.5 })
  })
})

describe('initCustomPois — onMarkerTap', () => {
  it('a swallowed tap does not select the POI', () => {
    const { adapter, clickLast } = makeAdapter()
    const select = vi.fn()
    const onMarkerTap = vi.fn((_poi: OsmPoi) => true)
    const result = initCustomPois({
      adapter, mapService: makeMapService(), color: '#fff', onMarkerTap,
      getSelection: () => ({ select, clear: vi.fn() }) as unknown as Selection,
    })
    result.store.put(samplePoi)
    result.refreshMarkers()
    clickLast()
    expect(onMarkerTap).toHaveBeenCalledOnce()
    expect(onMarkerTap.mock.calls[0]![0]).toMatchObject({ lat: 48.1, lon: 11.5 })
    expect(select).not.toHaveBeenCalled()
  })

  it('a tap that is not swallowed selects the POI as usual', () => {
    const { adapter, clickLast } = makeAdapter()
    const select = vi.fn()
    const result = initCustomPois({
      adapter, mapService: makeMapService(), color: '#fff', onMarkerTap: () => false,
      getSelection: () => ({ select, clear: vi.fn() }) as unknown as Selection,
    })
    result.store.put(samplePoi)
    result.refreshMarkers()
    clickLast()
    expect(select).toHaveBeenCalledOnce()
  })
})
