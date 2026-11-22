import type { SupabaseClient, User, Session } from '@supabase/supabase-js'

export type MagicLinkResult = { ok: true } | { ok: false; error: string }

export interface AuthUser {
  readonly id: string
  readonly email?: string | undefined
  readonly created_at?: string | undefined
  readonly provider?: string | undefined
  readonly helpSeen?: boolean | undefined
}

function toAuthUser(user: User | null): AuthUser | null {
  if (!user) return null
  return {
    id: user.id,
    email: user.email,
    created_at: user.created_at,
    provider: user.app_metadata?.['provider'] as string | undefined,
    helpSeen: (user.user_metadata as Record<string, unknown> | undefined)?.['helpSeen'] as boolean | undefined,
  }
}

export interface Auth {
  /**
   * Sends a passwordless one-time code (and magic-link) to the given email.
   * The code path is what makes login work inside an installed PWA: the user
   * stays in the app and types the code back via {@link verifyOtp} — no browser
   * redirect, so the session lands in the PWA's own storage context.
   */
  sendMagicLink(email: string): Promise<MagicLinkResult>
  /** Verifies the 6-digit code from the login email and creates the session. */
  verifyOtp(email: string, token: string): Promise<MagicLinkResult>
  signOut(): Promise<void>
  currentUser(): Promise<AuthUser | null>
  /** Subscribe to login/logout; returns an unsubscribe fn. */
  onChange(cb: (user: AuthUser | null) => void): () => void
  /**
   * Re-read the session from storage (e.g. after a magic-link redirect in the
   * browser while the PWA stayed open). Returns the current user if recovered.
   */
  recoverSession(): Promise<AuthUser | null>
}

/** Derive the Supabase localStorage key from the project URL. */
function storageKey(supabaseUrl: string): string {
  const ref = supabaseUrl.match(/https:\/\/(.+)\.supabase\.co/)?.[1]
  return ref ? `sb-${ref}-auth-token` : ''
}

/**
 * Thin, testable wrapper over Supabase Auth (client injected for tests).
 * `supabaseUrl` is passed explicitly: `client.supabaseUrl` is protected in
 * supabase-js and may change without notice.
 */
export function createAuth(client: SupabaseClient, supabaseUrl: string): Auth {
  const key = storageKey(supabaseUrl)
  let userPromise: Promise<AuthUser | null> | null = null

  return {
    async sendMagicLink(email) {
      const { error } = await client.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin + window.location.pathname },
      })
      return error ? { ok: false, error: error.message } : { ok: true }
    },

    async verifyOtp(email, token) {
      const { error } = await client.auth.verifyOtp({ email, token, type: 'email' })
      return error ? { ok: false, error: error.message } : { ok: true }
    },

    async signOut() {
      await client.auth.signOut()
    },

    async currentUser() {
      if (!userPromise) {
        userPromise = client.auth.getUser().then(
          ({ data }) => toAuthUser(data.user ?? null),
          () => { userPromise = null; return null },
        )
      }
      return userPromise
    },

    onChange(cb) {
      const { data } = client.auth.onAuthStateChange((event, session) => {
        if (event === 'TOKEN_REFRESHED') return
        cb(toAuthUser(session?.user ?? null))
      })
      return () => data.subscription.unsubscribe()
    },

    async recoverSession() {
      if (!key) return null
      const raw = localStorage.getItem(key)
      if (!raw) return null
      try {
        const session = JSON.parse(raw) as Session
        const { data } = await client.auth.setSession(session)
        return toAuthUser(data.user ?? null)
      } catch {
        return null
      }
    },
  }
}
