import { describe, it, expect, vi } from 'vitest'
import { createPlaceSuggest } from './placeSuggest.js'
import type { GeocodeOptions, NominatimResult } from '@/core/nominatim.js'

const hit = (lat: string, lon: string, display_name: string): NominatimResult => ({ lat, lon, display_name })

function setup(hits: NominatimResult[], viewbox?: GeocodeOptions['viewbox']) {
  const geocode = vi.fn(async (_q: string, _opts?: GeocodeOptions) => hits)
  const suggest = createPlaceSuggest({ geocode, limit: 6, ...(viewbox ? { getViewbox: () => viewbox } : {}) })
  return { geocode, suggest }
}

describe('createPlaceSuggest', () => {
  it('maps geocoder hits to suggestions with numeric coordinates', async () => {
    const { suggest } = setup([hit('47.66', '9.17', 'Konstanz, Baden-Württemberg, Deutschland')])
    expect(await suggest('Konstanz')).toEqual([
      { label: 'Konstanz, Baden-Württemberg, Deutschland', lat: 47.66, lon: 9.17 },
    ])
  })

  it('passes the limit and the query on', async () => {
    const { suggest, geocode } = setup([])
    await suggest('Lindau')
    expect(geocode).toHaveBeenCalledWith('Lindau', { limit: 6 })
  })

  it('biases the search to the viewbox when there is one', async () => {
    const viewbox = { west: 9, north: 48, east: 10, south: 47 }
    const { suggest, geocode } = setup([], viewbox)
    await suggest('Lindau')
    expect(geocode).toHaveBeenCalledWith('Lindau', { limit: 6, viewbox })
  })

  it('leaves the viewbox out when the map has no bounds yet', async () => {
    const geocode = vi.fn(async (_q: string, _opts?: GeocodeOptions) => [] as NominatimResult[])
    const suggest = createPlaceSuggest({ geocode, limit: 5, getViewbox: () => undefined })
    await suggest('Lindau')
    expect(geocode).toHaveBeenCalledWith('Lindau', { limit: 5 })
  })

  it('drops hits without usable coordinates', async () => {
    const { suggest } = setup([hit('x', '9.17', 'Kaputt'), hit('47.5', '9.7', 'Lindau')])
    expect(await suggest('Lindau')).toEqual([{ label: 'Lindau', lat: 47.5, lon: 9.7 }])
  })
})
