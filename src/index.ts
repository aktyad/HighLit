import { createAnchor, resolveAnchor, type TextAnchor } from './anchor'
import deleteImage from './assets/highlit-delete.svg'
import selectionMenuImage from './assets/highlit-selection-menu.svg'

export const DEFAULT_COLORS = [
  '#fff214',
  '#5cff32',
  '#38c8f4',
  '#ff4fa3',
  '#ff8a1f',
] as const

export interface HighLitStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface HighLitOptions {
  /** A stable identifier for the current page. Defaults to location.pathname. */
  pageKey?: string
  /** Highlight colours shown in the picker. */
  colors?: readonly string[]
  /** Element whose text can be highlighted. Defaults to document.body. */
  root?: HTMLElement
  /** Storage implementation. Defaults to localStorage. */
  storage?: HighLitStorage
}

interface HighlightRecord {
  id: string
  color: string
  anchor: TextAnchor
  pressure?: number
}

interface RenderedHighlight {
  record: HighlightRecord
  range: Range
}

const SVG_NS = 'http://www.w3.org/2000/svg'

function uid(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function hash(value: string): number {
  let result = 2166136261
  for (let i = 0; i < value.length; i++) {
    result ^= value.charCodeAt(i)
    result = Math.imul(result, 16777619)
  }
  return result >>> 0
}

function random(seed: number): () => number {
  let state = seed || 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 4294967296
  }
}

function rangesOverlap(first: Range, second: Range): boolean {
  return first.compareBoundaryPoints(Range.START_TO_END, second) > 0 &&
    first.compareBoundaryPoints(Range.END_TO_START, second) < 0
}

function subtractRange(existing: Range, cutter: Range, id: string): Array<{ range: Range; id: string }> {
  if (!rangesOverlap(existing, cutter)) return [{ range: existing, id }]

  const fragments: Array<{ range: Range; id: string }> = []
  if (existing.compareBoundaryPoints(Range.START_TO_START, cutter) < 0) {
    const left = existing.cloneRange()
    left.setEnd(cutter.startContainer, cutter.startOffset)
    fragments.push({ range: left, id })
  }
  if (cutter.compareBoundaryPoints(Range.END_TO_END, existing) < 0) {
    const right = existing.cloneRange()
    right.setStart(cutter.endContainer, cutter.endOffset)
    fragments.push({ range: right, id: `${id}:r` })
  }
  return fragments
}

interface StrokeRect {
  x: number
  y: number
  width: number
  height: number
}

interface StrokeShape {
  d: string
  startDeposit: string
  endDeposit: string
  grain: string
  grainWidth: number
  left: number
  right: number
  top: number
  bottom: number
}

type ForceMouseEvent = MouseEvent & { readonly webkitForce?: number }
type ForceMouseEventConstructor = typeof MouseEvent & {
  readonly WEBKIT_FORCE_AT_FORCE_MOUSE_DOWN?: number
}

function normalizePressure(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : 0.5
}

function mergeLineRects(rects: StrokeRect[]): StrokeRect[] {
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x)
  const merged: StrokeRect[] = []

  for (const rect of sorted) {
    const previous = merged[merged.length - 1]
    if (previous && Math.abs(previous.y - rect.y) < 2 && rect.x - (previous.x + previous.width) < 5) {
      const right = Math.max(previous.x + previous.width, rect.x + rect.width)
      previous.x = Math.min(previous.x, rect.x)
      previous.width = right - previous.x
      previous.height = Math.max(previous.height, rect.height)
    } else {
      merged.push({ ...rect })
    }
  }
  return merged
}

function buildStrokeShapes(rects: StrokeRect[], seedValue: string, pressureValue = 0.5): StrokeShape[] {
  const pressure = normalizePressure(pressureValue)
  const spread = (pressure - 0.5) * 2
  const bands = mergeLineRects(rects).map((rect) => ({
    left: rect.x - 2.5,
    right: rect.x + rect.width + 2.5,
    top: rect.y + rect.height * 0.06 - 1 - spread,
    bottom: rect.y + rect.height * 0.94 + 1.5 + spread,
  }))

  // Wrapped lines share a little paint where their horizontal spans overlap.
  for (let line = 1; line < bands.length; line++) {
    const previous = bands[line - 1]!
    const current = bands[line]!
    const gap = current.top - previous.bottom
    const overlap = Math.min(previous.right, current.right) - Math.max(previous.left, current.left)
    if (gap > 0 && gap < 14 && overlap > 3) {
      const join = (previous.bottom + current.top) / 2
      previous.bottom = join + 0.8
      current.top = join - 0.8
    }
  }

  return bands.map((band, line) => {
    const rand = random(hash(`${seedValue}-${line}`))
    const jitter = (amount = 1.4) => (rand() - 0.5) * amount * 2
    const left = band.left - rand() * 1.5
    const right = band.right + rand() * 1.5
    const top = band.top
    const bottom = band.bottom
    const quarter = (right - left) / 4
    const middle = (top + bottom) / 2

    const d = [
      `M ${left + 1} ${top + jitter()}`,
      `C ${left - 1.5} ${top + 2}, ${left - 2} ${middle - 2}, ${left} ${bottom + jitter()}`,
      `L ${left + quarter} ${bottom + jitter()}`,
      `L ${left + quarter * 2} ${bottom + jitter()}`,
      `L ${left + quarter * 3} ${bottom + jitter()}`,
      `L ${right - 1} ${bottom + jitter()}`,
      `Q ${right + 2.5} ${middle}, ${right} ${top + jitter()}`,
      `L ${left + quarter * 3} ${top + jitter()}`,
      `L ${left + quarter * 2} ${top + jitter()}`,
      `L ${left + quarter} ${top + jitter()}`,
      'Z',
    ].join(' ')

    const startWidth = Math.min(11, Math.max(4.5, (right - left) * 0.075))
    const endWidth = Math.min(7, Math.max(3, (right - left) * 0.045))
    const startLean = jitter(1.8)
    const endLean = jitter(1.2)
    const startDeposit = [
      `M ${left + 0.5 + startLean} ${top + jitter(0.7)}`,
      `L ${left + startWidth} ${top + jitter(0.8)}`,
      `L ${left + startWidth * 0.82} ${bottom + jitter(0.8)}`,
      `L ${left - 0.5 - startLean} ${bottom + jitter(0.7)}`,
      'Z',
    ].join(' ')
    const endDeposit = [
      `M ${right - endWidth} ${top + jitter(0.7)}`,
      `L ${right + endLean} ${top + jitter(0.6)}`,
      `L ${right - endLean} ${bottom + jitter(0.6)}`,
      `L ${right - endWidth * 0.8} ${bottom + jitter(0.7)}`,
      'Z',
    ].join(' ')
    const grain = [
      `M ${left + startWidth * 0.6} ${top + 2 + jitter(0.45)}`,
      `C ${left + quarter} ${top + 1.6 + jitter(0.4)}, ${left + quarter * 3} ${top + 2.4 + jitter(0.4)}, ${right - endWidth} ${top + 2 + jitter(0.45)}`,
      `M ${left + startWidth * 0.7} ${bottom - 2.2 + jitter(0.4)}`,
      `C ${left + quarter} ${bottom - 1.8 + jitter(0.4)}, ${left + quarter * 3} ${bottom - 2.5 + jitter(0.4)}, ${right - endWidth} ${bottom - 2.1 + jitter(0.4)}`,
    ].join(' ')

    return {
      d,
      startDeposit,
      endDeposit,
      grain,
      grainWidth: Math.min(1.15, Math.max(0.65, (bottom - top) * 0.045)),
      left,
      right,
      top,
      bottom,
    }
  })
}

/** Builds stable, slightly imperfect marker strokes from browser line boxes. */
export function buildStrokePaths(rects: StrokeRect[], seedValue: string, pressure = 0.5): string[] {
  return buildStrokeShapes(rects, seedValue, pressure).map(({ d }) => d)
}

export function buildStrokePath(rects: StrokeRect[], seedValue: string, pressure = 0.5): string {
  return buildStrokePaths(rects, seedValue, pressure).join(' ')
}

export class HighLit {
  private readonly options: Required<Pick<HighLitOptions, 'pageKey' | 'colors' | 'root' | 'storage'>>
  private readonly storageKey: string
  private records: HighlightRecord[] = []
  private rendered: RenderedHighlight[] = []
  private revealStarts = new Map<string, number>()
  private active = false
  private selectedColor: string
  private mounted = false
  private frame = 0
  private captureTimer = 0
  private selectionMenuTimer = 0
  private pointerSelecting = false
  private pressureTotal = 0
  private pressureSamples = 0
  private previewId?: string
  private previewRange?: Range
  private overlay?: SVGSVGElement
  private host?: HTMLDivElement
  private shadow?: ShadowRoot
  private deleteButton?: HTMLButtonElement
  private selectionMenu?: HTMLDivElement
  private pendingSelection?: Range
  private pendingDelete?: string
  private observer?: MutationObserver

  constructor(options: HighLitOptions = {}) {
    const root = options.root ?? document.body
    const storage = options.storage ?? window.localStorage
    const colors = options.colors?.length ? options.colors : DEFAULT_COLORS
    this.options = {
      pageKey: options.pageKey ?? window.location.pathname,
      colors,
      root,
      storage,
    }
    this.storageKey = `highlit:${this.options.pageKey}`
    this.selectedColor = colors[0] ?? '#fff214'
  }

  mount(): this {
    if (this.mounted) return this
    this.mounted = true
    this.read()
    this.createOverlay()
    this.createControls()
    this.bind()
    this.render()
    return this
  }

  destroy(): void {
    if (!this.mounted) return
    this.mounted = false
    cancelAnimationFrame(this.frame)
    window.clearTimeout(this.captureTimer)
    window.clearTimeout(this.selectionMenuTimer)
    this.observer?.disconnect()
    document.removeEventListener('pointerdown', this.onPointerDown, true)
    document.removeEventListener('pointermove', this.onPointerMove, true)
    document.removeEventListener('pointerup', this.onPointerUp, true)
    document.removeEventListener('selectionchange', this.onSelectionChange)
    document.removeEventListener('click', this.onDocumentClick, true)
    document.removeEventListener('keydown', this.onKeyDown, true)
    window.removeEventListener('resize', this.scheduleRender)
    window.removeEventListener('scroll', this.scheduleRender, true)
    window.removeEventListener('storage', this.onStorage)
    this.options.root.removeEventListener('webkitmouseforcewillbegin', this.onForceWillBegin, true)
    this.options.root.removeEventListener('webkitmouseforcechanged', this.onForceChange, true)
    this.overlay?.remove()
    this.host?.remove()
    this.revealStarts.clear()
    this.options.root.removeAttribute('data-highlit-active')
  }

  enable(): void {
    this.setActive(true)
  }

  disable(): void {
    this.setActive(false)
  }

  clear(): void {
    this.records = []
    this.revealStarts.clear()
    this.write()
    this.hideDelete()
    this.render()
  }

  private read(): void {
    try {
      const value = JSON.parse(this.options.storage.getItem(this.storageKey) ?? '[]') as unknown
      this.records = Array.isArray(value)
        ? value.filter((item): item is HighlightRecord => {
            if (!item || typeof item !== 'object') return false
            const record = item as Partial<HighlightRecord>
            return typeof record.id === 'string' && typeof record.color === 'string' &&
              typeof record.anchor?.exact === 'string' &&
              Number.isFinite(record.anchor.start) && Number.isFinite(record.anchor.end)
          })
        : []
    } catch {
      this.records = []
    }
  }

  private write(): void {
    try {
      this.options.storage.setItem(this.storageKey, JSON.stringify(this.records))
    } catch {
      // A full or unavailable storage should never break the host page.
    }
  }

  private createOverlay(): void {
    const overlay = document.createElementNS(SVG_NS, 'svg')
    overlay.dataset.highlitUi = ''
    overlay.setAttribute('aria-hidden', 'true')
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      width: '100vw',
      height: '100vh',
      overflow: 'visible',
      pointerEvents: 'none',
      zIndex: '2147483645',
    })
    document.body.append(overlay)
    this.overlay = overlay
  }

  private createControls(): void {
    const host = document.createElement('div')
    host.dataset.highlitUi = ''
    host.setAttribute('aria-label', 'HighLit controls')
    Object.assign(host.style, {
      position: 'fixed',
      inset: '0',
      width: '0',
      height: '0',
      zIndex: '2147483647',
      pointerEvents: 'none',
    })

    const shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML = `
      <style>
        :host { all: initial; color-scheme: light; }
        *, *::before, *::after { box-sizing: border-box; }
        button { font: inherit; -webkit-tap-highlight-color: transparent; }
        .selection-swatch:focus-visible, .delete:focus-visible {
          outline: 2px solid #111; outline-offset: 2px;
        }
        .selection-menu {
          position: fixed; display: block; width: 130px; height: 42px; border-radius: 21px;
          background: rgba(255,255,255,.001); isolation: isolate; overflow: visible;
          -webkit-backdrop-filter: blur(3px) saturate(1.08);
          backdrop-filter: blur(3px) saturate(1.08);
          transform: translateX(-50%); pointer-events: auto;
        }
        .selection-menu[hidden] { display: none; }
        .selection-menu-image {
          position: absolute; z-index: 1; left: -3.164px; top: -3.692px;
          display: block; width: 153.908px; height: 65.908px; max-width: none;
          pointer-events: none;
        }
        .selection-swatch {
          position: absolute; z-index: 2; top: 9px; width: 24px; height: 24px; padding: 0;
          border: 1.412px solid transparent; border-radius: 50%;
          background:
            linear-gradient(var(--color), var(--color)) padding-box,
            linear-gradient(145deg, rgba(255,255,255,.9), rgba(255,255,255,.28) 52%, rgba(255,255,255,.68)) border-box;
          box-shadow: inset 0 1px 0 rgba(255,255,255,.18), 0 1px 2px rgba(34,29,26,.08);
          cursor: pointer; transform: translateY(0) scale(1); transform-origin: center;
          transition: transform 180ms cubic-bezier(.2,1.35,.3,1), filter 130ms ease, box-shadow 180ms ease;
        }
        .selection-swatch:is(:hover, :focus-visible) {
          z-index: 8; transform: translateY(-4px) scale(1.1); filter: brightness(1.05) saturate(1.03);
          box-shadow: inset 0 1px 0 rgba(255,255,255,.28), 0 5px 8px rgba(34,29,26,.12);
        }
        .selection-swatch:active { transform: translateY(-2px) scale(1.06); }
        .delete {
          position: fixed; display: none; width: 34px; height: 34px; padding: 8px;
          border: 1px solid #e1e1e1; border-radius: 51px;
          background: rgba(255,255,255,.32);
          -webkit-backdrop-filter: blur(3px) saturate(1.08); backdrop-filter: blur(3px) saturate(1.08);
          box-shadow: 8.79px 8.262px 11.954px rgba(0,0,0,.04);
          cursor: pointer; pointer-events: auto;
        }
        .delete[data-open] { display: grid; place-items: center; }
        .delete-image { display: block; width: 16px; height: 16px; max-width: none; pointer-events: none; }
        @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
      </style>
      <button class="delete" type="button" aria-label="Remove highlight">
        <img class="delete-image" width="16" height="16" alt="" aria-hidden="true">
      </button>
      <div class="selection-menu" role="toolbar" aria-label="Highlight selection" hidden>
        <img class="selection-menu-image" alt="" aria-hidden="true">
      </div>`

    const deleteButton = shadow.querySelector<HTMLButtonElement>('.delete')!
    deleteButton.addEventListener('click', () => {
      if (!this.pendingDelete) return
      this.revealStarts.delete(this.pendingDelete)
      this.records = this.records.filter(({ id }) => id !== this.pendingDelete)
      this.write()
      this.hideDelete()
      this.render()
    })

    document.body.append(host)
    this.host = host
    this.shadow = shadow
    this.deleteButton = deleteButton
    this.selectionMenu = shadow.querySelector<HTMLDivElement>('.selection-menu')!
    shadow.querySelector<HTMLImageElement>('.delete-image')!.src = deleteImage
    shadow.querySelector<HTMLImageElement>('.selection-menu-image')!.src = selectionMenuImage
    const selectionColors = Array.from(
      { length: 5 },
      (_, index) => this.options.colors[index % this.options.colors.length]!,
    )
    selectionColors.forEach((color, index) => {
      const swatch = document.createElement('button')
      swatch.className = 'selection-swatch'
      swatch.type = 'button'
      swatch.setAttribute('aria-label', `Highlight with colour ${index + 1}`)
      swatch.style.setProperty('--color', color)
      swatch.style.left = `${13 + index * 20}px`
      swatch.addEventListener('pointerdown', (event) => event.preventDefault())
      swatch.addEventListener('click', () => this.highlightPendingSelection(color))
      this.selectionMenu!.append(swatch)
    })
  }

  private bind(): void {
    document.addEventListener('pointerdown', this.onPointerDown, true)
    document.addEventListener('pointermove', this.onPointerMove, true)
    document.addEventListener('pointerup', this.onPointerUp, true)
    document.addEventListener('selectionchange', this.onSelectionChange)
    document.addEventListener('click', this.onDocumentClick, true)
    document.addEventListener('keydown', this.onKeyDown, true)
    window.addEventListener('resize', this.scheduleRender)
    window.addEventListener('scroll', this.scheduleRender, true)
    window.addEventListener('storage', this.onStorage)
    this.options.root.addEventListener('webkitmouseforcewillbegin', this.onForceWillBegin, true)
    this.options.root.addEventListener('webkitmouseforcechanged', this.onForceChange, true)

    this.observer = new MutationObserver((mutations) => {
      const pageChanged = mutations.some(({ target }) => {
        const element = target.nodeType === Node.ELEMENT_NODE
          ? target as Element
          : target.parentElement
        return !element?.closest('[data-highlit-ui]')
      })
      if (pageChanged) this.scheduleRender()
    })
    this.observer.observe(this.options.root, { subtree: true, childList: true, characterData: true })
  }

  private setActive(active: boolean): void {
    this.active = active
    this.pointerSelecting = false
    this.resetPressure()
    this.hideSelectionMenu()
    if (!active) this.clearPreview()
    this.hideDelete()
    this.options.root.toggleAttribute('data-highlit-active', active)
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.composedPath().includes(this.host as EventTarget)) return
    this.pointerSelecting = true
    this.hideSelectionMenu()
    if (!this.active) return
    this.resetPressure()
    if (event.pointerType !== 'mouse') this.recordPressure(event.pressure)
    this.previewId = uid()
    this.previewRange = undefined
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.active || !this.pointerSelecting || event.pointerType === 'mouse') return
    this.recordPressure(event.pressure)
  }

  private onForceWillBegin: EventListener = (event) => {
    if (this.active) event.preventDefault()
  }

  private onForceChange: EventListener = (event) => {
    if (!this.active || !this.pointerSelecting) return
    const force = (event as ForceMouseEvent).webkitForce
    const threshold = (MouseEvent as ForceMouseEventConstructor).WEBKIT_FORCE_AT_FORCE_MOUSE_DOWN
    if (typeof force === 'number' && typeof threshold === 'number' && threshold > 0) {
      this.recordPressure(force / threshold)
    }
  }

  private recordPressure(value: number): void {
    this.pressureTotal += normalizePressure(value)
    this.pressureSamples++
    if (this.previewRange) this.scheduleRender()
  }

  private currentPressure(): number {
    return this.pressureSamples ? this.pressureTotal / this.pressureSamples : 0.5
  }

  private resetPressure(): void {
    this.pressureTotal = 0
    this.pressureSamples = 0
  }

  private onPointerUp = (event: PointerEvent): void => {
    this.pointerSelecting = false
    if (event.composedPath().includes(this.host as EventTarget)) return
    if (!this.active) {
      this.scheduleSelectionMenu(0)
      return
    }
    window.clearTimeout(this.captureTimer)
    this.captureSelection()
  }

  private onSelectionChange = (): void => {
    const selection = document.getSelection()
    const range = selection && selection.rangeCount > 0 && !selection.isCollapsed
      ? selection.getRangeAt(0)
      : undefined

    if (!this.active) {
      if (this.pointerSelecting) this.hideSelectionMenu()
      else this.scheduleSelectionMenu()
      return
    }

    this.hideSelectionMenu()

    if (range && this.options.root.contains(range.commonAncestorContainer)) {
      this.previewId ??= uid()
      this.previewRange = range.cloneRange()
      this.scheduleRender()
      if (!this.pointerSelecting) this.scheduleCapture(140)
    } else {
      this.clearPreview()
    }
  }

  private scheduleCapture(delay: number): void {
    window.clearTimeout(this.captureTimer)
    this.captureTimer = window.setTimeout(() => this.captureSelection(), delay)
  }

  private captureSelection(): void {
    const selection = document.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      this.clearPreview()
      return
    }
    const range = selection.getRangeAt(0)
    if (!this.saveRange(range, this.selectedColor, this.currentPressure(), this.previewId ?? uid())) {
      this.clearPreview()
      return
    }
    this.previewId = undefined
    this.previewRange = undefined
    this.resetPressure()
    selection.removeAllRanges()
    this.render()
  }

  private saveRange(range: Range, color: string, pressure: number, id = uid()): boolean {
    const anchor = createAnchor(range, this.options.root)
    if (!anchor) return false

    this.records = this.records.flatMap((record) => {
      const existing = resolveAnchor(record.anchor, this.options.root)
      if (!existing) return [record]
      return subtractRange(existing, range, record.id).flatMap((fragment) => {
        const fragmentAnchor = createAnchor(fragment.range, this.options.root)
        return fragmentAnchor ? [{ ...record, id: fragment.id, anchor: fragmentAnchor }] : []
      })
    })
    this.records.push({ id, color, anchor, pressure: normalizePressure(pressure) })
    if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      this.revealStarts.set(id, performance.now())
    }
    this.write()
    return true
  }

  private highlightPendingSelection(color: string): void {
    if (!this.pendingSelection) return
    if (this.saveRange(this.pendingSelection, color, 0.5)) {
      document.getSelection()?.removeAllRanges()
      this.hideSelectionMenu()
      this.render()
    }
  }

  private showSelectionMenu(range: Range): void {
    this.pendingSelection = range.cloneRange()
    if (!this.selectionMenu) return
    this.selectionMenu.hidden = false
    this.positionSelectionMenu()
  }

  private scheduleSelectionMenu(delay = 140): void {
    window.clearTimeout(this.selectionMenuTimer)
    this.selectionMenuTimer = window.setTimeout(() => {
      const selection = document.getSelection()
      const range = selection && selection.rangeCount > 0 && !selection.isCollapsed
        ? selection.getRangeAt(0)
        : undefined
      if (range && this.options.root.contains(range.commonAncestorContainer)) this.showSelectionMenu(range)
      else this.hideSelectionMenu()
    }, delay)
  }

  private positionSelectionMenu(): void {
    if (!this.selectionMenu || !this.pendingSelection || this.selectionMenu.hidden) return
    const rect = [...this.pendingSelection.getClientRects()].find(({ width, height }) => width > 0 && height > 0)
    if (!rect) return this.hideSelectionMenu()

    const menuRect = this.selectionMenu.getBoundingClientRect()
    const left = Math.min(window.innerWidth - menuRect.width / 2 - 8, Math.max(menuRect.width / 2 + 8, rect.left + rect.width / 2))
    const above = rect.top - menuRect.height - 10
    const below = above < 8
    this.selectionMenu.style.left = `${left}px`
    this.selectionMenu.style.top = `${below ? rect.bottom + 10 : above}px`
    this.selectionMenu.toggleAttribute('data-below', below)
  }

  private hideSelectionMenu(): void {
    window.clearTimeout(this.selectionMenuTimer)
    this.pendingSelection = undefined
    if (this.selectionMenu) this.selectionMenu.hidden = true
  }

  private clearPreview(): void {
    const hadPreview = Boolean(this.previewRange)
    this.previewId = undefined
    this.previewRange = undefined
    this.resetPressure()
    if (hadPreview) this.scheduleRender()
  }

  private onDocumentClick = (event: MouseEvent): void => {
    if (this.active || event.composedPath().includes(this.host as EventTarget)) return
    const found = [...this.rendered].reverse().find(({ range }) =>
      [...range.getClientRects()].some((rect) =>
        event.clientX >= rect.left - 3 && event.clientX <= rect.right + 3 &&
        event.clientY >= rect.top - 3 && event.clientY <= rect.bottom + 3,
      ),
    )
    if (!found) {
      this.hideDelete()
      return
    }

    const rect = found.range.getBoundingClientRect()
    this.pendingDelete = found.record.id
    if (this.deleteButton) {
      const left = Math.min(window.innerWidth - 42, Math.max(8, rect.left + rect.width / 2 - 17))
      const above = rect.top - 42
      this.deleteButton.style.left = `${left}px`
      this.deleteButton.style.top = `${above >= 8 ? above : rect.bottom + 8}px`
      this.deleteButton.dataset.open = ''
    }
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    this.hideSelectionMenu()
    this.active ? this.disable() : this.hideDelete()
  }

  private onStorage = (event: StorageEvent): void => {
    if (event.key !== this.storageKey) return
    this.read()
    this.render()
  }

  private hideDelete(): void {
    this.pendingDelete = undefined
    this.deleteButton?.removeAttribute('data-open')
  }

  private scheduleRender = (): void => {
    cancelAnimationFrame(this.frame)
    this.frame = requestAnimationFrame(() => this.render())
  }

  private render(): void {
    if (!this.overlay) return
    this.overlay.replaceChildren()
    this.rendered = []
    const defs = document.createElementNS(SVG_NS, 'defs')
    const gradients = new Map<string, string>()
    const finishedReveals = new Set<string>()
    const now = performance.now()
    let needsAnimationFrame = false
    this.overlay.append(defs)

    const inkGradient = (color: string, pressureValue: number): string => {
      const pressure = normalizePressure(pressureValue)
      const key = `${color}:${Math.round(pressure * 20)}`
      const existing = gradients.get(key)
      if (existing) return existing

      const id = `highlit-ink-${hash(key).toString(36)}`
      const density = 0.82 + pressure * 0.36
      const gradient = document.createElementNS(SVG_NS, 'linearGradient')
      gradient.id = id
      gradient.setAttribute('x1', '0%')
      gradient.setAttribute('x2', '100%')
      ;([
        ['0%', '0.62'],
        ['5%', '0.52'],
        ['18%', '0.43'],
        ['60%', '0.45'],
        ['92%', '0.47'],
        ['100%', '0.55'],
      ] as const).forEach(([offset, opacity]) => {
        const stop = document.createElementNS(SVG_NS, 'stop')
        stop.setAttribute('offset', offset)
        stop.setAttribute('stop-color', color)
        stop.setAttribute('stop-opacity', String(Number(opacity) * density))
        gradient.append(stop)
      })
      defs.append(gradient)
      gradients.set(key, id)
      return id
    }

    const draw = (range: Range, color: string, id: string, pressureValue = 0.5): boolean => {
      const pressure = normalizePressure(pressureValue)
      const rects = [...range.getClientRects()]
        .filter(({ width, height }) => width > 0 && height > 0)
        .map(({ x, y, width, height }) => ({ x, y, width, height }))
      if (!rects.length) return false

      const strokes = buildStrokeShapes(rects, id, pressure)
      const revealStart = this.revealStarts.get(id)
      const elapsed = revealStart === undefined ? Infinity : now - revealStart
      let lineStart = 0
      let revealFinished = true

      for (const [line, stroke] of strokes.entries()) {
        const lineDuration = Math.min(520, Math.max(180, (stroke.right - stroke.left) / 1.4))
        const progress = Math.min(1, Math.max(0, (elapsed - lineStart) / lineDuration))
        const easedProgress = 1 - Math.pow(1 - progress, 3)
        const group = document.createElementNS(SVG_NS, 'g')

        if (revealStart !== undefined && progress < 1) {
          revealFinished = false
          needsAnimationFrame = true
          const clipId = `highlit-reveal-${hash(`${id}-${line}`).toString(36)}`
          const clip = document.createElementNS(SVG_NS, 'clipPath')
          const reveal = document.createElementNS(SVG_NS, 'rect')
          clip.id = clipId
          clip.dataset.highlitReveal = ''
          clip.setAttribute('clipPathUnits', 'userSpaceOnUse')
          reveal.setAttribute('x', String(stroke.left - 3))
          reveal.setAttribute('y', String(stroke.top - 3))
          reveal.setAttribute('width', String((stroke.right - stroke.left + 6) * easedProgress))
          reveal.setAttribute('height', String(stroke.bottom - stroke.top + 6))
          clip.append(reveal)
          defs.append(clip)
          group.setAttribute('clip-path', `url(#${clipId})`)
        }

        const path = document.createElementNS(SVG_NS, 'path')
        path.setAttribute('d', stroke.d)
        path.setAttribute('fill', `url(#${inkGradient(color, pressure)})`)
        path.style.mixBlendMode = 'multiply'
        group.append(path)

        const startDeposit = document.createElementNS(SVG_NS, 'path')
        startDeposit.setAttribute('d', stroke.startDeposit)
        startDeposit.setAttribute('fill', color)
        startDeposit.setAttribute('fill-opacity', String(0.1 + pressure * 0.08))
        startDeposit.style.mixBlendMode = 'multiply'
        group.append(startDeposit)

        const endDeposit = document.createElementNS(SVG_NS, 'path')
        endDeposit.setAttribute('d', stroke.endDeposit)
        endDeposit.setAttribute('fill', color)
        endDeposit.setAttribute('fill-opacity', String(0.045 + pressure * 0.04))
        endDeposit.style.mixBlendMode = 'multiply'
        group.append(endDeposit)

        const grain = document.createElementNS(SVG_NS, 'path')
        grain.setAttribute('d', stroke.grain)
        grain.setAttribute('fill', 'none')
        grain.setAttribute('stroke', color)
        grain.setAttribute('stroke-opacity', String(0.07 + pressure * 0.04))
        grain.setAttribute('stroke-width', String(stroke.grainWidth))
        grain.setAttribute('stroke-linecap', 'round')
        grain.style.mixBlendMode = 'multiply'
        group.append(grain)
        this.overlay!.append(group)
        lineStart += lineDuration + 45
      }
      if (revealStart !== undefined && revealFinished) finishedReveals.add(id)
      return true
    }

    for (const record of this.records) {
      const range = resolveAnchor(record.anchor, this.options.root)
      if (!range) {
        this.revealStarts.delete(record.id)
        continue
      }
      const visibleRanges = this.previewRange
        ? subtractRange(range, this.previewRange, record.id)
        : [{ range, id: record.id }]
      visibleRanges.forEach((fragment) => draw(fragment.range, record.color, fragment.id, record.pressure))
      this.rendered.push({ record, range })
    }

    if (this.previewRange && this.previewId) {
      draw(this.previewRange, this.selectedColor, this.previewId, this.currentPressure())
    }
    finishedReveals.forEach((id) => this.revealStarts.delete(id))
    this.positionSelectionMenu()
    if (needsAnimationFrame) this.scheduleRender()
  }
}

export function createHighlit(options: HighLitOptions = {}): HighLit {
  return new HighLit(options).mount()
}

export type { TextAnchor } from './anchor'
