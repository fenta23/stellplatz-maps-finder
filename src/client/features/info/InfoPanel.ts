import './info.css'
import { clone, ref } from '@/core/template.js'
import { createEventScope, type EventScope } from '@/core/events.js'
import panelHtml from './infoPanel.html?raw'
import changelogRaw from '../../../../CHANGELOG.md?raw'

const VERSION = '0.9.1'

// DSGVO-Verantwortlicher: per Build-Env injiziert (GitHub Secret), damit der
// Klarname nicht im öffentlichen Repo steht. Auf der Live-Seite ist er sichtbar
// (rechtlich erforderlich), nur eben nicht in der Git-History.
const CONTROLLER = import.meta.env.VITE_DSGVO_VERANTWORTLICHER ?? 'der Betreiber dieser App'

/** Render the KAC-style markdown changelog into basic HTML. */
function renderChangelog(md: string): string {
  const out: string[] = []
  let inUl = false

  const closeUl = () => {
    if (inUl) { out.push('</ul>'); inUl = false }
  }

  for (const line of md.split('\n')) {
    if (/^##\s/.test(line)) {
      closeUl()
      const title = line.replace(/^##\s+/, '').replace(/[`*]/g, '')
      if (title) out.push(`<h4>${title === '[Unreleased]' ? 'Aktuelle Version' : title}</h4>`)
    } else if (/^###\s/.test(line)) {
      closeUl()
      out.push(`<h5>${line.replace(/^###\s+/, '')}</h5>`)
      out.push('<ul>')
      inUl = true
    } else if (/^-\s/.test(line)) {
      out.push(`<li>${line.replace(/^- /, '')}</li>`)
    }
  }
  closeUl()
  return out.join('\n')
}

export class InfoPanel {
  private readonly panel: HTMLElement
  private readonly events: EventScope = createEventScope()

  constructor(container: HTMLElement) {
    this.panel = clone(panelHtml)
    ref(this.panel, 'version').textContent = `v${VERSION}`
    this.panel.querySelectorAll('[data-ref="controller"]').forEach(el => { el.textContent = CONTROLLER })
    ref(this.panel, 'changelog').innerHTML = renderChangelog(changelogRaw)
    this.panel.querySelector('.fav-close')?.addEventListener('click', () => this.close())
    // Klick auf den Backdrop (nur im Desktop-Modal sichtbar) schließt ebenfalls.
    this.panel.addEventListener('click', e => { if (e.target === this.panel) this.close() })
    container.appendChild(this.panel)

    this.events.on(document, 'keydown', e => { if (e.key === 'Escape' && this.isOpen()) this.close() })
  }

  /** Stand der POI-Kacheln (manifest.date, YYYY-MM-DD) in der Kartendaten-Attribution. */
  setPoiDataDate(date: string): void {
    const [y, m, d] = date.split('-')
    ref(this.panel, 'poi-data-date').textContent = y && m && d ? `, Stand ${d}.${m}.${y}` : ''
  }

  isOpen(): boolean { return this.panel.classList.contains('open') }

  open(): void { this.panel.classList.add('open') }

  close(): void { this.panel.classList.remove('open') }
  destroy(): void { this.events.dispose() }
}
