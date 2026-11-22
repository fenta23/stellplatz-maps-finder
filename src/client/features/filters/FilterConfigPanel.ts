import { clone, ref } from '@/core/template.js'
import { createEventScope, type EventScope } from '@/core/events.js'
import { generateCustomId } from '@/features/custom-pois/CustomPoi.js'
import {
  FILTER_ICONS, FILTER_COLORS, FILTER_TEMPLATES, ALL_ELEMENT_KINDS,
  filterIconSvg, isValidSelector, MAX_SELECTOR_CONDITIONS,
  type FilterDef, type OsmElementKind, type TagCondition,
} from './filterModel.js'
import type { IFilterStore } from './FilterStore.js'
import panelHtml from './filterConfigPanel.html?raw'

const ICON = (paths: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`
const PENCIL = ICON('<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>')
const TRASH = ICON('<path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>')
const RESET = ICON('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>')
const XMARK = ICON('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>')
const PROFILE_ICON = ICON('<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>')
const PLUS = ICON('<path d="M5 12h14"/><path d="M12 5v14"/>')

const ELEMENT_LABEL: Record<OsmElementKind, string> = { node: 'Punkt', way: 'Fläche', relation: 'Relation' }
const COMMON_KEYS = ['amenity', 'shop', 'tourism', 'leisure', 'sport', 'natural', 'highway', 'man_made', 'historic']

/** Tag-Bedingung, die der Editor beim Tippen direkt ändert. */
type EditableTag = { -readonly [K in keyof TagCondition]: TagCondition[K] }

interface EditorState {
  name: string
  iconId: string
  color: string
  elements: Set<OsmElementKind>
  tags: EditableTag[]
}

export class FilterConfigPanel {
  private readonly panel: HTMLElement
  private readonly body: HTMLElement
  private readonly events: EventScope = createEventScope()
  private mode: 'list' | 'editor' = 'list'

  constructor(
    container: HTMLElement,
    private readonly store: IFilterStore,
    private readonly deps: { readonly onOpenProfiles?: () => void } = {},
  ) {
    this.panel = clone(panelHtml)
    this.body = ref(this.panel, 'body')
    this.panel.querySelector('.fav-close')?.addEventListener('click', () => this.close())
    // Klick auf den Backdrop (nur im Desktop-Modal sichtbar) schließt ebenfalls.
    this.panel.addEventListener('click', e => { if (e.target === this.panel) this.close() })
    container.appendChild(this.panel)
    this.events.on(document, 'keydown', e => { if (e.key === 'Escape' && this.isOpen()) this.close() })
    this.store.onChange(() => { if (this.isOpen() && this.mode === 'list') this.renderList() })
  }

  isOpen(): boolean { return this.panel.classList.contains('open') }
  open(): void { this.renderList(); this.panel.classList.add('open') }
  close(): void { this.panel.classList.remove('open') }
  destroy(): void { this.events.dispose() }

  // ── List view ──────────────────────────────────────────────────────────────

  private renderList(): void {
    this.mode = 'list'
    this.body.innerHTML = ''
    const { onOpenProfiles } = this.deps
    if (onOpenProfiles) {
      const profileBtn = el('button', 'fc-add-btn fc-profile-btn', `${PROFILE_ICON} <span>Profil wählen: Wandern, Radfahren, Camping</span>`)
      profileBtn.addEventListener('click', () => { this.close(); onOpenProfiles() })
      this.body.appendChild(profileBtn)
    }
    const list = document.createElement('div')
    list.className = 'fc-list'
    for (const f of this.store.list()) list.appendChild(this.buildListRow(f))
    this.body.appendChild(list)
    const addBtn = el('button', 'fc-add-btn', `${PLUS} <span>Neuen Filter anlegen</span>`)
    addBtn.addEventListener('click', () => this.openEditor(null))
    this.body.appendChild(addBtn)
  }

  private buildListRow(f: FilterDef): HTMLElement {
    const row = el('div', 'fc-row')
    row.dataset['filterId'] = f.id

    const swatch = el('span', 'fc-swatch')
    swatch.style.background = f.color
    swatch.innerHTML = filterIconSvg(f.iconId)
    row.appendChild(swatch)

    const name = el('span', 'fc-name')
    name.textContent = f.name
    if (!f.builtin) {
      const badge = el('span', 'fc-badge')
      badge.textContent = 'eigen'
      name.appendChild(badge)
    }
    row.appendChild(name)

    const toggle = el('label', 'fc-switch')
    toggle.title = 'In Filterleiste anzeigen'
    const cb = el<HTMLInputElement>('input')!
    cb.type = 'checkbox'; cb.checked = !f.hidden
    cb.setAttribute('aria-label', `${f.name} in Leiste anzeigen`)
    cb.addEventListener('change', () => this.store.setHidden(f.id, !cb.checked))
    const slider = el('span', 'fc-slider')
    toggle.append(cb, slider)
    row.appendChild(toggle)

    const edit = el('button', 'fc-icon-btn')
    edit.innerHTML = PENCIL; edit.title = 'Bearbeiten'
    edit.setAttribute('aria-label', `${f.name} bearbeiten`)
    edit.addEventListener('click', () => this.openEditor(f))
    row.appendChild(edit)

    const del = el('button', 'fc-icon-btn fc-danger')
    if (f.builtin) {
      del.innerHTML = RESET; del.title = 'Auf Standard zurücksetzen'
      del.addEventListener('click', () => this.store.remove(f.id))
    } else {
      del.innerHTML = TRASH; del.title = 'Filter löschen'
      del.addEventListener('click', () => { if (confirm(`Filter „${f.name}" löschen?`)) this.store.remove(f.id) })
    }
    del.setAttribute('aria-label', del.title)
    row.appendChild(del)
    return row
  }

  // ── Editor view ────────────────────────────────────────────────────────────

  private openEditor(existing: FilterDef | null): void {
    this.mode = 'editor'
    const sel = existing?.selectors[0]
    const state: EditorState = {
      name: existing?.name ?? '',
      iconId: existing?.iconId ?? FILTER_ICONS[0]!.id,
      color: existing?.color ?? FILTER_COLORS[0]!,
      elements: new Set<OsmElementKind>(sel?.elements ?? ['node', 'way']),
      tags: sel ? sel.tags.map(t => ({ ...t })) : [{ key: '', value: '' }],
    }
    const tagsEditable = (!existing || (!existing.builtin && existing.kind === 'osm'))
    this.buildEditorForm(existing, state, tagsEditable)
  }

  private buildEditorForm(existing: FilterDef | null, state: EditorState, tagsEditable: boolean): void {
    this.body.innerHTML = ''
    const form = el('div', 'fc-editor')

    const heading = el('h3', 'fc-editor-title')
    heading.textContent = existing ? `„${existing.name}" bearbeiten` : 'Neuer Filter'
    form.appendChild(heading)

    const error = el('p', 'fc-error')
    error.hidden = true
    form.appendChild(error)

    if (!existing) form.appendChild(this.buildTemplates(form, state, existing, tagsEditable))
    form.appendChild(this.buildNameField(state))
    form.appendChild(this.buildAppearance(state))
    if (tagsEditable) form.appendChild(this.buildTagsSection(state))
    else { const note = el('p', 'fc-note'); note.textContent = 'Name, Icon und Farbe sind anpassbar. Die OSM-Tags dieses Filters sind fest.'; form.appendChild(note) }
    form.appendChild(this.buildActions(existing, state, tagsEditable, error))
    form.appendChild(this.buildKeysDatalist())

    this.body.appendChild(form)
  }

  private buildTemplates(form: HTMLElement, state: EditorState, existing: FilterDef | null, tagsEditable: boolean): HTMLElement {
    const wrap = el('div', 'fc-field')
    wrap.innerHTML = '<label>Vorlage (optional)</label>'
    const gallery = el('div', 'fc-templates')
    for (const t of FILTER_TEMPLATES) {
      const b = el('button', 'fc-template')
      b.innerHTML = `<span class="fc-swatch" style="background:${t.color}">${filterIconSvg(t.iconId)}</span><span>${t.name}</span>`
      b.addEventListener('click', () => {
        state.name = t.name; state.iconId = t.iconId; state.color = t.color
        state.elements = new Set(t.selectors[0]!.elements)
        state.tags = t.selectors[0]!.tags.map(x => ({ ...x }))
        this.buildEditorForm(existing, state, tagsEditable)
      })
      gallery.appendChild(b)
    }
    wrap.appendChild(gallery)
    return wrap
  }

  private buildNameField(state: EditorState): HTMLElement {
    const field = el('div', 'fc-field')
    field.innerHTML = '<label for="fc-name">Name</label>'
    const input = el<HTMLInputElement>('input', 'fc-input')!
    input.id = 'fc-name'; input.type = 'text'; input.value = state.name
    input.placeholder = 'z. B. Tankstelle'
    input.addEventListener('input', () => { state.name = input.value })
    field.appendChild(input)
    return field
  }

  private buildAppearance(state: EditorState): HTMLElement {
    const wrap = el('div')
    const updatePreview = () => { preview.style.background = state.color; preview.innerHTML = filterIconSvg(state.iconId) }

    const appearance = el('div', 'fc-appearance')
    const preview = el('span', 'fc-preview fc-swatch')
    updatePreview()
    appearance.appendChild(preview)

    const iconWrap = el('div', 'fc-field fc-grow')
    iconWrap.innerHTML = '<label>Icon</label>'
    const grid = el('div', 'fc-icon-grid')
    for (const ic of FILTER_ICONS) {
      const b = el('button', `fc-icon-opt ${ic.id === state.iconId ? 'selected' : ''}`)
      b.dataset['iconId'] = ic.id; b.title = ic.label
      b.innerHTML = filterIconSvg(ic.id)
      b.addEventListener('click', () => {
        state.iconId = ic.id
        grid.querySelectorAll('.fc-icon-opt').forEach(x => x.classList.remove('selected'))
        b.classList.add('selected')
        updatePreview()
      })
      grid.appendChild(b)
    }
    iconWrap.appendChild(grid)
    appearance.appendChild(iconWrap)
    wrap.appendChild(appearance)

    const colorField = el('div', 'fc-field')
    colorField.innerHTML = '<label>Farbe</label>'
    const colorRow = el('div', 'fc-colors')
    for (const c of FILTER_COLORS) {
      const b = el('button', `fc-color ${c === state.color ? 'selected' : ''}`)
      b.style.background = c; b.dataset['color'] = c; b.setAttribute('aria-label', c)
      b.addEventListener('click', () => {
        state.color = c
        colorRow.querySelectorAll('.fc-color').forEach(x => x.classList.remove('selected'))
        b.classList.add('selected')
        updatePreview()
      })
      colorRow.appendChild(b)
    }
    colorField.appendChild(colorRow)
    wrap.appendChild(colorField)
    return wrap
  }

  private buildTagsSection(state: EditorState): HTMLElement {
    const field = el('div', 'fc-field')
    field.innerHTML = '<label>OSM-Objekte</label>'

    const kinds = el('div', 'fc-kinds')
    for (const k of ALL_ELEMENT_KINDS) {
      const lab = el('label', 'fc-kind')
      const cb = el<HTMLInputElement>('input')!
      cb.type = 'checkbox'; cb.checked = state.elements.has(k)
      cb.addEventListener('change', () => { cb.checked ? state.elements.add(k) : state.elements.delete(k) })
      lab.append(cb, document.createTextNode(' ' + ELEMENT_LABEL[k]))
      kinds.appendChild(lab)
    }
    field.appendChild(kinds)

    const tagsLabel = el('label')
    tagsLabel.textContent = 'Tag-Bedingungen'
    field.appendChild(tagsLabel)

    const rows = el('div', 'fc-tags')
    field.appendChild(rows)
    const renderRows = () => {
      rows.innerHTML = ''
      state.tags.forEach((cond, i) => {
        const r = el('div', 'fc-tag-row')
        const key = el<HTMLInputElement>('input', 'fc-input')!
        key.placeholder = 'Schlüssel (z. B. amenity)'; key.value = cond.key
        key.setAttribute('list', 'fc-keys')
        key.addEventListener('input', () => { cond.key = key.value.trim() })
        const op = el('button', 'fc-op')
        op.textContent = cond.negate ? '≠' : '='
        op.title = 'Gleich / ungleich umschalten'
        op.addEventListener('click', () => { cond.negate = !cond.negate; op.textContent = cond.negate ? '≠' : '=' })
        const val = el<HTMLInputElement>('input', 'fc-input')!
        val.placeholder = 'Wert (leer = beliebig)'; val.value = cond.value
        val.addEventListener('input', () => { cond.value = val.value.trim() })
        const rm = el('button', 'fc-icon-btn fc-danger')
        rm.innerHTML = XMARK; rm.title = 'Bedingung entfernen'
        rm.addEventListener('click', () => { state.tags.splice(i, 1); if (state.tags.length === 0) state.tags.push({ key: '', value: '' }); renderRows() })
        r.append(key, op, val, rm)
        rows.appendChild(r)
      })
    }
    renderRows()

    const addRow = el('button', 'fc-add-row', `${PLUS} <span>Bedingung</span>`)
    addRow.addEventListener('click', () => { if (state.tags.length < MAX_SELECTOR_CONDITIONS) { state.tags.push({ key: '', value: '' }); renderRows() } })
    field.appendChild(addRow)
    return field
  }

  private buildActions(existing: FilterDef | null, state: EditorState, tagsEditable: boolean, error: HTMLElement): HTMLElement {
    const actions = el('div', 'fc-actions')
    const cancel = el('button', 'fc-btn')
    cancel.textContent = 'Abbrechen'
    cancel.addEventListener('click', () => this.renderList())
    const save = el('button', 'fc-btn fc-btn-primary')
    save.textContent = 'Speichern'
    save.addEventListener('click', () => this.save(existing, state, tagsEditable, error))
    actions.append(cancel, save)
    return actions
  }

  private buildKeysDatalist(): HTMLElement {
    const datalist = el('datalist')
    datalist.id = 'fc-keys'
    for (const k of COMMON_KEYS) { const o = el<HTMLOptionElement>('option'); o.value = k; datalist.appendChild(o) }
    return datalist
  }

  private save(existing: FilterDef | null, state: EditorState, tagsEditable: boolean, error: HTMLElement): void {
    const fail = (msg: string) => { error.textContent = msg; error.hidden = false }
    if (!state.name.trim()) return fail('Bitte einen Namen eingeben.')
    let selectors = existing?.selectors ?? []
    if (tagsEditable) {
      const tags = state.tags.filter(t => t.key.length > 0)
      const selector = { elements: [...state.elements], tags }
      if (!isValidSelector(selector)) {
        return fail('Bitte mindestens ein OSM-Objekt und eine gültige Tag-Bedingung angeben (Schlüssel/Werte ohne Leerzeichen).')
      }
      selectors = [selector]
    }
    this.store.put({
      id: existing?.id ?? generateCustomId(),
      name: state.name.trim(),
      iconId: state.iconId,
      color: state.color,
      enabled: existing?.enabled ?? true,
      kind: existing?.kind ?? 'osm',
      builtin: existing?.builtin ?? false,
      order: existing?.order ?? this.nextOrder(),
      selectors,
    })
    this.renderList()
  }

  private nextOrder(): number {
    return Math.max(0, ...this.store.list().map(f => f.order)) + 1
  }
}

// ── Tiny DOM helper ──────────────────────────────────────────────────────────
function el<T extends HTMLElement = HTMLElement>(tag: string, className = '', innerHTML = ''): T {
  const e = document.createElement(tag) as T
  if (className) e.className = className
  if (innerHTML) e.innerHTML = innerHTML
  return e
}
