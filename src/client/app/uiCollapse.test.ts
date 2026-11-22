import { describe, it, expect, vi, afterEach } from 'vitest'
import { createUiCollapse } from './uiCollapse.js'

function setup(over: { mobile?: boolean; ready?: boolean; expanded?: boolean } = {}) {
  const collapseDetail = vi.fn()
  const collapseRoute = vi.fn()
  const ui = createUiCollapse({
    isMobile: () => over.mobile ?? true,
    isReady: () => over.ready ?? true,
    isBoxExpanded: () => over.expanded ?? false,
    collapseDetail,
    collapseRoute,
  })
  return { ui, collapseDetail, collapseRoute }
}

const collapsed = () => document.body.classList.contains('ui-collapsed')

afterEach(() => { document.body.className = ''; vi.useRealTimers() })

describe('createUiCollapse', () => {
  it('folds header and sheets away on mobile', () => {
    const { ui, collapseDetail, collapseRoute } = setup()
    ui.collapse()
    expect(collapsed()).toBe(true)
    expect(collapseDetail).toHaveBeenCalledTimes(1)
    expect(collapseRoute).toHaveBeenCalledTimes(1)
  })

  it('does nothing on desktop', () => {
    const { ui, collapseDetail, collapseRoute } = setup({ mobile: false })
    ui.collapse()
    expect(collapsed()).toBe(false)
    expect(collapseDetail).not.toHaveBeenCalled()
    expect(collapseRoute).not.toHaveBeenCalled()
  })

  it('does nothing before the map is ready', () => {
    const { ui, collapseDetail } = setup({ ready: false })
    ui.collapse()
    expect(collapsed()).toBe(false)
    expect(collapseDetail).not.toHaveBeenCalled()
  })

  it('keeps the header while the search box is expanded, but still folds the sheets', () => {
    const { ui, collapseDetail, collapseRoute } = setup({ expanded: true })
    ui.collapse()
    expect(collapsed()).toBe(false)
    expect(collapseDetail).toHaveBeenCalledTimes(1)
    expect(collapseRoute).toHaveBeenCalledTimes(1)
  })

  it('expand brings the header back', () => {
    const { ui } = setup()
    ui.collapse()
    ui.expand()
    expect(collapsed()).toBe(false)
  })

  it('ignores map moves the app made itself, for a moment', () => {
    vi.useFakeTimers()
    const { ui, collapseDetail } = setup()
    ui.hold()
    ui.collapse()
    expect(collapsed()).toBe(false)
    expect(collapseDetail).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1000)
    ui.collapse()
    expect(collapsed()).toBe(true)
  })
})
