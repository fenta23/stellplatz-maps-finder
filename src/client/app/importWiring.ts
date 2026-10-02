import '@/features/import/import.css'
import { clone, ref } from '@/core/template.js'
import { geocode } from '@/core/nominatim.js'
import { importGoogleMapsFile, type Geocoder } from '@/features/import/GoogleMapsImport.js'
import type { ICustomPoiStore } from '@/features/custom-pois/CustomPoiStore.js'
import importPanelHtml from '@/features/import/importPanel.html?raw'

export interface ImportWiringDeps {
  readonly customPoiStore: ICustomPoiStore
  readonly setStatus: (msg: string) => void
  readonly flashStatus: (msg: string) => void
  readonly flashInfo: (msg: string) => void
  readonly refreshCustomMarkers: () => void
}

export interface ImportHandle {
  readonly open: () => void
}

export function initImport(deps: ImportWiringDeps): ImportHandle {
  const { customPoiStore, setStatus, flashStatus, flashInfo, refreshCustomMarkers } = deps

  const panel = clone(importPanelHtml)
  panel.classList.remove('open')
  document.body.appendChild(panel)

  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json,.csv'
  input.style.display = 'none'
  document.body.appendChild(input)

  const geocoder: Geocoder = {
    async geocode(name) {
      const [r] = await geocode(name, { limit: 1 })
      if (!r) return null
      const lat = parseFloat(r.lat)
      const lon = parseFloat(r.lon)
      return isFinite(lat) && isFinite(lon) ? { lat, lon } : null
    },
  }

  ref<HTMLButtonElement>(panel, 'btnJson').addEventListener('click', () => {
    input.accept = '.json'
    input.click()
  })
  ref<HTMLButtonElement>(panel, 'btnCsv').addEventListener('click', () => {
    input.accept = '.csv'
    input.click()
  })
  panel.querySelector('.fav-close')?.addEventListener('click', () => panel.classList.remove('open'))
  // Klick auf den Backdrop (nur im Desktop-Modal sichtbar) schließt ebenfalls.
  panel.addEventListener('click', e => { if (e.target === panel) panel.classList.remove('open') })
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && panel.classList.contains('open')) panel.classList.remove('open') })

  input.addEventListener('change', () => {
    const file = input.files?.[0]
    if (!file) return
    panel.classList.remove('open')
    setStatus(`${file.name} wird importiert…`)
    void importGoogleMapsFile(file, customPoiStore, {
      geocoder,
      onProgress: msg => setStatus(msg),
    }).then(result => {
      const parts: string[] = [`${result.imported} Orte aus „${file.name}" importiert`]
      if (result.geocoded) parts.push(`${result.geocoded} geokodiert`)
      if (result.skipped) parts.push(`${result.skipped} übersprungen`)
      flashInfo(parts.join(', '))
      refreshCustomMarkers()
    }).catch((err: Error) => {
      flashStatus(err.message)
    })
    input.value = ''
  })

  return { open: () => panel.classList.add('open') }
}
