import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Client-side Supabase config comes from VITE_ env vars (public anon key only —
// never the service_role key). Baked in at build time by Vite.

function readEnv(key: string): string {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    return env?.[key] ?? ''
  } catch {
    return ''
  }
}

const SUPABASE_URL = readEnv('VITE_SUPABASE_URL')
const SUPABASE_ANON_KEY = readEnv('VITE_SUPABASE_ANON_KEY')

/** True when both client env vars are present — auth UI stays hidden otherwise. */
export function isAuthConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)
}

/** Project URL the Supabase client talks to (empty when not configured). */
export function getSupabaseUrl(): string {
  return SUPABASE_URL
}

let client: SupabaseClient | null = null

/** Lazy singleton Supabase client, or null when auth is not configured. */
export function getSupabaseClient(): SupabaseClient | null {
  if (!isAuthConfigured()) return null
  if (!client) client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  return client
}
