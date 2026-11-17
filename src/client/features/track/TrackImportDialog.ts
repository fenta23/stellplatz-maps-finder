import './track.css'
import { clone, ref } from '@/core/template.js'
import { createEventScope, type EventScope } from '@/core/events.js'
import { KOMOOT_IMPORT_ENABLED } from './komoot.js'
import { prepareTrack } from './trackImport.js'
import { trackImportErrorMessage } from './trackErrors.js'
import type { ImportedTrack, Track } from './trackTypes.js'
import panelHtml from './trackImportDialog.html?raw'

export interface TrackImportDialogDeps {
  getActiveTrack(): Track | null
  importLink(input: string, signal: AbortSignal): Promise<ImportedTrack>
  importFile(file: File): Promise<ImportedTrack>
  onImported(track: Track): void
  onShowActive(): void
  onRemoveActive(): void
  /** Defaults to KOMOOT_IMPORT_ENABLED. */
  readonly komootEnabled?: boolean
}

/** "86,4 km" — one decimal, German decimal comma. */
export function formatKm(lengthM: number): string {
  return `${(lengthM / 1000).toFixed(1).replace('.', ',')} km`
}

/** Modal to import a track from a Komoot link or a GPX file, and to manage the active one. */
export class TrackImportDialog {
  private readonly panel: HTMLElement
  private readonly activeEl: HTMLElement
  private readonly linkInput: HTMLInputElement
  private readonly linkBtn: HTMLButtonElement
  private readonly fileBtn: HTMLButtonElement
  private readonly fileInput: HTMLInputElement
  private readonly statusEl: HTMLElement
  private readonly events: EventScope = createEventScope()
  private abort: AbortController | null = null
  private busy = false
  /** Bumped on every import start and on close, so stale results are ignored. */
  private token = 0

  constructor(container: HTMLElement, private readonly deps: TrackImportDialogDeps) {
    this.panel = clone(panelHtml)
    this.activeEl = ref(this.panel, 'active')
    this.linkInput = ref(this.panel, 'linkInput')
    this.linkBtn = ref(this.panel, 'linkBtn')
    this.fileBtn = ref(this.panel, 'fileBtn')
    this.fileInput = ref(this.panel, 'fileInput')
    this.statusEl = ref(this.panel, 'status')
    ref(this.panel, 'komootSection').hidden = !(deps.komootEnabled ?? KOMOOT_IMPORT_ENABLED)

    this.panel.querySelector('.fav-close')?.addEventListener('click', () => this.close())
    // Klick auf den Backdrop (nur im Desktop-Modal sichtbar) schließt ebenfalls.
    this.panel.addEventListener('click', e => { if (e.target === this.panel) this.close() })
    ref(this.panel, 'linkForm').addEventListener('submit', e => { e.preventDefault(); this.submitLink() })
    this.fileBtn.addEventListener('click', () => { if (!this.busy) this.fileInput.click() })
    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput.files?.[0]
      if (file) this.submitFile(file)
      this.fileInput.value = ''
    })
    ref(this.panel, 'show').addEventListener('click', () => deps.onShowActive())
    ref(this.panel, 'remove').addEventListener('click', () => deps.onRemoveActive())
    container.appendChild(this.panel)

    this.events.on(document, 'keydown', e => { if (e.key === 'Escape' && this.isOpen()) this.close() })
  }

  isOpen(): boolean { return this.panel.classList.contains('open') }
  destroy(): void { this.events.dispose() }

  open(): void {
    this.renderActive()
    this.setStatus('')
    this.panel.classList.add('open')
  }

  close(): void {
    this.token++
    this.abort?.abort()
    this.abort = null
    this.setBusy(false)
    this.setStatus('')
    this.panel.classList.remove('open')
  }

  /** Re-render the active-track block (e.g. after the store changed while open). */
  refresh(): void { if (this.isOpen()) this.renderActive() }

  private renderActive(): void {
    const track = this.deps.getActiveTrack()
    this.activeEl.hidden = !track
    if (!track) return
    ref(this.activeEl, 'activeName').textContent = track.name
    ref(this.activeEl, 'activeLength').textContent = formatKm(track.lengthM)
  }

  private submitLink(): void {
    const input = this.linkInput.value.trim()
    if (this.busy || !input) return
    const ctrl = new AbortController()
    void this.run(ctrl, () => this.deps.importLink(input, ctrl.signal))
  }

  private submitFile(file: File): void {
    if (this.busy) return
    void this.run(new AbortController(), () => this.deps.importFile(file))
  }

  private async run(ctrl: AbortController, load: () => Promise<ImportedTrack>): Promise<void> {
    const my = ++this.token
    this.abort = ctrl
    this.setBusy(true)
    this.setStatus('Lade Tour…')
    try {
      const track = prepareTrack(await load())
      if (my !== this.token) return
      this.abort = null
      this.setBusy(false)
      this.setStatus('')
      this.linkInput.value = ''
      this.panel.classList.remove('open')
      this.deps.onImported(track)
    } catch (err) {
      if (my !== this.token) return
      this.abort = null
      this.setBusy(false)
      this.setStatus(trackImportErrorMessage(err), true)
      this.linkInput.focus()
    }
  }

  private setBusy(busy: boolean): void {
    this.busy = busy
    this.linkInput.disabled = busy
    this.linkBtn.disabled = busy
    this.fileBtn.disabled = busy
    this.fileInput.disabled = busy
  }

  private setStatus(msg: string, isError = false): void {
    this.statusEl.textContent = msg
    this.statusEl.classList.toggle('track-status-error', isError)
  }
}
