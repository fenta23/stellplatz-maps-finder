import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SyncedFavoritesStore } from '@/features/favorites/RemoteFavoritesStore.js'
import { LocalFavoritesStore, type FavoritePoi } from '@/features/favorites/FavoritesStore.js'
import { SyncedNotesStore } from '@/features/notes/RemoteNotesStore.js'
import { LocalNotesStore, type NoteTarget } from '@/features/notes/NotesStore.js'
import { SyncedCustomPoiStore, type CustomPoiBackend } from '@/features/custom-pois/RemoteCustomPoiStore.js'
import { LocalCustomPoiStore } from '@/features/custom-pois/CustomPoiStore.js'
import type { CustomPoi } from '@/features/custom-pois/CustomPoi.js'
import { SyncedFilterStore, type FilterBackend } from '@/features/filters/RemoteFilterStore.js'
import { LocalFilterStore } from '@/features/filters/FilterStore.js'
import type { FilterDef } from '@/features/filters/filterModel.js'
import { createAuth } from '@/features/auth/auth.js'
import type { SupabaseClient } from '@supabase/supabase-js'

const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v },
    removeItem: (k: string) => { delete store[k] },
    clear: () => { store = {} },
  }
})()
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock })
beforeEach(() => localStorageMock.clear())

const favPoi = (id: string): FavoritePoi => ({ id, type: 'parking', name: `POI ${id}`, lat: 50, lon: 8 })
const noteTarget = (id: string): NoteTarget => ({ id, type: 'parking', name: `POI ${id}`, lat: 50, lon: 8 })
const cpoi = (id: string): CustomPoi => ({ id, iconId: 'parking', lat: 50, lon: 8, name: `POI ${id}`, createdAt: 1, updatedAt: 1 })

function fakeFavoritesBackend() {
  const store = new Map<string, FavoritePoi>()
  return {
    store,
    backend: {
      load: vi.fn(async () => [...store.values()]),
      add: vi.fn(async (p: FavoritePoi) => { store.set(p.id, p) }),
      remove: vi.fn(async (id: string) => { store.delete(id) }),
    },
  }
}

function fakeNotesBackend() {
  const store = new Map<string, { id: string; text: string }>()
  return {
    store,
    backend: {
      load: vi.fn(async () => [...store.values()].map(v => ({ ...noteTarget(v.id), text: v.text }))),
      upsert: vi.fn(async (n: { id: string; text: string }) => { store.set(n.id, n) }),
      remove: vi.fn(async (id: string) => { store.delete(id) }),
    },
  }
}

function fakeCustomPoiBackend() {
  const store = new Map<string, CustomPoi>()
  const backend: CustomPoiBackend = {
    load: vi.fn(async () => [...store.values()]),
    upsert: vi.fn(async (p: CustomPoi) => { store.set(p.id, p) }),
    remove: vi.fn(async (id: string) => { store.delete(id) }),
  }
  return { store, backend }
}

function fakeFilterBackend() {
  const rows = new Map<string, FilterDef>()
  const backend: FilterBackend = {
    load: vi.fn(async () => [...rows.values()]),
    upsert: vi.fn(async (d: FilterDef) => { rows.set(d.id, d) }),
    remove: vi.fn(async (id: string) => { rows.delete(id) }),
  }
  return { rows, backend }
}

describe('auth.onChange → store connect → write-through', () => {
  it('connects favorites after onAuthStateChange fires SIGNED_IN and writes go through', async () => {
    const favBackend = fakeFavoritesBackend()
    const favStore = new SyncedFavoritesStore(new LocalFavoritesStore())

    let capturedOnAuthCb: ((event: string, session: unknown) => void) | undefined
    const fakeClient = {
      auth: {
        onAuthStateChange: vi.fn((cb) => {
          capturedOnAuthCb = cb
          return { data: { subscription: { unsubscribe: vi.fn() } } }
        }),
      },
    } as unknown as SupabaseClient

    const auth = createAuth(fakeClient, 'https://test.supabase.co')
    auth.onChange(user => {
      if (user) void favStore.connect(favBackend.backend)
    })

    // Simulate what setSession does: fire onAuthStateChange
    capturedOnAuthCb!('SIGNED_IN', { user: { id: 'u1' } })

    // Wait for async connect
    await vi.waitUntil(() => favBackend.backend.load.mock.calls.length > 0)
    expect(favBackend.backend.load).toHaveBeenCalledTimes(1)

    // Now toggle a favorite – must hit backend.add
    favStore.toggle(favPoi('a'))
    await Promise.resolve()
    expect(favBackend.backend.add).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }))

    // Toggle again – must call backend.remove
    favStore.toggle(favPoi('a'))
    await Promise.resolve()
    expect(favBackend.backend.remove).toHaveBeenCalledWith('a')
  })

  it('skips connect on TOKEN_REFRESHED, so write-through remains inactive', async () => {
    const favBackend = fakeFavoritesBackend()
    const favStore = new SyncedFavoritesStore(new LocalFavoritesStore())

    let capturedOnAuthCb: ((event: string, session: unknown) => void) | undefined
    const fakeClient = {
      auth: {
        onAuthStateChange: vi.fn((cb) => {
          capturedOnAuthCb = cb
          return { data: { subscription: { unsubscribe: vi.fn() } } }
        }),
      },
    } as unknown as SupabaseClient

    const auth = createAuth(fakeClient, 'https://test.supabase.co')
    auth.onChange(user => {
      if (user) void favStore.connect(favBackend.backend)
    })

    // TOKEN_REFRESHED must NOT trigger connect
    capturedOnAuthCb!('TOKEN_REFRESHED', { user: { id: 'u1' } })

    // Give it time – backend.load should never be called
    await new Promise(r => setTimeout(r, 50))
    expect(favBackend.backend.load).not.toHaveBeenCalled()

    // Write-through must not work (no backend set)
    favStore.toggle(favPoi('x'))
    await Promise.resolve()
    expect(favBackend.backend.add).not.toHaveBeenCalled()
  })

  it('clears backend on SIGNED_OUT so write-through stops', async () => {
    const favBackend = fakeFavoritesBackend()
    const favStore = new SyncedFavoritesStore(new LocalFavoritesStore())

    let capturedOnAuthCb: ((event: string, session: unknown) => void) | undefined
    const fakeClient = {
      auth: {
        onAuthStateChange: vi.fn((cb) => {
          capturedOnAuthCb = cb
          return { data: { subscription: { unsubscribe: vi.fn() } } }
        }),
      },
    } as unknown as SupabaseClient

    const auth = createAuth(fakeClient, 'https://test.supabase.co')
    auth.onChange(user => {
      if (user) void favStore.connect(favBackend.backend)
      else favStore.disconnect()
    })

    // Connect
    capturedOnAuthCb!('SIGNED_IN', { user: { id: 'u1' } })
    await vi.waitUntil(() => favBackend.backend.load.mock.calls.length > 0)

    // Sign out
    capturedOnAuthCb!('SIGNED_OUT', null)

    // Write-through must not work after disconnect
    favStore.toggle(favPoi('y'))
    await Promise.resolve()
    expect(favBackend.backend.add).not.toHaveBeenCalled()
  })
})

describe('Store connect guard (defense in depth)', () => {
  it('favorites: second connect skips backend.load', async () => {
    const { backend } = fakeFavoritesBackend()
    const store = new SyncedFavoritesStore(new LocalFavoritesStore())
    await store.connect(backend)
    expect(backend.load).toHaveBeenCalledTimes(1)
    await store.connect(backend)
    expect(backend.load).toHaveBeenCalledTimes(1)
  })

  it('notes: second connect skips backend.load', async () => {
    const { backend } = fakeNotesBackend()
    const store = new SyncedNotesStore(new LocalNotesStore())
    await store.connect(backend)
    expect(backend.load).toHaveBeenCalledTimes(1)
    await store.connect(backend)
    expect(backend.load).toHaveBeenCalledTimes(1)
  })

  it('custom-pois: second connect skips backend.load', async () => {
    const { backend } = fakeCustomPoiBackend()
    const store = new SyncedCustomPoiStore(new LocalCustomPoiStore())
    await store.connect(backend)
    expect(backend.load).toHaveBeenCalledTimes(1)
    await store.connect(backend)
    expect(backend.load).toHaveBeenCalledTimes(1)
  })

  it('filters: second connect skips backend.load', async () => {
    const { backend } = fakeFilterBackend()
    const store = new SyncedFilterStore(new LocalFilterStore())
    await store.connect(backend)
    expect(backend.load).toHaveBeenCalledTimes(1)
    await store.connect(backend)
    expect(backend.load).toHaveBeenCalledTimes(1)
  })
})

describe('Store write-through (individual writes)', () => {
  it('notes.set triggers backend.upsert', async () => {
    const { backend } = fakeNotesBackend()
    const store = new SyncedNotesStore(new LocalNotesStore())
    await store.connect(backend)
    store.set(noteTarget('n1'), 'hello')
    await Promise.resolve()
    expect(backend.upsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'n1', text: 'hello' }))
  })

  it('notes.set with empty text triggers backend.remove', async () => {
    const { backend } = fakeNotesBackend()
    const store = new SyncedNotesStore(new LocalNotesStore())
    await store.connect(backend)
    store.set(noteTarget('n2'), '   ')
    await Promise.resolve()
    expect(backend.remove).toHaveBeenCalledWith('n2')
  })

  it('custom-pois.put triggers backend.upsert', async () => {
    const { backend } = fakeCustomPoiBackend()
    const store = new SyncedCustomPoiStore(new LocalCustomPoiStore())
    await store.connect(backend)
    store.put(cpoi('cp1'))
    await Promise.resolve()
    expect(backend.upsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'cp1' }))
  })

  it('custom-pois.remove triggers backend.remove', async () => {
    const { backend } = fakeCustomPoiBackend()
    const store = new SyncedCustomPoiStore(new LocalCustomPoiStore())
    await store.connect(backend)
    store.put(cpoi('cp2'))
    store.remove('cp2')
    await Promise.resolve()
    expect(backend.remove).toHaveBeenCalledWith('cp2')
  })

  it('favorites.toggle triggers backend.add on first call', async () => {
    const { backend } = fakeFavoritesBackend()
    const store = new SyncedFavoritesStore(new LocalFavoritesStore())
    await store.connect(backend)
    store.toggle(favPoi('f1'))
    await Promise.resolve()
    expect(backend.add).toHaveBeenCalledWith(expect.objectContaining({ id: 'f1' }))
  })

  it('favorites.toggle triggers backend.remove on second call', async () => {
    const { backend } = fakeFavoritesBackend()
    const store = new SyncedFavoritesStore(new LocalFavoritesStore())
    await store.connect(backend)
    store.toggle(favPoi('f2'))
    store.toggle(favPoi('f2'))
    await Promise.resolve()
    expect(backend.remove).toHaveBeenCalledWith('f2')
  })
})
