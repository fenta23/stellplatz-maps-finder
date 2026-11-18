import { describe, it, expect, vi, afterEach } from 'vitest'
import { TrackImportDialog, formatKm, type TrackImportDialogDeps } from './TrackImportDialog.js'
import { TrackImportError } from './trackErrors.js'
import type { ImportedTrack, SavedTrack, Track } from './trackTypes.js'

const imported: ImportedTrack = {
  name: 'Eifelrunde', source: 'komoot',
  points: [[50.0, 7.0], [50.01, 7.01], [50.02, 7.0]],
}
const active: SavedTrack = { ...imported, lengthM: 86_432, corridorM: 500, id: 'a1', addedAt: 1 }
const other = (id: string, over: Partial<SavedTrack> = {}): SavedTrack => ({ ...active, id, name: `Tour ${id}`, source: 'gpx', lengthM: 12_340, ...over })

const flush = () => new Promise(r => setTimeout(r, 0))

function setup(over: Partial<TrackImportDialogDeps> = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const deps = {
    getActiveTrack: vi.fn(() => null as SavedTrack | null),
    getSavedTracks: vi.fn(() => [] as readonly SavedTrack[]),
    importLink: vi.fn(async (_input: string, _signal: AbortSignal): Promise<ImportedTrack> => imported),
    importFile: vi.fn(async (_file: File): Promise<ImportedTrack> => ({ ...imported, source: 'gpx' as const })),
    onImported: vi.fn((_track: Track) => {}),
    onShowActive: vi.fn(),
    onRemoveActive: vi.fn(),
    onActivate: vi.fn((_id: string) => {}),
    onDelete: vi.fn((_id: string) => {}),
  }
  const dialog = new TrackImportDialog(container, { ...deps, ...over })
  const q = <T extends HTMLElement>(ref: string) => container.querySelector<T>(`[data-ref="${ref}"]`)!
  const submitLink = (value = 'https://www.komoot.com/de-de/tour/123') => {
    q<HTMLInputElement>('linkInput').value = value
    q<HTMLButtonElement>('linkBtn').click()
  }
  return { container, deps, dialog, q, submitLink }
}

afterEach(() => { document.body.innerHTML = '' })

describe('formatKm', () => {
  it('uses one decimal and a German comma', () => {
    expect(formatKm(86_432)).toBe('86,4 km')
    expect(formatKm(0)).toBe('0,0 km')
  })
})

describe('TrackImportDialog', () => {
  it('renders title and both sections, closed at first', () => {
    const { container, dialog, q } = setup()
    expect(dialog.isOpen()).toBe(false)
    expect(container.textContent).toContain('Route importieren')
    expect(container.textContent).toContain('Komoot-Link')
    expect(container.textContent).toContain('GPX-Datei')
    expect(q('komootSection').hidden).toBe(false)
    expect(q<HTMLInputElement>('fileInput').accept).toContain('.gpx')
    expect(q('status').getAttribute('role')).toBe('status')
    expect(q('status').getAttribute('aria-live')).toBe('polite')
  })

  describe('plan section', () => {
    it('is hidden without the onPlan dep', () => {
      const { q } = setup()
      expect(q('planSection').hidden).toBe(true)
    })

    it('is visible with the dep, sits between saved routes and Komoot, and calls it on click', () => {
      const onPlan = vi.fn()
      const { dialog, q } = setup({ onPlan })
      dialog.open()
      expect(q('planSection').hidden).toBe(false)
      expect(q('planBtn').textContent).toBe('Route planen')
      expect(q('saved').nextElementSibling).toBe(q('planSection'))
      expect(q('planSection').nextElementSibling).toBe(q('komootSection'))
      q<HTMLButtonElement>('planBtn').click()
      expect(onPlan).toHaveBeenCalledTimes(1)
    })

    it('does not close the dialog itself', () => {
      const { dialog, q } = setup({ onPlan: vi.fn() })
      dialog.open()
      q<HTMLButtonElement>('planBtn').click()
      expect(dialog.isOpen()).toBe(true)
    })
  })

  it('hides the Komoot section when disabled', () => {
    const { q } = setup({ komootEnabled: false })
    expect(q('komootSection').hidden).toBe(true)
  })

  it('imports a link: prepares the track, calls onImported, closes', async () => {
    const { deps, dialog, submitLink } = setup()
    dialog.open()
    submitLink()
    await flush()
    expect(deps.importLink).toHaveBeenCalledWith('https://www.komoot.com/de-de/tour/123', expect.any(AbortSignal))
    expect(deps.onImported).toHaveBeenCalledOnce()
    const t = deps.onImported.mock.calls[0]![0] as Track
    expect(t.name).toBe('Eifelrunde')
    expect(t.lengthM).toBeGreaterThan(0)
    expect(t.corridorM).toBeGreaterThan(0)
    expect(dialog.isOpen()).toBe(false)
  })

  it('shows the German error, stays open, re-enables inputs and refocuses', async () => {
    const { deps, dialog, q, submitLink } = setup({
      importLink: vi.fn(async (): Promise<ImportedTrack> => { throw new TrackImportError('komoot-private') }),
    })
    dialog.open()
    submitLink()
    expect(q('status').textContent).toBe('Lade Tour…')
    await flush()
    expect(q('status').textContent).toBe('Die Tour ist nicht öffentlich – bitte als GPX exportieren und hochladen.')
    expect(dialog.isOpen()).toBe(true)
    expect(q<HTMLInputElement>('linkInput').disabled).toBe(false)
    expect(q<HTMLButtonElement>('linkBtn').disabled).toBe(false)
    expect(document.activeElement).toBe(q('linkInput'))
    expect(deps.onImported).not.toHaveBeenCalled()
  })

  it('shows an error for a track that cannot be prepared', async () => {
    const { dialog, q, submitLink } = setup({ importLink: vi.fn(async (): Promise<ImportedTrack> => ({ ...imported, points: [[1, 1]] })) })
    dialog.open()
    submitLink()
    await flush()
    expect(q('status').textContent).toContain('mindestens zwei Punkte')
  })

  it('disables controls while busy and ignores a second submit', async () => {
    let resolve!: (t: ImportedTrack) => void
    const importLink = vi.fn(() => new Promise<ImportedTrack>(r => { resolve = r }))
    const { deps, dialog, q, submitLink } = setup({ importLink })
    dialog.open()
    submitLink()
    expect(q<HTMLInputElement>('linkInput').disabled).toBe(true)
    expect(q<HTMLButtonElement>('linkBtn').disabled).toBe(true)
    expect(q<HTMLButtonElement>('fileBtn').disabled).toBe(true)
    q<HTMLFormElement>('linkForm').dispatchEvent(new Event('submit', { cancelable: true }))
    expect(importLink).toHaveBeenCalledOnce()
    resolve(imported)
    await flush()
    expect(deps.onImported).toHaveBeenCalledOnce()
  })

  it('ignores an empty link', () => {
    const { deps, dialog, submitLink } = setup()
    dialog.open()
    submitLink('   ')
    expect(deps.importLink).not.toHaveBeenCalled()
  })

  it('imports a selected GPX file', async () => {
    const { deps, dialog, q } = setup()
    dialog.open()
    const file = new File(['<gpx/>'], 'tour.gpx')
    const input = q<HTMLInputElement>('fileInput')
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    input.dispatchEvent(new Event('change'))
    await flush()
    expect(deps.importFile).toHaveBeenCalledWith(file)
    expect(deps.onImported).toHaveBeenCalledOnce()
    expect((deps.onImported.mock.calls[0]![0] as Track).source).toBe('gpx')
    expect(dialog.isOpen()).toBe(false)
  })

  it('the file button opens the file picker', () => {
    const { q } = setup()
    const click = vi.spyOn(q<HTMLInputElement>('fileInput'), 'click')
    q<HTMLButtonElement>('fileBtn').click()
    expect(click).toHaveBeenCalledOnce()
  })

  it('closing during an in-flight link import aborts it and stays silent', async () => {
    let signal!: AbortSignal
    let reject!: (e: unknown) => void
    const importLink = vi.fn((_: string, s: AbortSignal) => {
      signal = s
      return new Promise<ImportedTrack>((_res, rej) => { reject = rej })
    })
    const { deps, dialog, q, submitLink } = setup({ importLink })
    dialog.open()
    submitLink()
    dialog.close()
    expect(signal.aborted).toBe(true)
    reject(new DOMException('aborted', 'AbortError'))
    await flush()
    expect(q('status').textContent).toBe('')
    expect(deps.onImported).not.toHaveBeenCalled()
    expect(q<HTMLInputElement>('linkInput').disabled).toBe(false)
  })

  it('closing during an in-flight import ignores a late success', async () => {
    let resolve!: (t: ImportedTrack) => void
    const { deps, dialog, submitLink } = setup({ importLink: vi.fn(() => new Promise<ImportedTrack>(r => { resolve = r })) })
    dialog.open()
    submitLink()
    dialog.close()
    resolve(imported)
    await flush()
    expect(deps.onImported).not.toHaveBeenCalled()
  })

  it('shows the active track block only when a track is active', () => {
    const getActiveTrack = vi.fn((): SavedTrack | null => active)
    const { dialog, q } = setup({ getActiveTrack })
    dialog.open()
    expect(q('active').hidden).toBe(false)
    expect(q('activeName').textContent).toBe('Eifelrunde')
    expect(q('activeLength').textContent).toBe('86,4 km')
    getActiveTrack.mockReturnValue(null)
    dialog.close()
    dialog.open()
    expect(q('active').hidden).toBe(true)
  })

  it('active-track buttons call their callbacks', () => {
    const { deps, dialog, q } = setup({ getActiveTrack: () => active })
    dialog.open()
    q<HTMLButtonElement>('show').click()
    expect(deps.onShowActive).toHaveBeenCalledOnce()
    q<HTMLButtonElement>('remove').click()
    expect(deps.onRemoveActive).toHaveBeenCalledOnce()
    expect(q('remove').textContent).toBe('Route schließen')
  })

  it('"Löschen" deletes the active route by id and closes', () => {
    const { deps, dialog, q } = setup({ getActiveTrack: () => active })
    dialog.open()
    q<HTMLButtonElement>('deleteActive').click()
    expect(deps.onDelete).toHaveBeenCalledWith('a1')
    expect(deps.onRemoveActive).not.toHaveBeenCalled()
    expect(dialog.isOpen()).toBe(false)
  })

  it('shows the 10-routes hint', () => {
    const { container } = setup()
    expect(container.textContent).toContain('Bis zu 10 Routen bleiben auf diesem Gerät gespeichert.')
  })

  describe('saved routes', () => {
    const items = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('.track-saved-item')]

    it('is hidden without inactive saved routes (the active one is not listed)', () => {
      const { dialog, q } = setup({ getActiveTrack: () => active, getSavedTracks: () => [active] })
      dialog.open()
      expect(q('saved').hidden).toBe(true)
    })

    it('lists inactive routes with name, length and source', () => {
      const { container, dialog, q } = setup({
        getActiveTrack: () => active,
        getSavedTracks: () => [active, other('b'), other('c', { source: 'komoot', lengthM: 86_432 })],
      })
      dialog.open()
      expect(q('saved').hidden).toBe(false)
      const rows = items(container)
      expect(rows).toHaveLength(2)
      expect(rows[0]!.querySelector('.track-saved-name')!.textContent).toBe('Tour b')
      expect(rows[0]!.querySelector('.track-saved-meta')!.textContent).toBe('12,3 km · GPX')
      expect(rows[1]!.querySelector('.track-saved-meta')!.textContent).toBe('86,4 km · Komoot')
    })

    it('labels planned routes as "Geplant"', () => {
      const { container, dialog } = setup({ getSavedTracks: () => [other('p', { source: 'planned', lengthM: 18_432 })] })
      dialog.open()
      expect(container.querySelector('.track-saved-meta')!.textContent).toBe('18,4 km · Geplant')
    })

    it('renders names as text, never as markup', () => {
      const { container, dialog } = setup({ getSavedTracks: () => [other('b', { name: '<img src=x onerror=alert(1)>' })] })
      dialog.open()
      expect(container.querySelector('.track-saved-item img')).toBeNull()
      expect(container.querySelector('.track-saved-name')!.textContent).toBe('<img src=x onerror=alert(1)>')
    })

    it('"Anzeigen" activates and closes the dialog', () => {
      const { container, deps, dialog } = setup({ getSavedTracks: () => [other('b')] })
      dialog.open()
      ;[...container.querySelectorAll<HTMLButtonElement>('.track-saved-show')][0]!.click()
      expect(deps.onActivate).toHaveBeenCalledWith('b')
      expect(dialog.isOpen()).toBe(false)
    })

    it('the delete button re-renders the list and keeps the dialog open', () => {
      let saved = [other('b'), other('c')]
      const onDelete = vi.fn((id: string) => { saved = saved.filter(t => t.id !== id) })
      const { container, dialog, q } = setup({ getSavedTracks: () => saved, onDelete })
      dialog.open()
      const del = container.querySelector<HTMLButtonElement>('.track-saved-delete')!
      expect(del.getAttribute('aria-label')).toBe('Route löschen')
      del.click()
      expect(onDelete).toHaveBeenCalledWith('b')
      expect(dialog.isOpen()).toBe(true)
      expect(items(container)).toHaveLength(1)
      container.querySelector<HTMLButtonElement>('.track-saved-delete')!.click()
      expect(q('saved').hidden).toBe(true)
    })

    it('refresh() re-renders the list while open', () => {
      let saved: SavedTrack[] = []
      const { container, dialog } = setup({ getSavedTracks: () => saved })
      dialog.open()
      saved = [other('b')]
      dialog.refresh()
      expect(items(container)).toHaveLength(1)
    })
  })

  it('closes on Escape, close button and backdrop click', () => {
    const { container, dialog } = setup()
    dialog.open()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(dialog.isOpen()).toBe(false)
    dialog.open()
    container.querySelector<HTMLButtonElement>('.fav-close')!.click()
    expect(dialog.isOpen()).toBe(false)
    dialog.open()
    container.querySelector<HTMLElement>('.track-panel')!.click()
    expect(dialog.isOpen()).toBe(false)
  })
})
