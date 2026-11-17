import { describe, it, expect, vi } from 'vitest'
import { createSelection, type SelectionDeps } from './selection.js'
import { createSession } from './session.js'
import type { OsmPoi } from '@/features/pois/OverpassClient.js'

const poi: OsmPoi = { id: 1, type: 'parking', lat: 48.1, lon: 11.5, tags: {} }
const customPoi: OsmPoi = { id: -5, type: 'parking', lat: 48.2, lon: 11.6, tags: { name: 'Mein Platz' } }

function makeDeps(extra: Partial<SelectionDeps> = {}, isFav = false) {
  const session = createSession(null)
  const panel = { show: vi.fn(), hide: vi.fn() }
  const favorites = { has: vi.fn().mockReturnValue(isFav), toggle: vi.fn(), getAll: vi.fn(), onChange: vi.fn() }
  const deps = {
    session,
    panel,
    favorites,
    panIntoView: vi.fn(),
    loadDetails: vi.fn(),
    ...extra,
  } as unknown as SelectionDeps
  return { deps, session, panel }
}

describe('createSelection.select', () => {
  it('stores the selection, pans, shows the panel and loads details', () => {
    const { deps, session, panel } = makeDeps()
    createSelection(deps).select(poi)
    expect(session.selectedPoi).toBe(poi)
    expect(deps.panIntoView).toHaveBeenCalledWith(poi)
    expect(panel.show).toHaveBeenCalledOnce()
    expect(deps.loadDetails).toHaveBeenCalledWith(poi)
  })

  it('works without any user position (no location needed)', () => {
    const { deps, panel } = makeDeps()
    createSelection(deps).select(poi)
    expect(panel.show).toHaveBeenCalledOnce()
  })

  it('passes favourite state, note and config to the panel view', () => {
    const { deps, panel } = makeDeps({ getNote: () => 'Notiz', isLoggedIn: () => true }, true)
    createSelection(deps).select(poi)
    const [shown, view] = panel.show.mock.calls[0]!
    expect(shown).toBe(poi)
    expect(view.isFavorite).toBe(true)
    expect(view.noteText).toBe('Notiz')
    expect(view.config.isLoggedIn).toBe(true)
    expect(view.config.isCustom).toBeUndefined()
  })

  it('forwards getTrackInfo to the panel view; null or absent → no trackInfo key', () => {
    const info = { kmAlong: 12.4, kmToEnd: 73.6, offsetM: 180 }
    const a = makeDeps({ getTrackInfo: () => info })
    createSelection(a.deps).select(poi)
    expect(a.panel.show.mock.calls[0]![1].trackInfo).toBe(info)
    const b = makeDeps({ getTrackInfo: vi.fn().mockReturnValue(null) })
    createSelection(b.deps).select(poi)
    expect('trackInfo' in b.panel.show.mock.calls[0]![1]).toBe(false)
    const c = makeDeps()
    createSelection(c.deps).select(poi)
    expect('trackInfo' in c.panel.show.mock.calls[0]![1]).toBe(false)
  })

  it('custom POIs: marked custom, wired edit/delete, no detail loading', () => {
    const onEdit = vi.fn()
    const onDelete = vi.fn()
    const { deps, panel } = makeDeps({ onEditCustomPoi: onEdit, onDeleteCustomPoi: onDelete })
    createSelection(deps).select(customPoi)
    const view = panel.show.mock.calls[0]![1]
    expect(view.config.isCustom).toBe(true)
    view.config.onEdit()
    view.config.onDelete()
    expect(onEdit).toHaveBeenCalledOnce()
    expect(onDelete).toHaveBeenCalledOnce()
    expect(deps.loadDetails).not.toHaveBeenCalled()
  })
})

describe('createSelection.clear', () => {
  it('drops the selection', () => {
    const { deps, session } = makeDeps()
    session.selectedPoi = poi
    createSelection(deps).clear()
    expect(session.selectedPoi).toBeNull()
  })
})

describe('createSelection hooks (mark the selected place on the map)', () => {
  it('reports the selected POI and the end of the selection', () => {
    const onSelected = vi.fn()
    const onCleared = vi.fn()
    const { deps } = makeDeps({ onSelected, onCleared })
    const selection = createSelection(deps)
    selection.select(poi)
    expect(onSelected).toHaveBeenCalledWith(poi)
    expect(onCleared).not.toHaveBeenCalled()
    selection.select(customPoi)
    expect(onSelected).toHaveBeenLastCalledWith(customPoi)
    selection.clear()
    expect(onCleared).toHaveBeenCalledOnce()
  })
})

describe('createSelection.select with { center: true } (picked from a list)', () => {
  it('centres the POI instead of only uncovering it', () => {
    const centerInView = vi.fn()
    const { deps } = makeDeps({ centerInView })
    createSelection(deps).select(poi, { center: true })
    expect(centerInView).toHaveBeenCalledWith(poi)
    expect(deps.panIntoView).not.toHaveBeenCalled()
  })

  it('keeps the gentle pan for a plain select (marker click) and without a centring dep', () => {
    const centerInView = vi.fn()
    const a = makeDeps({ centerInView })
    createSelection(a.deps).select(poi)
    expect(centerInView).not.toHaveBeenCalled()
    expect(a.deps.panIntoView).toHaveBeenCalledWith(poi)

    const b = makeDeps()
    createSelection(b.deps).select(poi, { center: true })
    expect(b.deps.panIntoView).toHaveBeenCalledWith(poi)
  })
})
