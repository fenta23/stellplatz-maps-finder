import './whatsNew.css'
import { clone, ref } from '@/core/template.js'
import { createEventScope, type EventScope } from '@/core/events.js'
import { FILTER_COLORS } from '@/features/filters/filterModel.js'
import overlayHtml from './whatsNewOverlay.html?raw'

export const CONFETTI_COUNT = 60

export interface WhatsNewOptions {
  readonly onDismiss?: () => void
  readonly random?: () => number
  readonly confettiCount?: number
}

export class WhatsNewOverlay {
  private readonly root: HTMLElement
  private readonly confetti: HTMLElement
  private readonly button: HTMLButtonElement
  private readonly events: EventScope = createEventScope()
  private readonly random: () => number

  constructor(container: HTMLElement, private readonly opts: WhatsNewOptions = {}) {
    this.random = opts.random ?? Math.random
    this.root = clone(overlayHtml)
    this.confetti = ref(this.root, 'confetti')
    this.button = ref<HTMLButtonElement>(this.root, 'close')
    this.button.addEventListener('click', () => this.dismiss())
    this.root.addEventListener('click', e => { if (e.target === this.root) this.dismiss() })
    container.appendChild(this.root)
    this.events.on(document, 'keydown', e => { if (e.key === 'Escape' && this.isOpen()) this.dismiss() })
  }

  isOpen(): boolean { return this.root.classList.contains('open') }

  open(): void {
    this.root.classList.add('open')
    this.button.focus()
    if (!this.prefersReducedMotion()) this.launchConfetti()
  }

  private dismiss(): void {
    if (!this.isOpen()) return
    this.root.classList.remove('open')
    this.confetti.replaceChildren()
    this.opts.onDismiss?.()
  }

  destroy(): void { this.events.dispose(); this.root.remove() }

  private prefersReducedMotion(): boolean {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  private launchConfetti(): void {
    const r = this.random
    const count = this.opts.confettiCount ?? CONFETTI_COUNT
    const pieces: HTMLElement[] = []
    for (let i = 0; i < count; i++) {
      const p = document.createElement('span')
      p.className = r() < 0.35 ? 'confetti-piece round' : 'confetti-piece'
      p.style.setProperty('--x', `${(r() * 100).toFixed(1)}%`)
      p.style.setProperty('--dx', `${Math.round((r() - 0.5) * 240)}px`)
      p.style.setProperty('--delay', `${(r() * 0.8).toFixed(2)}s`)
      p.style.setProperty('--dur', `${(2.4 + r() * 1.2).toFixed(2)}s`)
      p.style.setProperty('--rot', `${Math.round((r() - 0.5) * 1440)}deg`)
      p.style.setProperty('--color', FILTER_COLORS[Math.floor(r() * FILTER_COLORS.length)]!)
      pieces.push(p)
    }
    this.confetti.replaceChildren(...pieces)
    // Entfernen, sobald das letzte Teilchen fertig ist (kein Dauerlauf).
    let remaining = pieces.length
    for (const p of pieces) {
      p.addEventListener('animationend', () => { if (--remaining === 0) this.confetti.replaceChildren() }, { once: true })
    }
  }
}
