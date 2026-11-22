import { describe, it, expect, vi } from 'vitest'
import { AuthPanel } from './AuthPanel.js'
import type { Auth, AuthUser, MagicLinkResult } from './auth.js'

function fakeAuth(initialUser: AuthUser | null = null) {
  let changeCb: ((u: AuthUser | null) => void) | undefined
  const auth: Auth = {
    sendMagicLink: vi.fn<(e: string) => Promise<MagicLinkResult>>().mockResolvedValue({ ok: true }),
    verifyOtp: vi.fn<(e: string, t: string) => Promise<MagicLinkResult>>().mockResolvedValue({ ok: true }),
    signOut: vi.fn().mockResolvedValue(undefined),
    currentUser: vi.fn().mockResolvedValue(initialUser),
    onChange: vi.fn((cb: (u: AuthUser | null) => void) => { changeCb = cb; return () => {} }),
    recoverSession: vi.fn().mockResolvedValue(null),
  }
  return { auth, emitChange: (u: AuthUser | null) => changeCb?.(u) }
}

const flush = () => new Promise(r => setTimeout(r, 0))

describe('AuthPanel — logged out', () => {
  it('renders the email form', async () => {
    const c = document.createElement('div')
    new AuthPanel(c, fakeAuth(null).auth)
    await flush()
    expect(c.querySelector<HTMLInputElement>('.auth-input')).not.toBeNull()
    expect(c.querySelector('[data-ref="send"]')?.textContent).toBe('Code senden')
  })

  it('rejects an invalid email without calling the backend', async () => {
    const c = document.createElement('div')
    const { auth } = fakeAuth(null)
    new AuthPanel(c, auth)
    await flush()
    c.querySelector<HTMLInputElement>('[data-ref="input"]')!.value = 'nope'
    c.querySelector<HTMLButtonElement>('[data-ref="send"]')!.click()
    expect(auth.sendMagicLink).not.toHaveBeenCalled()
    expect(c.querySelector('.auth-msg-error')?.textContent).toContain('gültige E-Mail')
  })

  it('sends a code for a valid email and reveals the code step', async () => {
    const c = document.createElement('div')
    const { auth } = fakeAuth(null)
    new AuthPanel(c, auth)
    await flush()
    c.querySelector<HTMLInputElement>('[data-ref="input"]')!.value = 'me@example.com'
    c.querySelector<HTMLButtonElement>('[data-ref="send"]')!.click()
    await flush()
    expect(auth.sendMagicLink).toHaveBeenCalledWith('me@example.com')
    expect(c.querySelector('.auth-msg-ok')?.textContent).toContain('gesendet')
    expect(c.querySelector<HTMLElement>('[data-ref="stepCode"]')!.hidden).toBe(false)
    expect(c.querySelector<HTMLElement>('[data-ref="stepEmail"]')!.hidden).toBe(true)
  })

  it('verifies a 6-digit code via verifyOtp', async () => {
    const c = document.createElement('div')
    const { auth } = fakeAuth(null)
    new AuthPanel(c, auth)
    await flush()
    c.querySelector<HTMLInputElement>('[data-ref="input"]')!.value = 'me@example.com'
    c.querySelector<HTMLButtonElement>('[data-ref="send"]')!.click()
    await flush()
    c.querySelector<HTMLInputElement>('[data-ref="code"]')!.value = '123456'
    c.querySelector<HTMLButtonElement>('[data-ref="verify"]')!.click()
    await flush()
    expect(auth.verifyOtp).toHaveBeenCalledWith('me@example.com', '123456')
  })

  it('rejects a malformed code without calling verifyOtp', async () => {
    const c = document.createElement('div')
    const { auth } = fakeAuth(null)
    new AuthPanel(c, auth)
    await flush()
    c.querySelector<HTMLInputElement>('[data-ref="input"]')!.value = 'me@example.com'
    c.querySelector<HTMLButtonElement>('[data-ref="send"]')!.click()
    await flush()
    c.querySelector<HTMLInputElement>('[data-ref="code"]')!.value = '12'
    c.querySelector<HTMLButtonElement>('[data-ref="verify"]')!.click()
    expect(auth.verifyOtp).not.toHaveBeenCalled()
    expect(c.querySelector('.auth-msg-error')?.textContent).toContain('6-stelligen Code')
  })
})

describe('AuthPanel — profile (logged in)', () => {
  const user: AuthUser = {
    id: 'u1',
    email: 'max@example.com',
    provider: 'email',
    created_at: '2026-01-15T10:00:00Z',
  }

  it('shows email, provider, member-since and a logout button', async () => {
    const c = document.createElement('div')
    const { auth, emitChange } = fakeAuth(null)
    new AuthPanel(c, auth)
    await flush()
    emitChange(user)
    expect(c.textContent).toContain('max@example.com')
    expect(c.querySelector('[data-ref="method"]')?.textContent).toBe('E-Mail')
    expect(c.querySelector('[data-ref="since"]')?.textContent).toContain('2026')
    const logout = c.querySelector<HTMLButtonElement>('[data-ref="logout"]')!
    expect(logout.textContent).toBe('Abmelden')
    logout.click()
    expect(auth.signOut).toHaveBeenCalledOnce()
  })

  it('shows favorite/note counts from getStats', async () => {
    const c = document.createElement('div')
    const { auth, emitChange } = fakeAuth(null)
    new AuthPanel(c, auth, { getStats: () => ({ favorites: 3, notes: 5 }) })
    await flush()
    emitChange(user)
    expect(c.querySelector('[data-ref="favCount"]')?.textContent).toBe('3')
    expect(c.querySelector('[data-ref="noteCount"]')?.textContent).toBe('5')
  })

  it('shows a dash for counts when no stats provider is given', async () => {
    const c = document.createElement('div')
    const { auth, emitChange } = fakeAuth(null)
    new AuthPanel(c, auth)
    await flush()
    emitChange(user)
    expect(c.querySelector('[data-ref="favCount"]')?.textContent).toBe('–')
  })
})

describe('AuthPanel — close button', () => {
  it('closes the panel when the X button is clicked', async () => {
    const c = document.createElement('div')
    const panel = new AuthPanel(c, fakeAuth(null).auth)
    await flush()
    expect(panel.isOpen()).toBe(false)
    panel.open()
    expect(panel.isOpen()).toBe(true)
    const closeBtn = c.querySelector<HTMLButtonElement>('.auth-close')!
    closeBtn.click()
    expect(panel.isOpen()).toBe(false)
  })
})
