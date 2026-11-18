import './route-planner.css'
import { clone, ref } from '@/core/template.js'
import { createEventScope, type EventScope } from '@/core/events.js'
import { PlaceField, type PlaceSuggestion } from '@/core/PlaceField.js'
import {
  TRAVEL_MODES, shortPlaceLabel,
  type PlanPoint, type PlanRequest, type PlanRole, type TravelMode,
} from './plannerModel.js'
import panelHtml from './routePlannerPanel.html?raw'

export interface RoutePlannerDeps {
  suggest(query: string): Promise<readonly PlaceSuggestion[]>
  locate(): Promise<{ lat: number; lon: number } | null>
  /**
   * Startet einen Karten-Pick und liefert die Abbruchfunktion.
   * `done(null)` beendet nur den Pick-Modus und lässt das Feld unangetastet.
   */
  pickOnMap(done: (pos: { lat: number; lon: number } | null) => void): () => void
  plan(req: PlanRequest, signal: AbortSignal): Promise<void>
  describeError(err: unknown): string
  initialMode(): TravelMode
  onModeChange?(mode: TravelMode): void
  onPointsChange?(start: PlanPoint | null, end: PlanPoint | null): void
  /** Das Panel wurde geschlossen (Esc, Erfolg oder `close()`); nur wenn es offen war. */
  onClose?(): void
  /** Verweis auf den Import-Dialog; ohne Dep bleibt der Link verborgen. */
  onOpenImport?(): void
}

const ROLE_NAME: Record<PlanRole, string> = { start: 'Start', end: 'Ziel' }
const RESOLVING = 'Orte werden gesucht…'
const LOCATE_UNAVAILABLE = 'Standort nicht verfügbar – Ort suchen oder Punkt auf der Karte wählen'

interface RoleUi {
  readonly field: PlaceField
  readonly input: HTMLInputElement
  readonly locateBtn: HTMLButtonElement
  readonly pickBtn: HTMLButtonElement
}

/**
 * Planer-Formular im Slot der Suchbox (Rahmen, Kopfzeile und Schließen-Knopf kommen von dort):
 * Start/Ziel (Suche, GPS, Karten-Pick), Verkehrsmittel, Berechnen.
 */
export class RoutePlannerPanel {
  private readonly panel: HTMLElement
  private readonly full: HTMLElement
  private readonly pickRow: HTMLElement
  private readonly pickText: HTMLElement
  private readonly goBtn: HTMLButtonElement
  private readonly swapBtn: HTMLButtonElement
  private readonly statusEl: HTMLElement
  private readonly modeBtns: readonly HTMLButtonElement[]
  private readonly ui: Record<PlanRole, RoleUi>
  private readonly events: EventScope = createEventScope()
  private readonly points: Record<PlanRole, PlanPoint | null> = { start: null, end: null }
  /** Per role: bumped on every set/clear/locate/pick so late GPS results are dropped. */
  private readonly seq: Record<PlanRole, number> = { start: 0, end: 0 }
  /** Roles with a name lookup in flight (`resolvePoint`); any one keeps the "searching" status. */
  private readonly resolving: Record<PlanRole, boolean> = { start: false, end: false }
  /** Failed lookups; survives other roles' successes, cleared by the next user action on that role. */
  private readonly notFound: Record<PlanRole, string | null> = { start: null, end: null }
  private mode: TravelMode
  private opened = false
  private busy = false
  private abort: AbortController | null = null
  /** Bumped on every run start and on close, so stale results are ignored. */
  private runToken = 0
  private pickRole: PlanRole | null = null
  private pickCancel: (() => void) | null = null
  /** Bumped when a pick starts or ends; a stale `done` carries an old value. */
  private pickToken = 0

  constructor(container: HTMLElement, private readonly deps: RoutePlannerDeps) {
    this.panel = clone(panelHtml)
    this.full = ref(this.panel, 'full')
    this.pickRow = ref(this.panel, 'pick')
    this.pickText = ref(this.panel, 'pickText')
    this.goBtn = ref(this.panel, 'go')
    this.swapBtn = ref(this.panel, 'swap')
    this.statusEl = ref(this.panel, 'status')
    this.modeBtns = [...this.panel.querySelectorAll<HTMLButtonElement>('[data-mode]')]
    this.mode = deps.initialMode()

    this.ui = { start: this.buildRole('start'), end: this.buildRole('end') }

    this.swapBtn.addEventListener('click', () => this.swap())
    this.goBtn.addEventListener('click', () => { void this.run() })
    ref(this.panel, 'pickCancel').addEventListener('click', () => this.cancelPick())
    for (const btn of this.modeBtns) {
      btn.addEventListener('click', () => this.setMode(btn.dataset.mode as TravelMode))
      btn.addEventListener('keydown', e => this.onModeKey(e, btn))
    }
    const importLink = ref<HTMLButtonElement>(this.panel, 'importLink')
    const { onOpenImport } = deps
    importLink.hidden = !onOpenImport
    if (onOpenImport) importLink.addEventListener('click', () => onOpenImport())
    container.appendChild(this.panel)
    this.renderMode()
    this.updateGo()

    this.events.on(document, 'keydown', e => { if (e.key === 'Escape' && this.opened) this.onEscape() })
  }

  isOpen(): boolean { return this.opened }
  pickingRole(): PlanRole | null { return this.pickRole }

  open(prefill?: { readonly role: PlanRole; readonly point: PlanPoint }): void {
    if (!this.opened) {
      this.opened = true
      this.mode = this.deps.initialMode()
      this.renderMode()
      this.setStatus('')
      this.panel.hidden = false
    }
    if (prefill) this.setPoint(prefill.role, prefill.point)
  }

  close(): void {
    const wasOpen = this.opened
    this.runToken++
    this.abort?.abort()
    this.abort = null
    // Late lookup/locate results must not land in a reopened panel.
    this.touch('start')
    this.touch('end')
    this.setBusy(false)
    this.endPick(true)
    this.setStatus('')
    for (const role of ['start', 'end'] as const) this.ui[role].field.closeList()
    this.opened = false
    this.panel.hidden = true
    if (wasOpen) this.deps.onClose?.()
  }

  /** Fokussiert das erste Feld, das noch Eingabe braucht: Start, Ziel, sonst „Route berechnen“. */
  focusFirstEmpty(): void {
    if (!this.points.start) this.ui.start.input.focus()
    else if (!this.points.end) this.ui.end.input.focus()
    else this.goBtn.focus()
  }

  /** Setzt oder leert (null) einen Punkt von außen, z. B. aus dem POI-Detail. */
  setPoint(role: PlanRole, point: PlanPoint | null): void {
    // Ein laufender Pick für diese Rolle ist damit überholt.
    if (this.pickRole === role) this.endPick(true)
    this.touch(role)
    this.ui[role].field.setText(point?.label ?? '')
    this.applyPoint(role, point)
  }

  /** Verkehrsmittel von außen setzen (z. B. aus einem KI-Routenwunsch). */
  selectMode(mode: TravelMode): void { this.setMode(mode) }

  /**
   * Belegt ein Feld mit einem Ortsnamen vor und löst ihn asynchron auf.
   * Tippen, setPoint, Pick, Standort, Tauschen oder Schließen verwerfen das Ergebnis.
   */
  async resolvePoint(role: PlanRole, text: string, resolve: () => Promise<PlanPoint | null>): Promise<void> {
    if (this.pickRole === role) this.endPick(true)
    this.touch(role)
    const my = this.seq[role]
    this.resolving[role] = true
    this.ui[role].field.setText(text)
    this.applyPoint(role, null)
    let point: PlanPoint | null
    try { point = await resolve() } catch { point = null }
    if (my !== this.seq[role]) return
    this.resolving[role] = false
    if (!this.opened) return
    if (!point) {
      this.notFound[role] = `„${text}“ nicht gefunden – bitte ${ROLE_NAME[role]} wählen`
      this.refreshStatus()
      return
    }
    this.ui[role].field.setText(point.label)
    this.applyPoint(role, point)
  }

  destroy(): void {
    this.runToken++
    this.abort?.abort()
    this.abort = null
    this.touch('start')
    this.touch('end')
    this.endPick(true)
    this.events.dispose()
    for (const role of ['start', 'end'] as const) this.ui[role].field.destroy()
    this.panel.remove()
    this.opened = false
  }

  private buildRole(role: PlanRole): RoleUi {
    const input = ref<HTMLInputElement>(this.panel, `${role}Input`)
    const field = new PlaceField(input, ref(this.panel, `${role}List`), {
      name: ROLE_NAME[role],
      suggest: q => this.deps.suggest(q),
      onSelect: s => {
        this.touch(role)
        const label = shortPlaceLabel(s.label)
        this.ui[role].field.setText(label)
        this.applyPoint(role, { lat: s.lat, lon: s.lon, label, kind: 'place' })
      },
      onInvalidate: () => {
        this.touch(role)
        this.applyPoint(role, null)
      },
    })
    const locateBtn = ref<HTMLButtonElement>(this.panel, `${role}Locate`)
    const pickBtn = ref<HTMLButtonElement>(this.panel, `${role}Pick`)
    locateBtn.addEventListener('click', () => { void this.locate(role) })
    pickBtn.addEventListener('click', () => this.startPick(role))
    return { field, input, locateBtn, pickBtn }
  }

  /** State + UI nach einer Punktänderung; benachrichtigt nur bei echter Änderung. */
  private applyPoint(role: PlanRole, point: PlanPoint | null): void {
    const changed = this.points[role] !== point
    this.points[role] = point
    this.refreshStatus()
    this.updateGo()
    if (changed) this.deps.onPointsChange?.(this.points.start, this.points.end)
  }

  private async locate(role: PlanRole): Promise<void> {
    if (this.busy) return
    this.touch(role)
    const my = this.seq[role]
    this.setStatus('Standort wird ermittelt…')
    let pos: { lat: number; lon: number } | null
    try { pos = await this.deps.locate() } catch { pos = null }
    if (my !== this.seq[role]) return
    if (!pos) { this.setStatus(LOCATE_UNAVAILABLE, true); return }
    this.ui[role].field.setText('Mein Standort')
    this.applyPoint(role, { lat: pos.lat, lon: pos.lon, label: 'Mein Standort', kind: 'gps' })
  }

  private startPick(role: PlanRole): void {
    if (this.busy) return
    // Ein laufender Pick (auch der andere Rolle) wird abgelöst.
    this.endPick(true)
    this.touch(role)
    const my = ++this.pickToken
    this.pickRole = role
    this.renderPick()
    const cancel = this.deps.pickOnMap(pos => {
      if (my !== this.pickToken) return
      // done(null) beendet nur den Pick-Modus; das Feld bleibt, wie es ist.
      this.endPick(false)
      if (!pos) return
      this.touch(role)
      this.ui[role].field.setText('Kartenpunkt')
      this.applyPoint(role, { lat: pos.lat, lon: pos.lon, label: 'Kartenpunkt', kind: 'map' })
    })
    // done kann synchron gefeuert haben; dann ist die Abbruchfunktion überflüssig.
    if (my === this.pickToken && this.pickRole === role) this.pickCancel = cancel
  }

  private cancelPick(): void { this.endPick(true) }

  /** Beendet den Pick-Modus; `invokeCancel` ruft die Abbruchfunktion des Aufrufers. */
  private endPick(invokeCancel: boolean): void {
    const cancel = this.pickCancel
    const wasPicking = this.pickRole !== null
    this.pickToken++
    this.pickRole = null
    this.pickCancel = null
    if (wasPicking) this.renderPick()
    if (invokeCancel) cancel?.()
  }

  private renderPick(): void {
    const role = this.pickRole
    const picking = role !== null
    this.full.hidden = picking
    this.pickRow.hidden = !picking
    if (role) this.pickText.textContent = `${ROLE_NAME[role]} auf der Karte antippen`
  }

  private swap(): void {
    if (this.busy) return
    this.endPick(true)
    const { start, end } = this.ui
    const startText = start.field.getText()
    const endText = end.field.getText()
    const a = this.points.start
    const b = this.points.end
    this.touch('start')
    this.touch('end')
    start.field.setText(endText)
    end.field.setText(startText)
    this.points.start = b
    this.points.end = a
    this.refreshStatus()
    this.updateGo()
    if (a !== b) this.deps.onPointsChange?.(this.points.start, this.points.end)
  }

  private setMode(mode: TravelMode): void {
    if (this.busy || !TRAVEL_MODES.includes(mode)) return
    const changed = mode !== this.mode
    this.mode = mode
    this.renderMode()
    if (changed) this.deps.onModeChange?.(mode)
  }

  private renderMode(): void {
    for (const btn of this.modeBtns) {
      const on = btn.dataset.mode === this.mode
      btn.setAttribute('aria-checked', String(on))
      btn.tabIndex = on ? 0 : -1
    }
  }

  private onModeKey(e: KeyboardEvent, btn: HTMLButtonElement): void {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (dir === 0) return
    e.preventDefault()
    const i = this.modeBtns.indexOf(btn)
    const next = this.modeBtns[(i + dir + this.modeBtns.length) % this.modeBtns.length]
    if (!next) return
    this.setMode(next.dataset.mode as TravelMode)
    next.focus()
  }

  private async run(): Promise<void> {
    const { start, end } = this.points
    if (this.busy || !start || !end) return
    const ctrl = new AbortController()
    const my = ++this.runToken
    this.abort = ctrl
    this.setBusy(true)
    this.setStatus('Route wird berechnet…')
    try {
      await this.deps.plan({ start, end, mode: this.mode }, ctrl.signal)
      if (my !== this.runToken) return
      this.abort = null
      this.close()
    } catch (err) {
      if (my !== this.runToken) return
      this.abort = null
      this.setBusy(false)
      const aborted = ctrl.signal.aborted || (err instanceof Error && err.name === 'AbortError')
      if (aborted) this.setStatus('')
      else this.setStatus(this.deps.describeError(err), true)
    }
  }

  private setBusy(busy: boolean): void {
    this.busy = busy
    for (const role of ['start', 'end'] as const) {
      const u = this.ui[role]
      u.field.setDisabled(busy)
      u.locateBtn.disabled = busy
      u.pickBtn.disabled = busy
    }
    this.swapBtn.disabled = busy
    for (const btn of this.modeBtns) btn.disabled = busy
    this.updateGo()
  }

  private updateGo(): void {
    this.goBtn.disabled = this.busy || !this.points.start || !this.points.end
  }

  /** Any user action on a role drops its pending lookup/locate result and its "not found" message. */
  private touch(role: PlanRole): void {
    this.seq[role]++
    this.resolving[role] = false
    this.notFound[role] = null
  }

  /** Standardstatus: Suche läuft > Fehler gescheiterter Auflösungen > leer. Während der Berechnung unberührt. */
  private refreshStatus(): void {
    if (this.busy) return
    if (this.resolving.start || this.resolving.end) { this.setStatus(RESOLVING); return }
    const errors = (['start', 'end'] as const).flatMap(r => this.notFound[r] ?? [])
    this.setStatus(errors.join(' · '), errors.length > 0)
  }

  private setStatus(msg: string, isError = false): void {
    this.statusEl.textContent = msg
    this.statusEl.classList.toggle('planner-status-error', isError)
  }

  /** Esc: erst Vorschlagsliste, dann Pick, dann Panel. */
  private onEscape(): void {
    let closedList = false
    for (const role of ['start', 'end'] as const) {
      if (this.ui[role].field.closeList()) closedList = true
    }
    if (closedList) return
    if (this.pickRole) { this.cancelPick(); return }
    this.close()
  }
}
