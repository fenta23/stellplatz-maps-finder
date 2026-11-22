import type { SupabaseClient } from '@supabase/supabase-js'
import type { PoiType } from '@/features/pois/OverpassClient.js'
import type { FavoritePoi, IFavoritesStore } from './FavoritesStore.js'
import { LocalFavoritesStore } from './FavoritesStore.js'

/** Remote persistence for favorites. All ops are async and may reject. */
export interface FavoritesBackend {
  load(): Promise<readonly FavoritePoi[]>
  add(poi: FavoritePoi): Promise<void>
  remove(id: string): Promise<void>
}

/**
 * A favorites store with the same synchronous interface, backed by a local
 * mirror that is always authoritative for reads. When a remote backend is
 * connected (on login), toggles write through to it in the background. On
 * connect, server state is reconciled with the local mirror using a persisted
 * synced-IDs set so that deletions on another device are respected (even
 * across page reloads). A 30 s polling interval keeps the two in sync.
 * Sync failures never block the UI.
 */
export class SyncedFavoritesStore implements IFavoritesStore {
  private backend: FavoritesBackend | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private static readonly SYNCED_IDS_KEY = 'stellplatz-favorites-synced-ids'
  private syncedIds: Set<string> = new Set()

  constructor(private readonly local: LocalFavoritesStore = new LocalFavoritesStore()) {
    this.loadSyncedIds()
  }

  has(id: string): boolean {
    return this.local.has(id)
  }

  getAll(): ReadonlySet<string> {
    return this.local.getAll()
  }

  list(): readonly FavoritePoi[] {
    return this.local.list()
  }

  onChange(cb: () => void): () => void {
    return this.local.onChange(cb)
  }

  toggle(poi: FavoritePoi): boolean {
    const isFavorite = this.local.toggle(poi)
    const backend = this.backend
    if (backend) {
      const op = isFavorite ? backend.add(poi) : backend.remove(poi.id)
      void op.then(() => {
        if (isFavorite) { this.syncedIds.add(poi.id); this.saveSyncedIds() }
        else { this.syncedIds.delete(poi.id); this.saveSyncedIds() }
      }).catch(err => console.warn('[favorites] remote sync failed:', err))
    }
    return isFavorite
  }

  /**
   * Attach a backend on login: reconcile server state with the local mirror
   * using persisted synced IDs so that deletions performed on another device
   * are respected, then start polling.
   */
  async connect(backend: FavoritesBackend): Promise<void> {
    if (this.backend) return
    this.backend = backend
    await this.reconcile()
    this.startPolling()
  }

  /** Detach on logout; the local mirror stays as the guest set. */
  disconnect(): void {
    this.backend = null
    this.stopPolling()
  }

  private async reconcile(): Promise<void> {
    const backend = this.backend
    if (!backend) return
    let remote: readonly FavoritePoi[]
    try {
      remote = await backend.load()
    } catch (err) {
      console.warn('[favorites] remote load failed:', err)
      return
    }
    const remoteIds = new Set(remote.map(p => p.id))

    // True guest-only items: exist locally, not on server, and were never synced.
    const guestOnly = this.local.list().filter(p => !remoteIds.has(p.id) && !this.syncedIds.has(p.id))

    // Build the authoritative set: server items + genuine guest items.
    // Items that were previously synced but absent from the server (deleted on
    // another device) are implicitly dropped.
    this.local.replaceAll([...remote, ...guestOnly])

    // Push genuine guest items up to the server.
    if (guestOnly.length > 0) {
      await Promise.allSettled(guestOnly.map(poi => backend.add(poi)))
    }

    // Route which IDs are now confirmed synced.
    for (const p of remote) this.syncedIds.add(p.id)
    for (const p of guestOnly) this.syncedIds.add(p.id)
    this.saveSyncedIds()
  }

  private startPolling(): void {
    this.stopPolling()
    this.pollTimer = setInterval(() => { void this.reconcile() }, 30_000)
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  private loadSyncedIds(): void {
    try {
      const raw = localStorage.getItem(SyncedFavoritesStore.SYNCED_IDS_KEY)
      const parsed: unknown = raw ? JSON.parse(raw) : []
      this.syncedIds = new Set(
        Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [],
      )
    } catch {
      this.syncedIds = new Set()
    }
  }

  private saveSyncedIds(): void {
    try {
      localStorage.setItem(
        SyncedFavoritesStore.SYNCED_IDS_KEY,
        JSON.stringify([...this.syncedIds]),
      )
    } catch { /* ignore quota errors */ }
  }
}

interface FavoriteRow {
  poi_id: unknown
  type: unknown
  name: unknown
  lat: unknown
  lon: unknown
}

function rowToFavorite(row: FavoriteRow): FavoritePoi {
  return {
    id: String(row.poi_id),
    type: (row.type as PoiType) ?? 'parking',
    name: typeof row.name === 'string' ? row.name : '',
    lat: Number(row.lat),
    lon: Number(row.lon),
  }
}

/** Supabase-backed favorites, fenced per-user by RLS (auth.uid() = user_id). */
export function createSupabaseFavoritesBackend(
  client: SupabaseClient,
  userId: string,
): FavoritesBackend {
  return {
    async load() {
      const { data, error } = await client.from('favorites').select('poi_id,type,name,lat,lon')
      if (error) throw new Error(error.message)
      return (data ?? []).map(row => rowToFavorite(row as FavoriteRow))
    },
    async add(poi) {
      const { error } = await client.from('favorites').upsert(
        { user_id: userId, poi_id: poi.id, type: poi.type, name: poi.name, lat: poi.lat, lon: poi.lon },
        { onConflict: 'user_id,poi_id' },
      )
      if (error) throw new Error(error.message)
    },
    async remove(id) {
      const { error } = await client.from('favorites').delete().eq('user_id', userId).eq('poi_id', id)
      if (error) throw new Error(error.message)
    },
  }
}
