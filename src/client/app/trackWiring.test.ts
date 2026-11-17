import { describe, it, expect, vi, afterEach } from 'vitest'
import { createTrackWiring } from './trackWiring.js'
import type { ITrackStore } from '@/features/track/TrackStore.js'
import type { TrackLayer } from '@/features/track/TrackLayer.js'
import type { Track, TrackPoint } from '@/features/track/trackTypes.js'

const track: Track = {
  name: 'Eifelrunde', source: 'gpx', points: [[50, 7], [50.1, 7.1]], lengthM: 86_432, corridorM: 500,
}

function fakeStore(initial: Track | null = null) {
  let cur = initial
  const listeners: Array<(t: Track | null) => void> = []
  const store: ITrackStore = {
    get: () => cur,
    set: t => { cur = t; listeners.forEach(l => l(t)) },
    setCorridor: () => {},
    clear: () => { cur = null; listeners.forEach(l => l(null)) },
    onChange: l => { listeners.push(l); return () => {} },
  }
  return store
}

function fakeLayer() {
  const calls: string[] = []
  const layer: TrackLayer & { shown: readonly TrackPoint[] | null } = {
    shown: null,
    show(p) { this.shown = p; calls.push('show') },
    fitBounds() { calls.push('fit') },
    setSatellite(on) { calls.push(`sat:${on}`) },
    clear() { this.shown = null; calls.push('clear') },
  }
  return { layer, calls }
}

function setup(initial: Track | null = null, fetchFn?: typeof fetch) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const store = fakeStore(initial)
  const { layer, calls } = fakeLayer()
  const flash = vi.fn()
  const wiring = createTrackWiring({ store, layer, dialogContainer: container, flash, fetchFn })
  const q = <T extends HTMLElement>(r: string) => container.querySelector<T>(`[data-ref="${r}"]`)!
  return { container, store, layer, calls, flash, wiring, q }
}

const flush = () => new Promise(r => setTimeout(r, 0))
afterEach(() => { document.body.innerHTML = '' })

describe('createTrackWiring', () => {
  it('draws a stored track on startup without fitting bounds', () => {
    const { layer, calls } = setup(track)
    expect(layer.shown).toEqual(track.points)
    expect(calls).toEqual(['show'])
  })

  it('draws nothing on startup without a stored track', () => {
    expect(setup().calls).toEqual(['clear'])
  })

  it('open/close/isImportOpen drive the dialog', () => {
    const { wiring } = setup()
    expect(wiring.isImportOpen()).toBe(false)
    wiring.openImport()
    expect(wiring.isImportOpen()).toBe(true)
    wiring.closeImport()
    expect(wiring.isImportOpen()).toBe(false)
  })

  it('setSatellite forwards to the layer', () => {
    const { wiring, calls } = setup()
    wiring.setSatellite(true)
    expect(calls).toContain('sat:true')
  })

  it('a GPX import stores the track, draws it, fits bounds and flashes', async () => {
    const { wiring, store, layer, calls, flash, q } = setup()
    calls.length = 0
    wiring.openImport()
    const gpx = '<gpx><trk><name>Testtour</name><trkseg><trkpt lat="50" lon="7"/><trkpt lat="50.05" lon="7.05"/><trkpt lat="50.1" lon="7.1"/></trkseg></trk></gpx>'
    const file = new File([gpx], 'x.gpx')
    Object.defineProperty(file, 'text', { value: async () => gpx })
    const input = q<HTMLInputElement>('fileInput')
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    input.dispatchEvent(new Event('change'))
    await flush()
    expect(store.get()?.name).toBe('Testtour')
    expect(layer.shown).not.toBeNull()
    expect(calls).toEqual(['show', 'fit'])
    expect(flash).toHaveBeenCalledWith(expect.stringMatching(/^Route geladen: Testtour · \d+,\d km$/))
    expect(wiring.isImportOpen()).toBe(false)
  })

  it('a Komoot link import goes through the injected fetch', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      name: 'Komoot-Tour',
      _embedded: { coordinates: { items: [{ lat: 50, lng: 7 }, { lat: 50.05, lng: 7.05 }, { lat: 50.1, lng: 7.1 }] } },
    }), { status: 200 })) as unknown as typeof fetch
    const { wiring, store, q } = setup(null, fetchFn)
    wiring.openImport()
    q<HTMLInputElement>('linkInput').value = 'https://www.komoot.com/de-de/tour/123456'
    q<HTMLButtonElement>('linkBtn').click()
    await flush()
    expect(fetchFn).toHaveBeenCalled()
    expect(store.get()?.source).toBe('komoot')
  })

  it('"Auf Karte zeigen" fits bounds and closes the dialog', () => {
    const { wiring, calls, q } = setup(track)
    wiring.openImport()
    calls.length = 0
    q<HTMLButtonElement>('show').click()
    expect(calls).toEqual(['fit'])
    expect(wiring.isImportOpen()).toBe(false)
  })

  it('"Route entfernen" clears store and layer, flashes and closes', () => {
    const { wiring, store, layer, flash, q } = setup(track)
    wiring.openImport()
    q<HTMLButtonElement>('remove').click()
    expect(store.get()).toBeNull()
    expect(layer.shown).toBeNull()
    expect(flash).toHaveBeenCalledWith('Route entfernt')
    expect(wiring.isImportOpen()).toBe(false)
  })

  it('an external store change while the dialog is open refreshes the active block', () => {
    const { wiring, store, q } = setup(track)
    wiring.openImport()
    expect(q('active').hidden).toBe(false)
    store.clear()
    expect(q('active').hidden).toBe(true)
  })
})
