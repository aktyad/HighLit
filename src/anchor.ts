export interface TextAnchor {
  exact: string
  prefix: string
  suffix: string
  start: number
  end: number
}

interface TextEntry {
  node: Text
  start: number
  end: number
}

const EXCLUDED = [
  'script', 'style', 'noscript',
  'input', 'textarea', 'select', 'option', 'button', 'summary',
  'a[href]', 'label', 'dialog', '[popover]', '[inert]', '[hidden]', '[aria-hidden="true"]',
  '[role="dialog"]', '[role="alertdialog"]', '[role="menu"]', '[role="listbox"]',
  '[role="slider"]', '[role="checkbox"]', '[role="radio"]', '[role="switch"]',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="textbox"]', '[role="searchbox"]', '[role="combobox"]', '[role="spinbutton"]', '[role="button"]',
  '[data-highlit-ignore]', '[data-highlit-ui]',
].join(', ')

export function isHighlightableRange(range: Range, root: HTMLElement): boolean {
  if (range.collapsed || !range.toString().trim() || !root.contains(range.commonAncestorContainer)) return false
  const common = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? range.commonAncestorContainer as Element
    : range.commonAncestorContainer.parentElement
  if (!common || common.closest(EXCLUDED)) return false

  return ![...common.querySelectorAll(EXCLUDED)].some((element) => {
    try {
      return range.intersectsNode(element)
    } catch {
      return false
    }
  })
}

export function isHighlightableNode(node: EventTarget | null): boolean {
  const element = node instanceof Element
    ? node
    : node instanceof Node
      ? node.parentElement
      : null
  return !element?.closest(EXCLUDED)
}

function textEntries(root: HTMLElement): TextEntry[] {
  const view = root.ownerDocument.defaultView
  if (!view) return []

  const walker = root.ownerDocument.createTreeWalker(
    root,
    view.NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const parent = (node as Text).parentElement
        return parent?.closest(EXCLUDED)
          ? view.NodeFilter.FILTER_REJECT
          : view.NodeFilter.FILTER_ACCEPT
      },
    },
  )

  const entries: TextEntry[] = []
  let offset = 0
  let node: Node | null
  while ((node = walker.nextNode())) {
    const text = node as Text
    entries.push({ node: text, start: offset, end: offset + text.data.length })
    offset += text.data.length
  }
  return entries
}

export function createAnchor(range: Range, root: HTMLElement): TextAnchor | null {
  if (!isHighlightableRange(range, root)) return null

  const entries = textEntries(root)
  const touched = entries.filter(({ node }) => {
    try {
      return range.intersectsNode(node)
    } catch {
      return false
    }
  })
  const first = touched[0]
  const last = touched[touched.length - 1]
  if (!first || !last) return null

  const localStart = range.startContainer === first.node ? range.startOffset : 0
  const localEnd = range.endContainer === last.node ? range.endOffset : last.node.data.length
  const start = first.start + localStart
  const end = last.start + localEnd
  const fullText = entries.map(({ node }) => node.data).join('')
  const exact = fullText.slice(start, end)
  if (!exact.trim()) return null

  return {
    exact,
    prefix: fullText.slice(Math.max(0, start - 32), start),
    suffix: fullText.slice(end, end + 32),
    start,
    end,
  }
}

function contextScore(text: string, index: number, anchor: TextAnchor): number {
  const before = text.slice(Math.max(0, index - anchor.prefix.length), index)
  const after = text.slice(index + anchor.exact.length, index + anchor.exact.length + anchor.suffix.length)
  let score = 0

  for (let i = 1; i <= Math.min(before.length, anchor.prefix.length); i++) {
    if (before[before.length - i] !== anchor.prefix[anchor.prefix.length - i]) break
    score++
  }
  for (let i = 0; i < Math.min(after.length, anchor.suffix.length); i++) {
    if (after[i] !== anchor.suffix[i]) break
    score++
  }
  return score
}

function rangeAt(root: HTMLElement, start: number, end: number, entries: TextEntry[]): Range | null {
  const startEntry = entries.find((entry) => start >= entry.start && start <= entry.end)
  const endEntry = entries.find((entry) => end >= entry.start && end <= entry.end)
  if (!startEntry || !endEntry) return null

  const range = root.ownerDocument.createRange()
  range.setStart(startEntry.node, start - startEntry.start)
  range.setEnd(endEntry.node, end - endEntry.start)
  return range
}

export function createTextIndex(root: HTMLElement) {
  const entries = textEntries(root)
  const text = entries.map(({ node }) => node.data).join('')
  return { entries, text }
}

export function resolveAnchor(anchor: TextAnchor, root: HTMLElement, indexData = createTextIndex(root)): Range | null {
  const { entries, text } = indexData

  if (text.slice(anchor.start, anchor.end) === anchor.exact) {
    return rangeAt(root, anchor.start, anchor.end, entries)
  }

  let bestIndex = -1
  let bestScore = Number.NEGATIVE_INFINITY
  let index = text.indexOf(anchor.exact)
  while (index !== -1) {
    const score = contextScore(text, index, anchor) - Math.abs(index - anchor.start) / 10_000
    if (score > bestScore) {
      bestIndex = index
      bestScore = score
    }
    index = text.indexOf(anchor.exact, index + 1)
  }

  return bestIndex === -1
    ? null
    : rangeAt(root, bestIndex, bestIndex + anchor.exact.length, entries)
}
