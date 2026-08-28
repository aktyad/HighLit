// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAnchor, resolveAnchor } from '../src/anchor'
import { buildStrokePath, buildStrokePaths, createHighlit } from '../src/index'

afterEach(() => {
  document.body.replaceChildren()
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('text anchoring', () => {
  it('restores a selection after surrounding markup changes', () => {
    document.body.innerHTML = '<main>Read <strong>this useful sentence</strong> today.</main>'
    const root = document.querySelector('main')!
    const text = document.querySelector('strong')!.firstChild!
    const range = document.createRange()
    range.setStart(text, 5)
    range.setEnd(text, 11)

    const anchor = createAnchor(range, root)!
    root.innerHTML = 'Read <em>this useful sentence</em> today.'

    expect(anchor.exact).toBe('useful')
    expect(resolveAnchor(anchor, root)?.toString()).toBe('useful')
  })
})

describe('organic stroke', () => {
  it('is stable and joins every selected line into one path', () => {
    const rects = [
      { x: 10, y: 20, width: 150, height: 22 },
      { x: 10, y: 41, width: 70, height: 22 },
    ]
    const first = buildStrokePath(rects, 'same-highlight')
    const second = buildStrokePath(rects, 'same-highlight')

    expect(first).toBe(second)
    expect(first.match(/M /g)).toHaveLength(2)
    expect(buildStrokePaths(rects, 'same-highlight')).toHaveLength(2)
    expect(first).not.toContain('NaN')
    expect(buildStrokePath(rects, 'same-highlight', 0.1)).not.toBe(
      buildStrokePath(rects, 'same-highlight', 0.9),
    )
  })
})

describe('highlighter flow', () => {
  it('captures, renders, persists, and removes a selection', async () => {
    document.body.innerHTML = '<main>Keep this useful sentence for later.</main>'
    Object.defineProperties(Range.prototype, {
      getClientRects: {
        configurable: true,
        value: vi.fn(() => ({
          0: { x: 20, y: 30, left: 20, top: 30, right: 150, bottom: 52, width: 130, height: 22, toJSON() {} },
          length: 1,
          item: () => null,
          [Symbol.iterator]: function* () { yield this[0] },
        } as DOMRectList)),
      },
      getBoundingClientRect: {
        configurable: true,
        value: vi.fn(() => ({
          x: 20, y: 30, left: 20, top: 30, right: 150, bottom: 52, width: 130, height: 22, toJSON() {},
        })),
      },
    })

    const highlit = createHighlit({ root: document.querySelector('main')!, pageKey: 'test' })
    highlit.enable()
    const root = document.querySelector('main')!
    const pressureEvent = (type: string, pressure: number) => Object.assign(
      new Event(type, { bubbles: true }),
      { pointerType: 'pen', pressure },
    )
    root.dispatchEvent(pressureEvent('pointerdown', 0.8))
    root.dispatchEvent(pressureEvent('pointermove', 1))
    const text = document.querySelector('main')!.firstChild!
    const range = document.createRange()
    range.setStart(text, 5)
    range.setEnd(text, 30)
    getSelection()!.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(document.querySelectorAll('svg[data-highlit-ui] path')).toHaveLength(4)
    expect(localStorage.getItem('highlit:test')).toBeNull()

    // Some browsers report no meaningful `button` value on pointer release.
    document.dispatchEvent(new Event('pointerup', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(document.querySelector('svg[data-highlit-ui] path')).not.toBeNull()
    expect(document.querySelectorAll('svg[data-highlit-ui] path')).toHaveLength(4)
    expect(document.querySelector('clipPath[data-highlit-reveal]')).not.toBeNull()
    expect(Number(document.querySelector('linearGradient stop')?.getAttribute('stop-opacity'))).toBeCloseTo(0.70928)
    expect(localStorage.getItem('highlit:test')).toContain('this useful sentence')
    expect(JSON.parse(localStorage.getItem('highlit:test')!)[0].pressure).toBeCloseTo(0.9)

    const replacement = document.createRange()
    replacement.setStart(text, 10)
    replacement.setEnd(text, 16)
    getSelection()!.addRange(replacement)
    document.dispatchEvent(new Event('pointerup', { bubbles: true }))

    const saved = JSON.parse(localStorage.getItem('highlit:test')!)
    expect(saved).toHaveLength(3)
    expect(saved.map((record: { anchor: { exact: string } }) => record.anchor.exact)).toEqual([
      'this ',
      ' sentence for ',
      'useful',
    ])

    highlit.disable()
    document.body.dispatchEvent(new MouseEvent('click', { clientX: 40, clientY: 40, bubbles: true }))
    const host = [...document.querySelectorAll<HTMLElement>('[data-highlit-ui]')]
      .find((element) => element.shadowRoot)!
    const deleteButton = host.shadowRoot!.querySelector<HTMLButtonElement>('.delete')!
    expect(deleteButton.style.left).toBe('68px')
    expect(deleteButton.style.top).toBe('60px')
    const deleteImage = deleteButton.querySelector<HTMLImageElement>('.delete-image')!
    expect(deleteImage.src).toContain('image/svg+xml')
    expect(deleteImage.width).toBe(16)
    deleteButton.click()

    expect(document.querySelector('svg[data-highlit-ui] path')).not.toBeNull()
    highlit.clear()
    expect(document.querySelector('svg[data-highlit-ui] path')).toBeNull()
    expect(localStorage.getItem('highlit:test')).toBe('[]')
    highlit.destroy()
  })

  it('offers highlighting only after a native text selection is finished', async () => {
    document.body.innerHTML = '<main>Select these words normally.</main>'
    Object.defineProperties(Range.prototype, {
      getClientRects: {
        configurable: true,
        value: vi.fn(() => ({
          0: { x: 40, y: 80, left: 40, top: 80, right: 180, bottom: 102, width: 140, height: 22, toJSON() {} },
          length: 1,
          item: () => null,
          [Symbol.iterator]: function* () { yield this[0] },
        } as DOMRectList)),
      },
    })

    const root = document.querySelector('main')!
    const highlit = createHighlit({ root, pageKey: 'native-selection' })
    document.dispatchEvent(Object.assign(new Event('pointerdown'), { pointerType: 'mouse', pressure: 0.5 }))
    const range = document.createRange()
    range.setStart(root.firstChild!, 0)
    range.setEnd(root.firstChild!, 12)
    getSelection()!.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))

    const host = [...document.querySelectorAll<HTMLElement>('[data-highlit-ui]')]
      .find((element) => element.shadowRoot)!
    expect(host.shadowRoot!.querySelector('.launcher')).toBeNull()
    const menu = host.shadowRoot!.querySelector<HTMLDivElement>('.selection-menu')!
    expect(menu.hidden).toBe(true)

    document.dispatchEvent(new Event('pointerup'))
    await new Promise((resolve) => setTimeout(resolve, 180))
    expect(menu.hidden).toBe(false)
    expect(menu.querySelectorAll('.selection-swatch')).toHaveLength(5)
    const firstSwatch = menu.querySelector<HTMLElement>('.selection-swatch')!
    expect(firstSwatch.style.left).toBe('13px')
    expect(firstSwatch.style.getPropertyValue('--color')).toBe('#fff214')
    expect(menu.querySelector<HTMLImageElement>('.selection-menu-image')!.src).toContain('image/svg+xml')
    expect(document.querySelector('style[data-highlit-ui]')).toBeNull()

    menu.querySelector<HTMLButtonElement>('.selection-swatch')!.click()
    expect(localStorage.getItem('highlit:native-selection')).toContain('Select these')
    expect(menu.hidden).toBe(true)
    highlit.destroy()
  })
})
