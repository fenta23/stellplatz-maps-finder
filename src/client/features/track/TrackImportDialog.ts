import './track.css'
import { clone, ref } from '@/core/template.js'
import { createEventScope, type EventScope } from '@/core/events.js'
import { KOMOOT_IMPORT_ENABLED } from './komoot.js'
import { prepareTrack } from './trackImport.js'
import { trackImportErrorMessage } from './trackErrors.js'
import { sourceLabel, type ImportedTrack, type SavedTrack, type Track } from './trackTypes.js'
import panelHtml from './trackImportDialog.html?raw'

export interface TrackImportDialogDeps {
  getActiveTrack(): SavedTrack | null
  getSavedTracks(): readonly SavedTrack[]
  importLink(input: string, signal: AbortSignal): Promise<ImportedTrack>
  importFile(file: File): Promise<ImportedTrack>
  onImported(track: Track): void
  onShowActive(): void
  /** "Route schließen": deactivate, the route stays saved. */
  onRemoveActive(): void
  onActivate(id: string): void
  /** Deletes a saved route (also used for the active one). */
  onDelete(id: string): void
  /** "Route planen": without this dep the section stays hidden. The caller decides whether to close the dialog. */
  onPlan?(): void
  /** Defaults to KOMOOT_IMPORT_ENABLED. */
  readonly komootEnabled?: boolean
}

const TRASH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>'

/** "86,4 km" — one decimal, German decimal comma. */
export function formatKm(lengthM: number): string {
  return `${(lengthM / 1000).toFixed(1).replace('.', ',')} km`
}

/** Modal to import a track from a Komoot link or a GPX file, and to manage the active one. */
export class TrackImportDialog {
  private readonly panel: HTMLElement
  private readonly activeEl: HTMLElement
  private readonly savedEl: HTMLElement
  private readonly savedList: HTMLElement
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
    this.savedEl = ref(this.panel, 'saved')
    this.savedList = ref(this.panel, 'savedList')
    this.linkInput = ref(this.panel, 'linkInput')
    this.linkBtn = ref(this.panel, 'linkBtn')
    this.fileBtn = ref(this.panel, 'fileBtn')
    this.fileInput = ref(this.panel, 'fileInput')
    this.statusEl = ref(this.panel, 'status')
    const planSection = ref(this.panel, 'planSection')
    planSection.hidden = !deps.onPlan
    ref(planSection, 'planBtn').addEventListener('click', () => deps.onPlan?.())
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
    ref(this.panel, 'deleteActive').addEventListener('click', () => {
      const active = deps.getActiveTrack()
      if (!active) return
      deps.onDelete(active.id)
      this.close()
    })
    container.appendChild(this.panel)

    this.events.on(document, 'keydown', e => { if (e.key === 'Escape' && this.isOpen()) this.close() })
  }

  isOpen(): boolean { return this.panel.classList.contains('open') }
  destroy(): void { this.events.dispose() }

  open(): void {
    this.render()
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
  refresh(): void { if (this.isOpen()) this.render() }

  private render(): void {
    this.renderActive()
    this.renderSaved()
  }

  /** Saved routes that are not the active one; names come from files/Komoot, so only as text. */
  private renderSaved(): void {
    const activeId = this.deps.getActiveTrack()?.id
    const others = this.deps.getSavedTracks().filter(t => t.id !== activeId)
    this.savedEl.hidden = others.length === 0
    this.savedList.replaceChildren(...others.map(t => this.savedRow(t)))
  }

  private savedRow(t: SavedTrack): HTMLElement {
    const li = document.createElement('li')
    li.className = 'track-saved-item'
    const info = document.createElement('div')
    info.className = 'track-saved-info'
    const name = document.createElement('span')
    name.className = 'track-saved-name'
    name.textContent = t.name
    const meta = document.createElement('span')
    meta.className = 'track-saved-meta'
    meta.textContent = `${formatKm(t.lengthM)} · ${sourceLabel(t.source)}`
    info.append(name, meta)
    const show = document.createElement('button')
    show.type = 'button'
    show.className = 'import-btn track-saved-show'
    show.textContent = 'Anzeigen'
    show.addEventListener('click', () => { this.close(); this.deps.onActivate(t.id) })
    const del = document.createElement('button')
    del.type = 'button'
    del.className = 'track-saved-delete'
    del.setAttribute('aria-label', 'Route löschen')
    del.innerHTML = TRASH_SVG
    del.addEventListener('click', () => { this.deps.onDelete(t.id); this.render() })
    li.append(info, show, del)
    return li
  }

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
