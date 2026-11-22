import { describe, it, expect, vi, afterEach } from 'vitest'
import { downloadTextFile } from './downloadTextFile.js'

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); document.body.innerHTML = '' })

describe('downloadTextFile', () => {
  it('clicks a temporary anchor with download name and blob URL, then cleans up', () => {
    vi.useFakeTimers()
    const create = vi.fn(() => 'blob:test-1')
    const revoke = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }))
    let seen: { download: string; href: string; inDom: boolean } | null = null
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      seen = { download: this.download, href: this.getAttribute('href') ?? '', inDom: document.body.contains(this) }
    })

    downloadTextFile('tour-orte.gpx', 'application/gpx+xml', '<gpx/>')

    expect(create).toHaveBeenCalledTimes(1)
    const blob = (create.mock.calls[0] as unknown as [Blob])[0]
    expect(blob.type).toBe('application/gpx+xml')
    expect(seen).toEqual({ download: 'tour-orte.gpx', href: 'blob:test-1', inDom: true })
    expect(document.querySelector('a')).toBeNull()
    expect(revoke).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(revoke).toHaveBeenCalledWith('blob:test-1')
  })
})
