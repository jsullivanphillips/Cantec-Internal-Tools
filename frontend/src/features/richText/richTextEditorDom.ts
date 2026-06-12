import type { RichTextColorId } from './richTextColors'
import { richTextColorClassName } from './richTextColors'

export function unwrapElement(element: Element): void {
  const parent = element.parentNode
  if (!parent) return
  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element)
  }
  parent.removeChild(element)
}

function hasRichTextColorClass(element: Element): boolean {
  return Array.from(element.classList).some((name) => name.startsWith('rt-'))
}

function resolveRichTextEditorRoot(node: Node): HTMLElement | null {
  const start = node instanceof Element ? node : node.parentElement
  if (!start) return null
  const byClass = start.closest('.rich-text-editor')
  if (byClass instanceof HTMLElement) return byClass
  const byRole = start.closest('[contenteditable][role="textbox"]')
  if (byRole instanceof HTMLElement) return byRole
  return null
}

/** Lift ``node`` out of any colored span wrappers up to ``root`` (black = default text). */
export function unwrapRichTextColorAncestors(node: Node, root: ParentNode): void {
  let el: Element | null = node instanceof Element ? node : node.parentElement
  while (el && el !== root && root.contains(el)) {
    if (el.tagName === 'SPAN' && hasRichTextColorClass(el)) {
      const parent = el.parentElement
      unwrapElement(el)
      el = parent
      continue
    }
    el = el.parentElement
  }
}

/** Remove rich-text color classes from spans inside ``root`` (used before applying a new color). */
export function stripRichTextColorMarkup(root: ParentNode): void {
  for (;;) {
    const span = root.querySelector('span')
    if (!span) return

    const colorClasses = Array.from(span.classList).filter((name) => name.startsWith('rt-'))
    if (colorClasses.length === 0) {
      if (shouldUnwrapMeaninglessSpan(span)) {
        unwrapElement(span)
        continue
      }
      return
    }

    span.classList.remove(...colorClasses)
    if (span.classList.length === 0) {
      span.removeAttribute('class')
      unwrapElement(span)
    }
  }
}

function shouldUnwrapMeaninglessSpan(span: Element): boolean {
  if (span.tagName !== 'SPAN') return false
  if (span.classList.length > 0) return false
  return span.attributes.length === 0
}

export function normalizeRichTextEditorHtml(editor: HTMLElement): void {
  for (const span of Array.from(editor.querySelectorAll('span'))) {
    const colorClasses = Array.from(span.classList).filter((name) => name.startsWith('rt-'))
    if (colorClasses.length === 1 && colorClasses[0] === 'rt-black') {
      span.removeAttribute('class')
      unwrapElement(span)
      continue
    }
    if (shouldUnwrapMeaninglessSpan(span) && span.childNodes.length > 0) {
      unwrapElement(span)
    }
  }
}

/** Replace the selection with ``colorId`` styling. Returns the inserted wrapper span when one is created. */
export function applyRichTextColorToRange(
  range: Range,
  colorId: RichTextColorId,
): HTMLSpanElement | null {
  const fragment = range.extractContents()
  stripRichTextColorMarkup(fragment)

  if (colorId === 'black') {
    const first = fragment.firstChild
    const last = fragment.lastChild
    range.insertNode(fragment)
    if (first) {
      const editorRoot = resolveRichTextEditorRoot(first)
      if (editorRoot) {
        unwrapRichTextColorAncestors(first, editorRoot)
      }
    }
    if (first && last) {
      range.setStartBefore(first)
      range.setEndAfter(last)
    }
    return null
  }

  const span = document.createElement('span')
  span.className = richTextColorClassName(colorId)
  span.appendChild(fragment)
  range.insertNode(span)
  return span
}

/** Apply a color to the current selection and keep it highlighted afterward. */
export function applyRichTextColorToSelection(colorId: RichTextColorId): void {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return
  const range = selection.getRangeAt(0)
  if (range.collapsed) return

  const wrapper = applyRichTextColorToRange(range, colorId)
  selection.removeAllRanges()
  const nextRange = document.createRange()
  if (wrapper) {
    nextRange.selectNodeContents(wrapper)
  } else if (range.startContainer && range.endContainer) {
    nextRange.setStart(range.startContainer, range.startOffset)
    nextRange.setEnd(range.endContainer, range.endOffset)
  }
  selection.addRange(nextRange)
}
