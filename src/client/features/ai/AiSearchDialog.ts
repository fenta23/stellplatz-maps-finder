import './ai.css'
import { clone, ref } from '@/core/template.js'
import { createEventScope } from '@/core/events.js'
import { sendAiChat, type ChatTurn } from './AiClient.js'
import type { AiChatResponse, AiIntent } from './intentSchema.js'
import dialogHtml from './aiSearchDialog.html?raw'

export interface AiSearchDialogDeps {
  /** Bestätigten Intent auf die Karte anwenden (Filter + Ortssprung). */
  readonly onApply: (intent: AiIntent) => void | Promise<void>
  /** Der Dialog wurde geschlossen (Esc, close(), nach „Auf Karte zeigen“); nur wenn er offen war. */
  readonly onClose?: () => void
  /** Standard: sendAiChat. Injizierbar für Tests. */
  readonly send?: (messages: readonly ChatTurn[]) => Promise<AiChatResponse>
  /** Max. Nutzerfragen, danach gesperrt (spiegelt AI_MAX_TURNS im Backend). Standard 5. */
  readonly maxTurns?: number
}

// Inline-Chat für die Suchbox (Kopfzeile und Rahmen liefert die Suchbox). Das
// Gespräch erzeugt einen validierten Intent; „Auf Karte zeigen“ übergibt ihn an
// onApply und schließt — die Karte selbst ist das Ergebnis.
export class AiSearchDialog {
  private readonly root: HTMLElement
  private readonly messagesEl: HTMLElement
  private readonly input: HTMLInputElement
  private readonly form: HTMLFormElement
  private readonly maxTurns: number
  private readonly placeholder: string
  private readonly sendFn: (messages: readonly ChatTurn[]) => Promise<AiChatResponse>
  private readonly events = createEventScope()
  private messages: ChatTurn[] = []
  private busy = false
  // Wird bei open/close/destroy erhöht; veraltete Antworten werden verworfen.
  private token = 0

  constructor(container: HTMLElement, private readonly deps: AiSearchDialogDeps) {
    this.maxTurns = deps.maxTurns ?? 5
    this.sendFn = deps.send ?? sendAiChat
    this.root = clone(dialogHtml)
    container.appendChild(this.root)
    this.messagesEl = ref(this.root, 'messages')
    this.input = ref<HTMLInputElement>(this.root, 'input')
    this.form = ref<HTMLFormElement>(this.root, 'form')
    this.placeholder = this.input.placeholder

    this.events.on(document, 'keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen()) this.close()
    })
    this.events.on(this.form, 'submit', (e) => { e.preventDefault(); void this.send() })
  }

  /** Öffnet mit leerem Verlauf; `seed` wird als erste Frage gesendet. */
  open(seed = ''): void {
    const token = ++this.token
    this.messages = []
    this.busy = false
    this.messagesEl.innerHTML = ''
    this.input.value = ''
    this.input.disabled = false
    this.input.placeholder = this.placeholder
    this.root.hidden = false
    this.addAssistant('Wonach suchst du? Beschreib z. B. „ruhiger Stellplatz am Bodensee mit Entsorgung".')
    const text = seed.trim()
    if (text) { this.input.value = text; void this.send() }
    else setTimeout(() => { if (token === this.token) this.input.focus() }, 50)
  }

  close(): void {
    this.token++
    this.busy = false
    if (this.root.hidden) return
    this.root.hidden = true
    this.deps.onClose?.()
  }

  isOpen(): boolean {
    return !this.root.hidden
  }

  destroy(): void {
    this.token++
    this.events.dispose()
    this.root.remove()
  }

  private async send(): Promise<void> {
    if (this.busy) return
    const text = this.input.value.trim()
    if (!text) return

    this.addUser(text)
    this.messages.push({ role: 'user', content: text })
    this.input.value = ''

    const userTurns = this.messages.filter(m => m.role === 'user').length
    if (userTurns > this.maxTurns) {
      this.addAssistant(`Frage-Limit von ${this.maxTurns} erreicht – bitte schließen und neu starten.`)
      this.lock()
      return
    }

    const token = this.token
    this.setBusy(true)
    const typing = this.addTyping()
    const res = await this.sendFn([...this.messages])
    if (token !== this.token) return
    typing.remove()
    this.setBusy(false)

    this.messages.push({ role: 'assistant', content: res.reply })

    if (res.status === 'ready' && res.intent) {
      this.addAssistant(res.reply)
      this.addResultCard(res.intent)
    } else if (res.status === 'limit') {
      this.addAssistant(res.reply)
      this.lock()
    } else {
      // clarify | offtopic | error → Antwort zeigen, weiter chatten
      this.addAssistant(res.reply, res.status === 'offtopic' || res.status === 'error')
    }
  }

  // ── Rendering ───────────────────────────────────────────────────────────────

  private addUser(text: string): void {
    this.bubble('user').textContent = text
  }

  private addAssistant(text: string, muted = false): void {
    const el = this.bubble('assistant')
    if (muted) el.classList.add('ai-bubble--muted')
    el.textContent = text
  }

  private addTyping(): HTMLElement {
    const el = this.bubble('assistant')
    el.classList.add('ai-bubble--typing')
    el.textContent = '…'
    return el
  }

  private bubble(kind: 'user' | 'assistant'): HTMLElement {
    const el = document.createElement('div')
    el.className = `ai-bubble ai-bubble--${kind}`
    this.messagesEl.appendChild(el)
    this.scrollDown()
    return el
  }

  private addResultCard(intent: AiIntent): void {
    const card = document.createElement('div')
    card.className = 'ai-result-card'

    const recap = document.createElement('div')
    recap.className = 'ai-result-recap'
    const bits: string[] = []
    if (intent.place) bits.push(`📍 ${intent.place}`)
    const cats = intent.enableFilters.length + intent.adHocFilters.length
    if (cats) bits.push(`${cats} Kategorie${cats > 1 ? 'n' : ''}`)
    recap.textContent = bits.join(' · ') || 'Auswahl anwenden'
    card.appendChild(recap)

    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'ai-result-apply'
    btn.textContent = 'Auf Karte zeigen'
    btn.addEventListener('click', () => {
      void Promise.resolve(this.deps.onApply(intent))
      this.close()
    })
    card.appendChild(btn)

    this.messagesEl.appendChild(card)
    this.scrollDown()
    btn.focus()
  }

  private lock(): void {
    this.input.disabled = true
    this.input.placeholder = 'Suche neu starten…'
  }

  private setBusy(busy: boolean): void {
    this.busy = busy
    this.input.disabled = busy
    if (!busy) this.input.focus()
  }

  private scrollDown(): void {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight
  }
}
