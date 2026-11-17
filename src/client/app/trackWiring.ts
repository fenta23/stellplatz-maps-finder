import type { ITrackStore } from '@/features/track/TrackStore.js'
import type { TrackLayer } from '@/features/track/TrackLayer.js'
import { TrackImportDialog, formatKm } from '@/features/track/TrackImportDialog.js'
import { importFromKomootLink } from '@/features/track/komoot.js'
import { readGpxFile } from '@/features/track/gpx.js'

export interface TrackWiringDeps {
  readonly store: ITrackStore
  readonly layer: TrackLayer
  readonly dialogContainer: HTMLElement
  readonly flash: (msg: string) => void
  readonly fetchFn?: typeof fetch | undefined
}

export interface TrackWiring {
  readonly openImport: () => void
  readonly closeImport: () => void
  readonly isImportOpen: () => boolean
  readonly setSatellite: (on: boolean) => void
}

export function createTrackWiring(deps: TrackWiringDeps): TrackWiring {
  const { store, layer, dialogContainer, flash, fetchFn } = deps

  const draw = (track: ReturnType<ITrackStore['get']>) => {
    if (track) layer.show(track.points)
    else layer.clear()
  }
  store.onChange(track => { draw(track); dialog.refresh() })
  // Startup: draw only, the map keeps its normal start position.
  draw(store.get())

  const dialog = new TrackImportDialog(dialogContainer, {
    getActiveTrack: () => store.get(),
    importLink: (input, signal) => importFromKomootLink(input, fetchFn, signal),
    importFile: file => readGpxFile(file),
    onImported: track => {
      store.set(track)
      layer.fitBounds()
      flash(`Route geladen: ${track.name} · ${formatKm(track.lengthM)}`)
    },
    onShowActive: () => { layer.fitBounds(); dialog.close() },
    onRemoveActive: () => { store.clear(); flash('Route entfernt'); dialog.close() },
  })

  return {
    openImport: () => dialog.open(),
    closeImport: () => dialog.close(),
    isImportOpen: () => dialog.isOpen(),
    setSatellite: on => layer.setSatellite(on),
  }
}
