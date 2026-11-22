import { cloneFragment, ref } from '@/core/template.js'
import { CUSTOM_POI_ICONS, generateCustomId } from './CustomPoi.js'
import type { CustomPoi, CustomPoiInput } from './CustomPoi.js'
import editorHtml from './customPoiEditor.html?raw'

interface EditorResult {
  readonly poi: CustomPoi
  readonly action: 'save' | 'delete'
}

export class CustomPoiEditor {
  private pendingLat = 0
  private pendingLon = 0

  constructor(private readonly container: HTMLElement) {}

  /** Open the editor for a new POI at the given position. Returns null if cancelled. */
  openNew(lat: number, lon: number): Promise<CustomPoi | null> {
    this.pendingLat = lat
    this.pendingLon = lon
    return new Promise(resolve => {
      const view = this.render('Ort hinzufügen')
      this.populatePosition(view, lat, lon)
      this.wireEvents(view, null, result => {
        resolve(result ? result.poi : null)
      })
    })
  }

  /** Open the editor for an existing POI. Returns updated POI or null on cancel. */
  openEdit(poi: CustomPoi): Promise<CustomPoi | null> {
    this.pendingLat = poi.lat
    this.pendingLon = poi.lon
    return new Promise(resolve => {
      const view = this.render('Ort bearbeiten')
      this.populateExisting(view, poi)
      this.wireEvents(view, poi, result => {
        resolve(result ? result.poi : null)
      })
    })
  }

  private render(title: string): DocumentFragment {
    const view = cloneFragment(editorHtml)
    ref(view, 'editorTitle').textContent = title
    this.renderIconPicker(view)
    return view
  }

  private renderIconPicker(view: DocumentFragment): void {
    const container = ref(view, 'iconPicker')
    for (const icon of CUSTOM_POI_ICONS) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'icon-opt'
      btn.dataset['iconId'] = icon.id
      btn.title = icon.label
      btn.setAttribute('aria-label', icon.label)
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon.path}</svg>`
      container.appendChild(btn)
    }
  }

  private populatePosition(view: DocumentFragment, lat: number, lon: number): void {
    ref(view, 'posLat').textContent = lat.toFixed(5)
    ref(view, 'posLon').textContent = lon.toFixed(5)
    ref(view, 'positionDisplay').style.display = ''
  }

  private populateExisting(view: DocumentFragment, poi: CustomPoi): void {
    this.populatePosition(view, poi.lat, poi.lon)
    this.setIconSelected(view, poi.iconId)
    this.setField(view, 'name', poi.name)
    this.setField(view, 'street', poi.street ?? '')
    this.setField(view, 'housenumber', poi.housenumber ?? '')
    this.setField(view, 'postcode', poi.postcode ?? '')
    this.setField(view, 'city', poi.city ?? '')
    this.setField(view, 'phone', poi.phone ?? '')
    this.setField(view, 'email', poi.email ?? '')
    this.setField(view, 'website', poi.website ?? '')
    this.setField(view, 'fee', poi.fee ?? '')
    this.setField(view, 'capacity', poi.capacity ?? '')
    this.setField(view, 'openingHours', poi.openingHours ?? '')
    this.setField(view, 'operator', poi.operator ?? '')
    this.setField(view, 'description', poi.description ?? '')
    this.setField(view, 'note', poi.note ?? '')
  }

  private wireEvents(view: DocumentFragment, existing: CustomPoi | null, onDone: (result: EditorResult | null) => void): void {
    this.container.appendChild(view)

    const root = this.container
    const panel = root.querySelector<HTMLElement>('.custom-poi-editor')!
    const q = <T extends HTMLElement>(sel: string) => panel.querySelector<T>(sel)

    const cleanup = () => {
      root.querySelector('.modal-backdrop')?.remove()
      panel.remove()
    }

    const getVal = (name: string): string =>
      (q<HTMLInputElement | HTMLTextAreaElement>(`[data-ref="${name}"]`)?.value ?? '').trim()

    const handleSave = () => {
      const iconId = q<HTMLButtonElement>('.icon-opt.selected')?.dataset['iconId']
      const name = getVal('name')
      if (!iconId) { flashError('Bitte ein Icon auswählen'); return }
      if (!name) { flashError('Bitte einen Namen eingeben'); return }

      const lat = existing?.lat ?? this.pendingLat
      const lon = existing?.lon ?? this.pendingLon

      const now = Date.now()
      const input: CustomPoiInput = {
        iconId, name, lat, lon,
        street: getVal('street') || undefined,
        housenumber: getVal('housenumber') || undefined,
        postcode: getVal('postcode') || undefined,
        city: getVal('city') || undefined,
        phone: getVal('phone') || undefined,
        email: getVal('email') || undefined,
        website: getVal('website') || undefined,
        fee: getVal('fee') || undefined,
        capacity: getVal('capacity') || undefined,
        openingHours: getVal('openingHours') || undefined,
        operator: getVal('operator') || undefined,
        description: getVal('description') || undefined,
        note: getVal('note') || undefined,
      }

      const poi: CustomPoi = existing
        ? { ...existing, ...input, updatedAt: now }
        : { id: generateCustomId(), ...input, createdAt: now, updatedAt: now }

      cleanup()
      onDone({ poi, action: 'save' })
    }

    const flashError = (msg: string) => {
      let el = q<HTMLElement>('.editor-error')
      if (!el) {
        el = document.createElement('p')
        el.className = 'editor-error'
        q<HTMLElement>('.editor-header')?.after(el)
      }
      el.textContent = msg
    }

    q<HTMLButtonElement>('[data-ref="saveBtn"]')?.addEventListener('click', handleSave)
    q<HTMLButtonElement>('[data-ref="cancelBtn"]')?.addEventListener('click', () => { cleanup(); onDone(null) })

    // Icon selection
    panel.querySelectorAll('.icon-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        panel.querySelectorAll('.icon-opt').forEach(b => b.classList.remove('selected'))
        btn.classList.add('selected')
      })
    })

    // Close on Escape
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { cleanup(); onDone(null); document.removeEventListener('keydown', keyHandler) }
    }
    document.addEventListener('keydown', keyHandler)

    // Close button
    q<HTMLButtonElement>('[data-ref="closeBtn"]')?.addEventListener('click', () => { cleanup(); onDone(null) })

    // Close on backdrop click
    root.querySelector('.modal-backdrop')?.addEventListener('click', () => { cleanup(); onDone(null) })
  }

  private setIconSelected(view: DocumentFragment, iconId: string): void {
    const btn = view.querySelector<HTMLButtonElement>(`.icon-opt[data-icon-id="${iconId}"]`)
    if (btn) btn.classList.add('selected')
  }

  private setField(view: DocumentFragment, name: string, value: string): void {
    const el = view.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-ref="${name}"]`)
    if (el) el.value = value
  }
}
