import { createAnchor, createTextIndex, isHighlightableNode, isHighlightableRange, resolveAnchor, type TextAnchor } from './anchor'
import deleteImage from './assets/highlit-delete.svg'

export const DEFAULT_COLORS = [
  '#756257',
  '#2bc96a',
  '#53c8e5',
  '#a178e4',
  '#f24043',
  '#f3cf4f',
] as const

export type HighlighterStyle = 'chisel' | 'round' | 'brush'
export const DEFAULT_STYLES: readonly HighlighterStyle[] = ['chisel']

export interface HighLitStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface HighLitOptions {
  /** A stable identifier for the current page. Defaults to location.pathname. */
  pageKey?: string
  /** Highlight colours shown in the picker. */
  colors?: readonly string[]
  /** Marker tips; the first entry determines the stroke style. */
  styles?: readonly HighlighterStyle[]
  /** Element whose text can be highlighted. Defaults to document.body. */
  root?: HTMLElement
  /** Storage implementation. Defaults to localStorage. */
  storage?: HighLitStorage
}

interface HighlightRecord {
  id: string
  color: string
  style?: HighlighterStyle
  anchor: TextAnchor
  pressure?: number
  createdAt?: number
}

interface RenderedHighlight {
  record: HighlightRecord
  range: Range
}

const SVG_NS = 'http://www.w3.org/2000/svg'
const INK_OPACITY = 0.72
// Sweep each line, briefly hold the wet ink, then let it settle.
const INK_TIMING = { minSweep: 340, maxSweep: 880, wetHold: 250, dry: 1050 } as const
const WET_INK_BOOST = 0.45
const MAX_ANIMATED_LINES = 3
const MAX_ANIMATION_MS = 5000

function lineTiming(width: number, seed: string) {
  const pace = (0.55 + (hash(`${seed}:pace`) % 35) / 100) * 1.25
  return {
    sweep: Math.min(INK_TIMING.maxSweep, Math.max(INK_TIMING.minSweep, width / pace)),
    pause: 55 + hash(`${seed}:pause`) % 65,
  }
}

function uid(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function isSafeColor(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 256 || /\\|(?:url|var|env|attr)\s*\(/i.test(value)) return false
  const style = document.createElement('span').style
  style.color = value
  return style.color !== ''
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

/** Maps clock time to uneven, always-forward hand movement. */
export function humanRevealProgress(value: number, seedValue: string): number {
  const progress = Math.min(1, Math.max(0, value))
  if (progress === 0 || progress === 1) return progress

  const jitter = random(hash(seedValue))
  const segments = [
    { time: 0.14, speed: 0.55 + jitter() * 0.25 },
    { time: 0.26, speed: 1.05 + jitter() * 0.4 },
    { time: 0.32, speed: 0.72 + jitter() * 0.48 },
    { time: 0.28, speed: 0.6 + jitter() * 0.3 },
  ]
  const distance = segments.reduce((total, segment) => total + segment.time * segment.speed, 0)
  let elapsed = 0
  let travelled = 0
  for (const segment of segments) {
    if (progress <= elapsed + segment.time) {
      return (travelled + (progress - elapsed) * segment.speed) / distance
    }
    elapsed += segment.time
    travelled += segment.time * segment.speed
  }
  return 1
}

function rangeClientRects(range: Range, visibleOnly = true): DOMRect[] {
  const owner = range.startContainer.ownerDocument ?? document
  const root = range.commonAncestorContainer
  const texts: Text[] = []
  if (root.nodeType === Node.TEXT_NODE) {
    texts.push(root as Text)
  } else {
    const walker = owner.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = walker.nextNode())) texts.push(node as Text)
  }

  const rects = texts.flatMap((text) => {
    if (!isHighlightableNode(text)) return []
    try {
      if (!range.intersectsNode(text)) return []
    } catch {
      return []
    }

    const start = text === range.startContainer ? range.startOffset : 0
    const end = text === range.endContainer ? range.endOffset : text.length
    if (start >= end || !text.data.slice(start, end).trim()) return []

    const textRange = owner.createRange()
    textRange.setStart(text, start)
    textRange.setEnd(text, end)
    return [...textRange.getClientRects()].filter((rect) =>
      rect.width > 0 && rect.height > 0 && (!visibleOnly || isUncovered(rect, text.parentElement!)),
    )
  })

  return rects.filter((rect, index) => !rects.some((other, otherIndex) =>
    index !== otherIndex &&
    rect.width * rect.height > other.width * other.height * 2 &&
    rect.left <= other.left && rect.top <= other.top &&
    rect.right >= other.right && rect.bottom >= other.bottom,
  ))
}

// Be conservative: hide an obscured line instead of painting over a site's UI.
function isUncovered(rect: DOMRect, source: Element): boolean {
  if (!document.elementsFromPoint) return true
  for (const x of [rect.left + 1, (rect.left + rect.right) / 2, rect.right - 1]) {
    for (const y of [rect.top + 1, (rect.top + rect.bottom) / 2, rect.bottom - 1]) {
      const top = document.elementsFromPoint(x, y)
        .find((element) => !element.closest('[data-highlit-ui]'))
      if (!top || !isHighlightableNode(top) || top !== source) return false
    }
  }
  return true
}

function colorLuminance(value: string): { luminance: number; alpha: number } | undefined {
  const values = value.match(/[\d.]+/g)?.map(Number)
  if (!values || values.length < 3) return undefined
  const channels = values.slice(0, 3).map((channel) => {
    const value = channel! / 255
    return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
  })
  return {
    luminance: channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722,
    alpha: values[3] ?? 1,
  }
}

function markerBlendMode(range: Range): 'multiply' | 'screen' {
  const element = range.startContainer.nodeType === Node.ELEMENT_NODE
    ? range.startContainer as Element
    : range.startContainer.parentElement
  if (!element) return 'multiply'

  const foreground = colorLuminance(getComputedStyle(element).color)?.luminance
  for (let current: Element | null = element; current; current = current.parentElement) {
    const background = colorLuminance(getComputedStyle(current).backgroundColor)
    if (background && background.alpha >= 0.85) {
      return foreground !== undefined && foreground > background.luminance ? 'screen' : 'multiply'
    }
  }
  return foreground !== undefined && foreground > 0.35 ? 'screen' : 'multiply'
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
      merged.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
    }
  }
  return merged
}

function buildStrokeShapes(
  rects: StrokeRect[],
  seedValue: string,
  pressureValue = 0.5,
  style: HighlighterStyle = 'chisel',
): StrokeShape[] {
  const pressure = normalizePressure(pressureValue)
  const spread = (pressure - 0.5) * 2
  const bands = mergeLineRects(rects).map((rect) => ({
    left: rect.x - 2.5,
    right: rect.x + rect.width + 2.5,
    top: rect.y + rect.height * 0.06 - 1 - spread,
    bottom: rect.y + rect.height * 0.94 + 1.5 + spread,
  }))

  return bands.map((band, line) => {
    const rand = random(hash(`${seedValue}-${line}`))
    const jitter = (amount = 1) => (rand() - 0.5) * amount * 2
    const left = band.left - rand() * 1.5
    const right = band.right + rand() * 1.5
    const top = band.top
    const bottom = band.bottom
    const quarter = (right - left) / 4
    const middle = (top + bottom) / 2

    const d = style === 'round'
      ? [
          `M ${left + 2} ${top + jitter(0.8)}`,
          `Q ${left - 3} ${middle}, ${left + 1} ${bottom + jitter(0.8)}`,
          `C ${left + quarter} ${bottom + jitter(0.7)}, ${right - quarter} ${bottom + jitter(0.7)}, ${right - 1} ${bottom + jitter(0.8)}`,
          `Q ${right + 3} ${middle}, ${right - 1} ${top + jitter(0.8)}`,
          `C ${right - quarter} ${top + jitter(0.7)}, ${left + quarter} ${top + jitter(0.7)}, ${left + 2} ${top + jitter(0.8)}`,
          'Z',
        ].join(' ')
      : style === 'brush'
        ? [
            `M ${left + 1} ${top + jitter()}`,
            `C ${left - 2} ${top + 2}, ${left - 2} ${middle - 2}, ${left} ${bottom + jitter()}`,
            `C ${left + quarter} ${bottom + jitter()}, ${right - quarter} ${bottom - 1 + jitter()}, ${right + 2} ${middle + jitter(0.8)}`,
            `C ${right - quarter} ${top + 1 + jitter()}, ${left + quarter} ${top + jitter()}, ${left + 1} ${top + jitter()}`,
            'Z',
          ].join(' ')
        : [
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

    return {
      d,
      startDeposit,
      endDeposit,
      left,
      right,
      top,
      bottom,
    }
  })
}

/** Builds stable, slightly imperfect marker strokes from browser line boxes. */
export function buildStrokePaths(
  rects: StrokeRect[],
  seedValue: string,
  pressure = 0.5,
  style: HighlighterStyle = 'chisel',
): string[] {
  return buildStrokeShapes(rects, seedValue, pressure, style).map(({ d }) => d)
}

export function buildStrokePath(
  rects: StrokeRect[],
  seedValue: string,
  pressure = 0.5,
  style: HighlighterStyle = 'chisel',
): string {
  return buildStrokePaths(rects, seedValue, pressure, style).join(' ')
}

export function positionPopover(
  rects: Array<Pick<DOMRect, 'left' | 'top' | 'bottom' | 'width'>>,
  viewportWidth: number,
  viewportHeight: number,
): { left: number; top: number } {
  const size = 38
  const gap = 8
  const margin = 8
  const visible = rects.filter((rect) => rect.bottom > margin && rect.top < viewportHeight - margin)
  const first = visible[0] ?? rects[0]
  const last = visible[visible.length - 1] ?? rects[rects.length - 1] ?? first
  if (!first || !last) return { left: margin, top: margin }

  const above = first.top - gap - size
  const below = last.bottom + gap
  const placeBelow = above < margin && (
    below + size <= viewportHeight - margin || viewportHeight - last.bottom > first.top
  )
  const anchor = placeBelow ? last : first
  const maxLeft = Math.max(margin, viewportWidth - margin - size)
  const maxTop = Math.max(margin, viewportHeight - margin - size)
  return {
    left: Math.min(maxLeft, Math.max(margin, anchor.left + anchor.width / 2 - size / 2)),
    top: Math.min(maxTop, Math.max(margin, placeBelow ? below : above)),
  }
}

export class HighLit {
  private readonly options: Required<Pick<HighLitOptions, 'pageKey' | 'colors' | 'styles' | 'root' | 'storage'>>
  private readonly storageKey: string
  private records: HighlightRecord[] = []
  private rendered: RenderedHighlight[] = []
  private revealStarts = new Map<string, number>()
  private active = false
  private selectedColor: string
  private selectedStyle: HighlighterStyle
  private mounted = false
  private frame = 0
  private captureTimer = 0
  private selectionMenuTimer = 0
  private pointerSelecting = false
  private pointerIgnored = false
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
  private readonly customStorage: boolean

  constructor(options: HighLitOptions = {}) {
    this.customStorage = options.storage !== undefined
    const root = options.root ?? document.body
    const storage = options.storage ?? {
      getItem: (key: string) => window.localStorage.getItem(key),
      setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
    }
    const validColors = options.colors?.filter(isSafeColor)
    const colors = validColors?.length ? validColors : DEFAULT_COLORS
    const styles = options.styles?.length ? options.styles : DEFAULT_STYLES
    this.options = {
      pageKey: options.pageKey ?? window.location.pathname,
      colors,
      styles,
      root,
      storage,
    }
    this.storageKey = `highlit:${this.options.pageKey}`
    this.selectedColor = colors[0] ?? '#fff214'
    this.selectedStyle = styles[0] ?? 'chisel'
  }

  mount(): this {
    if (this.mounted) return this
    this.mounted = true
    this.read()
    this.createOverlay()
    this.createControls()
    this.bind()
    this.options.root.toggleAttribute('data-highlit-active', this.active)
    this.render()
    return this
  }

  destroy(): void {
    if (!this.mounted) return
    this.mounted = false
    this.clearPreview()
    this.hideSelectionMenu()
    this.hideDelete()
    this.pointerSelecting = false
    this.pointerIgnored = false
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
    window.removeEventListener('resize', this.onViewportChange)
    window.removeEventListener('scroll', this.onViewportChange, true)
    window.removeEventListener('storage', this.onStorage)
    document.removeEventListener('toggle', this.onViewportChange, true)
    document.removeEventListener('transitionend', this.onViewportChange, true)
    document.removeEventListener('animationend', this.onViewportChange, true)
    this.options.root.removeEventListener('webkitmouseforcewillbegin', this.onForceWillBegin, true)
    this.options.root.removeEventListener('webkitmouseforcechanged', this.onForceChange, true)
    this.overlay?.remove()
    this.host?.remove()
    this.rendered = []
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
    window.clearTimeout(this.captureTimer)
    this.hideSelectionMenu()
    this.clearPreview()
    const selection = document.getSelection()
    if (selection?.rangeCount && this.options.root.contains(selection.getRangeAt(0).commonAncestorContainer)) {
      selection.removeAllRanges()
    }
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
            return typeof record.id === 'string' && isSafeColor(record.color) &&
              typeof record.anchor?.exact === 'string' && record.anchor.exact.trim().length > 0 &&
              typeof record.anchor.prefix === 'string' && typeof record.anchor.suffix === 'string' &&
              Number.isSafeInteger(record.anchor.start) && Number.isSafeInteger(record.anchor.end) &&
              record.anchor.start >= 0 && record.anchor.end > record.anchor.start &&
              (record.pressure === undefined || (typeof record.pressure === 'number' && Number.isFinite(record.pressure))) &&
              (record.style === undefined || ['chisel', 'round', 'brush'].includes(record.style))
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
      zIndex: '1',
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
      zIndex: '2',
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
          position: fixed; display: flex; gap: 4px; align-items: center; width: max-content;
          padding: 4px; border: 1px solid #e8e8e8; border-radius: 999px; background: #fff;
          box-shadow: 0 6px 12px rgba(50,50,93,.25), 0 3px 7px rgba(0,0,0,.3);
          transform: translateX(-50%); pointer-events: auto;
        }
        .selection-menu[hidden] { display: none; }
        .selection-swatch {
          flex: 0 0 auto; width: 27px; height: 27px; padding: 0;
          border: 0; border-radius: 50%; background: var(--color); cursor: pointer;
          transition: box-shadow 120ms ease, transform 120ms ease;
        }
        .selection-swatch:hover { box-shadow: inset 0 0 0 2px #fff; }
        .selection-swatch:active { transform: scale(.94); }
        .delete {
          position: fixed; display: none; width: 38px; height: 38px; padding: 8px;
          border: 1px solid rgba(0,0,0,.1); border-radius: 50%;
          background: #fff;
          cursor: pointer; pointer-events: auto;
        }
        .delete[data-open] { display: grid; place-items: center; }
        .delete:hover { background: #f7f7f7; }
        .delete:focus-visible { outline: 2px solid #111; outline-offset: 2px; }
        .delete-image { display: block; width: 20px; height: 20px; max-width: none; pointer-events: none; }
        @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
      </style>
      <button class="delete" type="button" aria-label="Remove highlight">
        <img class="delete-image" width="20" height="20" alt="" aria-hidden="true">
      </button>
      <div class="selection-menu" role="toolbar" aria-label="Choose a highlight colour" hidden></div>`

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
    const selectionColors = this.options.colors.slice(0, 6)
    selectionColors.forEach((color, index) => {
      const swatch = document.createElement('button')
      swatch.className = 'selection-swatch'
      swatch.type = 'button'
      swatch.dataset.color = color.toLowerCase()
      swatch.setAttribute('aria-label', `Highlight with colour ${index + 1}`)
      swatch.style.setProperty('--color', color)
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
    window.addEventListener('resize', this.onViewportChange)
    window.addEventListener('scroll', this.onViewportChange, true)
    window.addEventListener('storage', this.onStorage)
    document.addEventListener('toggle', this.onViewportChange, true)
    document.addEventListener('transitionend', this.onViewportChange, true)
    document.addEventListener('animationend', this.onViewportChange, true)
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
    this.observer.observe(document.body, {
      subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ['class', 'style', 'open', 'hidden', 'inert', 'aria-hidden', 'aria-modal'],
    })
  }

  private setActive(active: boolean): void {
    window.clearTimeout(this.captureTimer)
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
    this.pointerIgnored = !isHighlightableNode(event.target)
    if (this.pointerIgnored) {
      this.pointerSelecting = false
      this.hideSelectionMenu()
      if (this.active) this.clearPreview()
      return
    }
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
    if (this.active && isHighlightableNode(event.target)) event.preventDefault()
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
    const pointerIgnored = this.pointerIgnored || !isHighlightableNode(event.target)
    this.pointerSelecting = false
    this.pointerIgnored = false
    if (event.composedPath().includes(this.host as EventTarget)) return
    if (pointerIgnored) {
      this.hideSelectionMenu()
      if (this.active) this.clearPreview()
      return
    }
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

    if (range && isHighlightableRange(range, this.options.root)) {
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
    if (!this.saveRange(range, this.selectedColor, this.currentPressure(), this.previewId ?? uid(), this.selectedStyle)) {
      this.clearPreview()
      return
    }
    this.previewId = undefined
    this.previewRange = undefined
    this.resetPressure()
    selection.removeAllRanges()
    this.render()
  }

  private saveRange(
    range: Range,
    color: string,
    pressure: number,
    id = uid(),
    style: HighlighterStyle = this.selectedStyle,
  ): boolean {
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
    this.records.push({ id, color, style, anchor, pressure: normalizePressure(pressure), createdAt: Date.now() })
    if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      // Count the full selection, including lines outside the viewport.
      const lines = mergeLineRects(rangeClientRects(range, false))
      if (lines.length > 0 && lines.length <= MAX_ANIMATED_LINES) {
        const strokes = buildStrokeShapes(lines, id, pressure, style)
        const duration = strokes.reduce((total, stroke, line) => {
          const timing = lineTiming(stroke.right - stroke.left, `${id}:${line}`)
          return total + timing.sweep + (line < strokes.length - 1 ? timing.pause : 0)
        }, INK_TIMING.wetHold + INK_TIMING.dry)
        if (duration <= MAX_ANIMATION_MS) this.revealStarts.set(id, performance.now())
      }
    }
    this.write()
    return true
  }

  private highlightPendingSelection(color: string): void {
    if (!this.pendingSelection) return
    if (this.saveRange(this.pendingSelection, color, 0.5, uid(), this.selectedStyle)) {
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
      if (range && isHighlightableRange(range, this.options.root)) this.showSelectionMenu(range)
      else this.hideSelectionMenu()
    }, delay)
  }

  private positionSelectionMenu(): void {
    if (!this.selectionMenu || !this.pendingSelection || this.selectionMenu.hidden) return
    const rects = rangeClientRects(this.pendingSelection)
    const first = rects[0]
    const last = rects[rects.length - 1]
    if (!first || !last) return this.hideSelectionMenu()

    const menuRect = this.selectionMenu.getBoundingClientRect()
    const below = last.bottom + menuRect.height + 18 <= window.innerHeight
    const anchor = below ? last : first
    const left = Math.min(window.innerWidth - menuRect.width / 2 - 8, Math.max(menuRect.width / 2 + 8, anchor.left + anchor.width / 2))
    this.selectionMenu.style.left = `${left}px`
    this.selectionMenu.style.top = `${below ? last.bottom + 10 : Math.max(8, first.top - menuRect.height - 10)}px`
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
    if (event.composedPath().includes(this.host as EventTarget)) return
    if (!isHighlightableNode(event.target)) {
      this.hideDelete()
      return
    }
    const found = [...this.rendered].reverse().find(({ range }) =>
      rangeClientRects(range).some((rect) =>
        event.clientX >= rect.left - 3 && event.clientX <= rect.right + 3 &&
        event.clientY >= rect.top - 3 && event.clientY <= rect.bottom + 3,
      ),
    )
    if (!found) {
      this.hideDelete()
      return
    }

    const position = positionPopover(rangeClientRects(found.range), window.innerWidth, window.innerHeight)
    this.pendingDelete = found.record.id
    if (this.deleteButton) {
      this.deleteButton.style.left = `${position.left}px`
      this.deleteButton.style.top = `${position.top}px`
      this.deleteButton.dataset.open = ''
    }
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    this.hideSelectionMenu()
    this.active ? this.disable() : this.hideDelete()
  }

  private onStorage = (event: StorageEvent): void => {
    if (this.customStorage) return
    if (event.storageArea && event.storageArea !== window.localStorage) return
    if (event.key !== null && event.key !== this.storageKey) return
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

  private onViewportChange = (): void => {
    this.hideDelete()
    this.scheduleRender()
  }

  private render(): void {
    if (!this.mounted || !this.overlay) return
    this.overlay.replaceChildren()
    this.rendered = []
    const modalOpen = [...document.querySelectorAll('dialog[open], [aria-modal="true"]')]
      .some((element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden')
    if (modalOpen) {
      this.hideSelectionMenu()
      this.hideDelete()
      this.revealStarts.clear()
      return
    }
    const defs = document.createElementNS(SVG_NS, 'defs')
    const gradients = new Map<string, string>()
    const finishedReveals = new Set<string>()
    const now = performance.now()
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    let needsAnimationFrame = false
    this.overlay.append(defs)

    const inkGradient = (color: string, pressureValue: number, inkDensity: number): string => {
      const pressure = normalizePressure(pressureValue)
      const key = `${color}:${pressure}:${inkDensity}`
      const existing = gradients.get(key)
      if (existing) return existing

      const id = `highlit-ink-${hash(key).toString(36)}`
      const density = (0.82 + pressure * 0.36) * inkDensity
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
        stop.setAttribute('stop-opacity', String(Number(opacity) * density * INK_OPACITY))
        gradient.append(stop)
      })
      defs.append(gradient)
      gradients.set(key, id)
      return id
    }

    const draw = (
      range: Range,
      color: string,
      id: string,
      pressureValue = 0.5,
      style: HighlighterStyle = 'chisel',
    ): boolean => {
      const pressure = normalizePressure(pressureValue)
      const rects = rangeClientRects(range)
        .map(({ x, y, width, height }) => ({ x, y, width, height }))
      if (!rects.length) return false

      const blendMode = markerBlendMode(range)
      const strokes = buildStrokeShapes(rects, id, pressure, style)
      const revealStart = this.revealStarts.get(id)
      const elapsed = reducedMotion || revealStart === undefined ? Infinity : now - revealStart
      let lineStart = 0
      let revealFinished = true

      for (const [line, stroke] of strokes.entries()) {
        const motionSeed = `${id}:${line}`
        const timing = lineTiming(stroke.right - stroke.left, motionSeed)
        const lineDuration = timing.sweep
        const progress = Math.min(1, Math.max(0, (elapsed - lineStart) / lineDuration))
        const revealProgress = humanRevealProgress(progress, motionSeed)
        const group = document.createElementNS(SVG_NS, 'g')
        const dryProgress = Math.min(1, Math.max(0,
          (elapsed - lineStart - lineDuration - INK_TIMING.wetHold) / INK_TIMING.dry,
        ))
        const inkDensity = 1 + WET_INK_BOOST * (1 - dryProgress * dryProgress * (3 - 2 * dryProgress))
        // A stable, sub-pixel rise or fall across the line, never frame-to-frame wobble.
        const drift = ((hash(`${motionSeed}:tilt`) % 101) / 100 - 0.5) * 1.2
        const tilt = drift / Math.max(1, stroke.right - stroke.left)
        group.setAttribute('transform', `matrix(1 ${tilt} 0 1 0 ${-tilt * (stroke.left + stroke.right) / 2})`)
        if (revealStart !== undefined && dryProgress < 1) {
          revealFinished = false
          needsAnimationFrame = true
        }

        if (revealStart !== undefined && progress < 1) {
          revealFinished = false
          needsAnimationFrame = true
          const clipId = `highlit-reveal-${hash(`${id}-${line}`).toString(36)}`
          const clip = document.createElementNS(SVG_NS, 'clipPath')
          const reveal = document.createElementNS(SVG_NS, 'path')
          const left = stroke.left - 3
          const right = stroke.right + 3
          const top = stroke.top - 3
          const bottom = stroke.bottom + 3
          const head = left + (right - left) * revealProgress
          const slant = (3 + pressure * 3) * (hash(`${motionSeed}:slant`) % 2 ? 1 : -1)
          const topHead = Math.min(right, Math.max(left, head + slant))
          const bottomHead = Math.min(right, Math.max(left, head - slant))
          clip.id = clipId
          clip.dataset.highlitReveal = ''
          clip.setAttribute('clipPathUnits', 'userSpaceOnUse')
          reveal.setAttribute('d', `M ${left} ${top} H ${topHead} L ${bottomHead} ${bottom} H ${left} Z`)
          clip.append(reveal)
          defs.append(clip)
          group.setAttribute('clip-path', `url(#${clipId})`)
        }

        const path = document.createElementNS(SVG_NS, 'path')
        path.setAttribute('d', stroke.d)
        path.setAttribute('fill', `url(#${inkGradient(color, pressure, inkDensity)})`)
        path.style.mixBlendMode = blendMode
        group.append(path)

        const startDeposit = document.createElementNS(SVG_NS, 'path')
        startDeposit.setAttribute('d', stroke.startDeposit)
        startDeposit.setAttribute('fill', color)
        startDeposit.setAttribute('fill-opacity', String((0.1 + pressure * 0.08) * INK_OPACITY * inkDensity))
        startDeposit.style.mixBlendMode = blendMode
        group.append(startDeposit)

        const endDeposit = document.createElementNS(SVG_NS, 'path')
        endDeposit.setAttribute('d', stroke.endDeposit)
        endDeposit.setAttribute('fill', color)
        endDeposit.setAttribute('fill-opacity', String((0.045 + pressure * 0.04) * INK_OPACITY * inkDensity))
        endDeposit.style.mixBlendMode = blendMode
        group.append(endDeposit)

        this.overlay!.append(group)
        lineStart += lineDuration + timing.pause
      }
      if (revealStart !== undefined && revealFinished) finishedReveals.add(id)
      return true
    }

    const textIndex = this.records.length ? createTextIndex(this.options.root) : undefined
    for (const record of this.records) {
      const range = resolveAnchor(record.anchor, this.options.root, textIndex)
      if (!range) {
        this.revealStarts.delete(record.id)
        continue
      }
      const visibleRanges = this.previewRange
        ? subtractRange(range, this.previewRange, record.id)
        : [{ range, id: record.id }]
      visibleRanges.forEach((fragment) => draw(
        fragment.range,
        record.color,
        fragment.id,
        record.pressure,
        record.style ?? 'chisel',
      ))
      this.rendered.push({ record, range })
    }

    if (this.previewRange && this.previewId) {
      draw(this.previewRange, this.selectedColor, this.previewId, this.currentPressure(), this.selectedStyle)
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
