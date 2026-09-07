// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAnchor, resolveAnchor } from '../src/anchor'
import { buildStrokePath, buildStrokePaths, createHighlit, humanRevealProgress, positionPopover } from '../src/index'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  getSelection()?.removeAllRanges()
  document.body.replaceChildren()
  localStorage.clear()
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

  it('rejects selections in editable and interactive UI', () => {
    document.body.innerHTML = `
      <main>
        <div contenteditable="true">Editable text</div>
        <div role="textbox">Custom editor</div>
        <button>Button label</button>
        <p data-highlit-ignore>Opted-out text</p>
        <p>Article text</p>
      </main>`
    const root = document.querySelector('main')!

    for (const selector of ['[contenteditable]', '[role="textbox"]', 'button', '[data-highlit-ignore]']) {
      const text = document.querySelector(selector)!.firstChild!
      const range = document.createRange()
      range.selectNodeContents(text)
      expect(createAnchor(range, root)).toBeNull()
    }

    const image = document.createElement('img')
    root.append(image)
    const imageRange = document.createRange()
    imageRange.selectNode(image)
    expect(createAnchor(imageRange, root)).toBeNull()

    const article = document.querySelector('p:not([data-highlit-ignore])')!.firstChild!
    const range = document.createRange()
    range.selectNodeContents(article)
    expect(createAnchor(range, root)?.exact).toBe('Article text')
  })

  it.each(['input', 'textarea', 'select', 'button', 'label', 'a href="/"',
    'div role="dialog"', 'div role="menu"', 'div role="checkbox"',
    'div inert', 'div hidden', 'div aria-hidden="true"', 'div popover',
    'div contenteditable=""'])('ignores %s', (attributes) => {
    const tag = attributes.split(' ')[0]!
    document.body.innerHTML = `<main><${attributes}>Do not mark</${tag}></main>`
    const target = document.querySelector('main')!.firstElementChild!
    const range = document.createRange()
    range.selectNodeContents(target)
    expect(createAnchor(range, document.body)).toBeNull()
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
    expect(buildStrokePath(rects, 'same-highlight', 0.5, 'chisel')).not.toBe(
      buildStrokePath(rects, 'same-highlight', 0.5, 'round'),
    )
    expect(buildStrokePath(rects, 'same-highlight', 0.5, 'round')).not.toBe(
      buildStrokePath(rects, 'same-highlight', 0.5, 'brush'),
    )
  })

  it('reveals left-to-right with stable, uneven hand speed', () => {
    const samples = Array.from({ length: 11 }, (_, index) => humanRevealProgress(index / 10, 'human-stroke'))
    const steps = samples.slice(1).map((value, index) => value - samples[index]!)

    expect(samples[0]).toBe(0)
    expect(samples[samples.length - 1]).toBe(1)
    expect(steps.every((step) => step > 0)).toBe(true)
    expect(Math.max(...steps) - Math.min(...steps)).toBeGreaterThan(0.04)
    expect(samples).toEqual(Array.from({ length: 11 }, (_, index) => humanRevealProgress(index / 10, 'human-stroke')))
  })
})

describe('highlight actions', () => {
  it('places the trash popover outside the full highlight and flips when needed', () => {
    const lines = [
      { left: 20, top: 100, bottom: 122, width: 200 },
      { left: 20, top: 130, bottom: 152, width: 100 },
    ]
    expect(positionPopover(lines, 320, 300)).toEqual({ left: 101, top: 54 })
    expect(positionPopover(lines.map((line) => ({ ...line, top: line.top - 94, bottom: line.bottom - 94 })), 320, 300))
      .toEqual({ left: 51, top: 66 })
  })
})

describe('highlighter flow', () => {
  it.each([3, 4])('limits animation for a %i-line selection', async (lines) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
    document.body.innerHTML = '<main>Several lines of selected text</main>'
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: () => Array.from({ length: lines }, (_, line) => new DOMRect(20, 30 + line * 35, 2000, 22)),
    })
    const highlit = createHighlit({ pageKey: 'long-selection' })
    highlit.enable()
    const range = document.createRange()
    range.selectNodeContents(document.querySelector('main')!.firstChild!)
    getSelection()!.addRange(range)
    document.dispatchEvent(new Event('pointerup'))
    await vi.advanceTimersByTimeAsync(20)
    expect(document.querySelectorAll('svg[data-highlit-ui] > g')).toHaveLength(lines)
    expect(Boolean(document.querySelector('clipPath[data-highlit-reveal]'))).toBe(lines <= 3)
    const initial = document.querySelector('svg > g')
    await vi.advanceTimersByTimeAsync(5000)
    expect(document.querySelector('clipPath[data-highlit-reveal]')).toBeNull()
    if (lines > 3) expect(document.querySelector('svg > g')).toBe(initial)
    const finished = document.querySelector('svg > g')
    await vi.advanceTimersByTimeAsync(100)
    expect(document.querySelector('svg > g')).toBe(finished)
    expect(localStorage.getItem('highlit:long-selection')).toContain('Several lines')
    highlit.destroy()
  })

  it('remounts without resurrecting an unfinished preview', async () => {
    document.body.innerHTML = '<main>Unfinished selection</main>'
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: () => [{ x: 20, y: 30, left: 20, top: 30, right: 150, bottom: 52, width: 130, height: 22 }],
    })
    const highlit = createHighlit()
    highlit.enable()
    const range = document.createRange()
    range.selectNodeContents(document.querySelector('main')!.firstChild!)
    getSelection()!.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    highlit.destroy()
    getSelection()!.removeAllRanges()
    highlit.mount()
    try { expect(document.querySelector('svg[data-highlit-ui] path')).toBeNull() }
    finally { highlit.destroy() }
  })

  it.each(['clear', 'disable', 'destroy'] as const)('%s cancels a queued selection capture', async (action) => {
    document.body.innerHTML = '<main>Do not save this</main>'
    Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
    const highlit = createHighlit({ pageKey: 'cancel' })
    highlit.enable()
    const range = document.createRange()
    range.selectNodeContents(document.querySelector('main')!.firstChild!)
    getSelection()!.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    highlit[action]()
    await new Promise((resolve) => setTimeout(resolve, 180))
    try {
      expect(JSON.parse(localStorage.getItem('highlit:cancel') ?? '[]')).toEqual([])
      expect(document.querySelector('svg[data-highlit-ui] path')).toBeNull()
    } finally { highlit.destroy() }
  })

  it('does not replace custom-storage highlights when browser storage changes', () => {
    document.body.innerHTML = '<main>Saved text</main>'
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn() }
    const highlit = createHighlit({ storage, pageKey: 'custom' })
    storage.getItem.mockClear()
    window.dispatchEvent(new StorageEvent('storage', { key: 'highlit:custom', storageArea: localStorage }))
    try { expect(storage.getItem).not.toHaveBeenCalled() }
    finally { highlit.destroy() }
  })

  it('hides covered ink, responds to modals outside its root, and restores without losing highlights', async () => {
    document.body.innerHTML = '<main>Keep this</main><aside>Overlay</aside>'
    const root = document.querySelector('main')!
    const covering = document.querySelector('aside')!
    const rect = { x: 20, y: 30, left: 20, top: 30, right: 150, bottom: 52, width: 130, height: 22 }
    Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [rect] })
    const hitTest = vi.fn(() => [root, document.body])
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: hitTest })
    localStorage.setItem('highlit:layers', JSON.stringify([
      { id: 'saved', color: 'yellow', anchor: { exact: 'Keep this', prefix: '', suffix: '', start: 0, end: 9 } },
    ]))
    const highlit = createHighlit({ root, pageKey: 'layers' })
    try {
      expect(document.querySelector('svg[data-highlit-ui] path')).not.toBeNull()
      hitTest.mockReturnValue([covering, document.body])
      covering.className = 'open'
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(document.querySelector('svg[data-highlit-ui] path')).toBeNull()
      hitTest.mockReturnValue([root, document.body])
      covering.className = ''
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(document.querySelector('svg[data-highlit-ui] path')).not.toBeNull()
      const dialog = document.createElement('dialog')
      dialog.open = true
      dialog.getClientRects = () => [rect] as unknown as DOMRectList
      document.body.append(dialog)
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(document.querySelector('svg[data-highlit-ui] path')).toBeNull()
      dialog.remove()
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(document.querySelector('svg[data-highlit-ui] path')).not.toBeNull()
      expect(localStorage.getItem('highlit:layers')).toContain('Keep this')
    } finally {
      highlit.destroy()
      Reflect.deleteProperty(document, 'elementsFromPoint')
    }
  })

  it('sweeps on, dries subtly, then stops animating and restores dry', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
    document.body.innerHTML = '<main>Fresh ink</main>'
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: () => [{ x: 20, y: 30, left: 20, top: 30, right: 150, bottom: 52, width: 130, height: 22 }],
    })
    const highlit = createHighlit({ pageKey: 'drying' })
    highlit.enable()
    const range = document.createRange()
    range.selectNodeContents(document.querySelector('main')!.firstChild!)
    getSelection()!.addRange(range)
    document.dispatchEvent(new Event('pointerup'))
    const opacity = () => Number(document.querySelector('linearGradient stop')!.getAttribute('stop-opacity'))
    await vi.advanceTimersByTimeAsync(200)
    const wet = opacity()
    expect(document.querySelector('clipPath[data-highlit-reveal]')).not.toBeNull()
    const shape = document.querySelector('svg > g > path')!.getAttribute('d')
    await vi.advanceTimersByTimeAsync(200)
    expect(opacity()).toBe(wet)
    await vi.advanceTimersByTimeAsync(700)
    const settling = opacity()
    expect(document.querySelector('clipPath[data-highlit-reveal]')).toBeNull()
    await vi.advanceTimersByTimeAsync(1000)
    const dry = opacity()
    expect(wet).toBeGreaterThan(settling)
    expect(settling).toBeGreaterThan(dry)
    expect(wet / dry).toBeCloseTo(1.45)
    expect(document.querySelector('svg > g > path')!.getAttribute('d')).toBe(shape)
    const finished = document.querySelector('svg > g')
    await vi.advanceTimersByTimeAsync(1000)
    expect(document.querySelector('svg > g')).toBe(finished)
    highlit.destroy()
    const restored = createHighlit({ pageKey: 'drying' })
    expect(opacity()).toBe(dry)
    expect(document.querySelector('clipPath[data-highlit-reveal]')).toBeNull()
    restored.destroy()
  })

  it('keeps highlighting usable with blocked storage and respects reduced motion', async () => {
    document.body.innerHTML = '<main>Keep these words.</main>'
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Storage blocked', 'SecurityError')
    })
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: vi.fn(() => [{ x: 20, y: 30, left: 20, top: 30, right: 150, bottom: 52, width: 130, height: 22 }]),
    })
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
    const root = document.querySelector('main')!
    const highlit = createHighlit({ root })
    try {
      highlit.enable()
      const range = document.createRange()
      range.selectNodeContents(root.firstChild!)
      getSelection()!.addRange(range)
      document.dispatchEvent(new Event('pointerup'))
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(document.querySelector('svg[data-highlit-ui] path')).not.toBeNull()
      expect(document.querySelector('clipPath[data-highlit-reveal]')).toBeNull()
      highlit.clear()
      expect(document.querySelector('svg[data-highlit-ui] path')).toBeNull()
    } finally {
      highlit.destroy()
      vi.restoreAllMocks()
    }
  })

  it('ignores malformed saved highlights without breaking startup', () => {
    document.body.innerHTML = '<main>Changed page</main>'
    const anchor = { exact: 'missing', prefix: '', suffix: '', start: 0, end: 7 }
    localStorage.setItem('highlit:invalid', JSON.stringify([
      { id: 'empty', color: 'yellow', anchor: { ...anchor, exact: '' } },
      { id: 'context', color: 'yellow', anchor: { ...anchor, prefix: null } },
      { id: 'offset', color: 'yellow', anchor: { ...anchor, start: -1 } },
      { id: 'pressure', color: 'yellow', anchor, pressure: 'bad' },
    ]))
    const highlit = createHighlit({ pageKey: 'invalid' })
    expect(document.querySelector('svg[data-highlit-ui] path')).toBeNull()
    highlit.destroy()
  })

  it('shares one page scan across saved highlights and responds to storage clearing', () => {
    document.body.innerHTML = '<main>First second</main>'
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: vi.fn(() => [{ x: 20, y: 30, left: 20, top: 30, right: 150, bottom: 52, width: 130, height: 22 }]),
    })
    localStorage.setItem('highlit:scan', JSON.stringify([
      { id: 'first', color: 'yellow', anchor: { exact: 'First', prefix: '', suffix: ' second', start: 0, end: 5 } },
      { id: 'second', color: 'yellow', anchor: { exact: 'second', prefix: 'First ', suffix: '', start: 6, end: 12 } },
    ]))
    const walker = vi.spyOn(document, 'createTreeWalker')
    const highlit = createHighlit({ pageKey: 'scan' })
    expect(walker).toHaveBeenCalledTimes(1)
    expect(document.querySelectorAll('svg[data-highlit-ui] > g')).toHaveLength(2)
    localStorage.clear()
    window.dispatchEvent(new StorageEvent('storage', { key: null }))
    expect(document.querySelector('svg[data-highlit-ui] path')).toBeNull()
    highlit.destroy()
  })

  it('draws only text when a selection also reports an image rectangle', async () => {
    document.body.innerHTML = '<main><img><p>Selected text</p></main>'
    const imageRect = { x: 40, y: 10, left: 40, top: 10, right: 1040, bottom: 710, width: 1000, height: 700, toJSON() {} }
    const textRect = { x: 40, y: 740, left: 40, top: 740, right: 160, bottom: 762, width: 120, height: 22, toJSON() {} }
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: vi.fn(function (this: Range) {
        const rects = this.startContainer.nodeType === Node.TEXT_NODE
          ? [textRect]
          : [imageRect, textRect]
        return Object.assign(rects, {
        item: (index: number) => rects[index] ?? null,
        }) as unknown as DOMRectList
      }),
    })

    const root = document.querySelector('main')!
    const text = document.querySelector('p')!.firstChild!
    const highlit = createHighlit({ root, pageKey: 'text-only-rects' })
    highlit.enable()
    const range = document.createRange()
    range.setStart(root, 0)
    range.setEnd(text, text.textContent!.length)
    getSelection()!.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    await new Promise((resolve) => setTimeout(resolve, 20))

    const path = document.querySelector('svg[data-highlit-ui] path')!.getAttribute('d')!
    const coordinates = path.match(/-?\d+(?:\.\d+)?/g)!.map(Number)
    expect(coordinates.filter((_, index) => index % 2 === 0).every((x) => x < 170)).toBe(true)
    expect(coordinates.filter((_, index) => index % 2 === 1).every((y) => y > 730)).toBe(true)
    expect(document.querySelectorAll('svg[data-highlit-ui] > g')).toHaveLength(1)
    highlit.destroy()
  })

  it('keeps light text legible on dark backgrounds', async () => {
    document.body.innerHTML = '<main style="background: rgb(8, 8, 8); color: rgb(170, 170, 170)">Readable text</main>'
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: vi.fn(() => [{ x: 20, y: 30, left: 20, top: 30, right: 150, bottom: 52, width: 130, height: 22 }]),
    })

    const highlit = createHighlit({ root: document.querySelector('main')!, pageKey: 'dark-page' })
    highlit.enable()
    const range = document.createRange()
    range.selectNodeContents(document.querySelector('main')!.firstChild!)
    getSelection()!.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect([...document.querySelectorAll<SVGPathElement>('svg[data-highlit-ui] path')]
      .every((path) => path.style.mixBlendMode === 'screen')).toBe(true)
    highlit.destroy()
  })

  it('does not offer or preview highlights inside an editor', async () => {
    document.body.innerHTML = '<main><p>Article text</p><input value="Form text"><div contenteditable="true">Draft text</div></main>'
    const root = document.querySelector('main')!
    const input = document.querySelector('input')!
    const editor = document.querySelector<HTMLDivElement>('[contenteditable]')!
    const highlit = createHighlit({ root, pageKey: 'editor' })
    const range = document.createRange()

    input.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    input.dispatchEvent(new Event('pointerup', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 180))
    const host = [...document.querySelectorAll<HTMLElement>('[data-highlit-ui]')]
      .find((element) => element.shadowRoot)!
    expect(host.shadowRoot!.querySelector<HTMLDivElement>('.selection-menu')!.hidden).toBe(true)

    range.selectNodeContents(editor.firstChild!)
    getSelection()!.addRange(range)
    editor.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    editor.dispatchEvent(new Event('pointerup', { bubbles: true }))
    document.dispatchEvent(new Event('selectionchange'))
    await new Promise((resolve) => setTimeout(resolve, 180))
    expect(getSelection()?.toString()).toBe('Draft text')
    expect(host.shadowRoot!.querySelector<HTMLDivElement>('.selection-menu')!.hidden).toBe(true)

    highlit.enable()
    document.dispatchEvent(new Event('selectionchange'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(document.querySelector('svg[data-highlit-ui] path')).toBeNull()
    expect(localStorage.getItem('highlit:editor')).toBeNull()
    highlit.destroy()
  })

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

    expect(document.querySelectorAll('svg[data-highlit-ui] > g path')).toHaveLength(3)
    expect(document.querySelector('svg[data-highlit-ui] path[stroke]')).toBeNull()
    expect(localStorage.getItem('highlit:test')).toBeNull()

    // Some browsers report no meaningful `button` value on pointer release.
    document.dispatchEvent(new Event('pointerup', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(document.querySelector('svg[data-highlit-ui] path')).not.toBeNull()
    expect(document.querySelectorAll('svg[data-highlit-ui] > g path')).toHaveLength(3)
    expect(document.querySelector('clipPath[data-highlit-reveal]')).not.toBeNull()
    expect(document.querySelector('clipPath[data-highlit-reveal] path')?.getAttribute('d')).toContain(' L ')
    expect(Number(document.querySelector('linearGradient stop')?.getAttribute('stop-opacity'))).toBeCloseTo(0.5106816 * 1.45)
    expect(localStorage.getItem('highlit:test')).toContain('this useful sentence')
    expect(JSON.parse(localStorage.getItem('highlit:test')!)[0].pressure).toBeCloseTo(0.9)
    expect(JSON.parse(localStorage.getItem('highlit:test')!)[0].createdAt).toEqual(expect.any(Number))

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

    highlit.enable()
    document.body.dispatchEvent(new MouseEvent('click', { clientX: 40, clientY: 40, bubbles: true }))
    const host = [...document.querySelectorAll<HTMLElement>('[data-highlit-ui]')]
      .find((element) => element.shadowRoot)!
    const deleteButton = host.shadowRoot!.querySelector<HTMLButtonElement>('.delete')!
    expect(deleteButton.style.left).toBe('66px')
    expect(deleteButton.style.top).toBe('60px')
    window.dispatchEvent(new Event('scroll'))
    expect(deleteButton.hasAttribute('data-open')).toBe(false)
    document.body.dispatchEvent(new MouseEvent('click', { clientX: 40, clientY: 40, bubbles: true }))
    const deleteImage = deleteButton.querySelector<HTMLImageElement>('.delete-image')!
    expect(deleteImage.src).toContain('image/svg+xml')
    expect(deleteImage.width).toBe(20)
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
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 192, bottom: 37, width: 192, height: 37, toJSON() {},
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
    expect(menu.style.top).toBe('112px')
    expect(menu.hasAttribute('data-below')).toBe(true)
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(150)
    window.dispatchEvent(new Event('resize'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(menu.style.top).toBe('33px')
    expect(menu.hasAttribute('data-below')).toBe(false)
    expect(menu.querySelectorAll('.selection-swatch')).toHaveLength(6)
    const firstSwatch = menu.querySelector<HTMLElement>('.selection-swatch')!
    expect(firstSwatch.style.getPropertyValue('--color')).toBe('#756257')
    expect(menu.querySelector('.style-picker')).toBeNull()
    expect(menu.querySelector('[data-selected]')).toBeNull()
    expect(document.querySelector('style[data-highlit-ui]')).toBeNull()
    expect(localStorage.getItem('highlit:native-selection')).toBeNull()

    const secondSwatch = menu.querySelectorAll<HTMLButtonElement>('.selection-swatch')[1]!
    secondSwatch.click()
    expect(localStorage.getItem('highlit:native-selection')).toContain('Select these')
    expect(JSON.parse(localStorage.getItem('highlit:native-selection')!)[0].style).toBe('chisel')
    expect(JSON.parse(localStorage.getItem('highlit:native-selection')!)[0].color).toBe('#2bc96a')
    expect(menu.querySelector('[data-selected]')).toBeNull()
    expect(menu.hidden).toBe(true)
    highlit.destroy()
  })
})
