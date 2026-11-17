import { describe, expect, it, vi } from 'vitest'
import { parseGpx, readGpxFile } from './gpx.js'
import { TrackImportError } from './trackErrors.js'
import { MAX_FILE_BYTES } from './trackTypes.js'

const GPX11 = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="t" xmlns="http://www.topografix.com/GPX/1/1">${body}</gpx>`

function kindOf(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (e) {
    return e instanceof TrackImportError ? e.kind : 'other'
  }
  return undefined
}

describe('parseGpx', () => {
  it('parses GPX 1.1 with default namespace', () => {
    const t = parseGpx(
      GPX11(
        '<metadata><name>Meta</name></metadata><trk><name>Runde</name><trkseg>' +
          '<trkpt lat="50.1" lon="7.2"><ele>10</ele></trkpt><trkpt lat="50.2" lon="7.3"/></trkseg></trk>',
      ),
    )
    expect(t).toEqual({ name: 'Runde', source: 'gpx', points: [[50.1, 7.2], [50.2, 7.3]] })
  })

  it('parses GPX without namespace', () => {
    const t = parseGpx('<gpx><trk><trkseg><trkpt lat="1" lon="2"/><trkpt lat="3" lon="4"/></trkseg></trk></gpx>')
    expect(t.points).toEqual([[1, 2], [3, 4]])
  })

  it('parses prefixed namespaces', () => {
    const t = parseGpx(
      '<g:gpx xmlns:g="http://www.topografix.com/GPX/1/1"><g:trk><g:name>P</g:name><g:trkseg>' +
        '<g:trkpt lat="1" lon="2"/><g:trkpt lat="3" lon="4"/></g:trkseg></g:trk></g:gpx>',
    )
    expect(t.name).toBe('P')
    expect(t.points).toHaveLength(2)
  })

  it('keeps document order across multiple segments and tracks', () => {
    const t = parseGpx(
      GPX11(
        '<trk><trkseg><trkpt lat="1" lon="1"/><trkpt lat="2" lon="2"/></trkseg>' +
          '<trkseg><trkpt lat="3" lon="3"/></trkseg></trk>' +
          '<trk><trkseg><trkpt lat="4" lon="4"/></trkseg></trk>',
      ),
    )
    expect(t.points).toEqual([[1, 1], [2, 2], [3, 3], [4, 4]])
  })

  it('falls back to rtept when there are no trkpt', () => {
    const t = parseGpx(GPX11('<rte><rtept lat="1" lon="1"/><rtept lat="2" lon="2"/></rte>'))
    expect(t.points).toEqual([[1, 1], [2, 2]])
  })

  it('prefers trkpt over rtept', () => {
    const t = parseGpx(
      GPX11(
        '<rte><rtept lat="9" lon="9"/><rtept lat="8" lon="8"/></rte>' +
          '<trk><trkseg><trkpt lat="1" lon="1"/><trkpt lat="2" lon="2"/></trkseg></trk>',
      ),
    )
    expect(t.points).toEqual([[1, 1], [2, 2]])
  })

  it('does not treat waypoints as a track', () => {
    expect(kindOf(() => parseGpx(GPX11('<wpt lat="1" lon="1"/><wpt lat="2" lon="2"/>')))).toBe('no-points')
  })

  it('rejects fewer than two valid points', () => {
    expect(kindOf(() => parseGpx(GPX11('<trk><trkseg><trkpt lat="1" lon="1"/></trkseg></trk>')))).toBe('no-points')
  })

  it('rejects broken XML', () => {
    expect(kindOf(() => parseGpx('<gpx><trk><trkpt lat="1"'))).toBe('invalid-file')
    expect(kindOf(() => parseGpx('not xml at all'))).toBe('invalid-file')
    expect(kindOf(() => parseGpx(''))).toBe('invalid-file')
  })

  it('rejects non-GPX XML', () => {
    expect(
      kindOf(() => parseGpx('<kml xmlns="http://www.opengis.net/kml/2.2"><Placemark/></kml>')),
    ).toBe('invalid-file')
  })

  it('skips points with missing, non-numeric or out-of-range coordinates', () => {
    const t = parseGpx(
      GPX11(
        '<trk><trkseg>' +
          '<trkpt lat="1" lon="1"/>' +
          '<trkpt lon="5"/>' +
          '<trkpt lat="5"/>' +
          '<trkpt lat="abc" lon="5"/>' +
          '<trkpt lat="" lon="5"/>' +
          '<trkpt lat="91" lon="5"/>' +
          '<trkpt lat="5" lon="-181"/>' +
          '<trkpt lat="-90" lon="180"/>' +
          '</trkseg></trk>',
      ),
    )
    expect(t.points).toEqual([[1, 1], [-90, 180]])
  })

  describe('name', () => {
    const seg = '<trk>NAME<trkseg><trkpt lat="1" lon="1"/><trkpt lat="2" lon="2"/></trkseg></trk>'
    it('uses the track name first', () => {
      const xml = GPX11('<metadata><name>Meta</name></metadata>' + seg.replace('NAME', '<name> Spur </name>'))
      expect(parseGpx(xml, 'datei').name).toBe('Spur')
    })
    it('uses the metadata name when the track has none', () => {
      const xml = GPX11('<metadata><name>Meta</name></metadata>' + seg.replace('NAME', ''))
      expect(parseGpx(xml, 'datei').name).toBe('Meta')
    })
    it('uses the fallback name next', () => {
      expect(parseGpx(GPX11(seg.replace('NAME', '')), 'datei').name).toBe('datei')
    })
    it('uses Route as last resort', () => {
      expect(parseGpx(GPX11(seg.replace('NAME', ''))).name).toBe('Route')
      expect(parseGpx(GPX11(seg.replace('NAME', '')), '  ').name).toBe('Route')
    })
    it('ignores waypoint names', () => {
      const xml = GPX11('<wpt lat="1" lon="1"><name>Gipfel</name></wpt>' + seg.replace('NAME', ''))
      expect(parseGpx(xml).name).toBe('Route')
    })
  })
})

describe('readGpxFile', () => {
  const xml = GPX11('<trk><trkseg><trkpt lat="1" lon="1"/><trkpt lat="2" lon="2"/></trkseg></trk>')

  it('rejects oversize files without reading them', async () => {
    const text = vi.fn()
    const file = { size: MAX_FILE_BYTES + 1, name: 'big.gpx', text } as unknown as File
    await expect(readGpxFile(file)).rejects.toMatchObject({ kind: 'file-too-large' })
    expect(text).not.toHaveBeenCalled()
  })

  it('reads the text and uses the file name without .gpx as fallback name', async () => {
    const file = { size: xml.length, name: 'Mein Weg.GPX', text: async () => xml } as unknown as File
    const t = await readGpxFile(file)
    expect(t.name).toBe('Mein Weg')
    expect(t.points).toHaveLength(2)
  })

  it('accepts a file of exactly the maximum size', async () => {
    const file = { size: MAX_FILE_BYTES, name: 'a.gpx', text: async () => xml } as unknown as File
    await expect(readGpxFile(file)).resolves.toMatchObject({ source: 'gpx' })
  })

  it('propagates parse errors', async () => {
    const file = { size: 3, name: 'a.gpx', text: async () => 'abc' } as unknown as File
    await expect(readGpxFile(file)).rejects.toMatchObject({ kind: 'invalid-file' })
  })
})
