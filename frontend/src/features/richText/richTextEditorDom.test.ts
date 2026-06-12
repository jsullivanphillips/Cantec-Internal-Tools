// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import {
  applyRichTextColorToRange,
  normalizeRichTextEditorHtml,
  stripRichTextColorMarkup,
} from './richTextEditorDom'

describe('richTextEditorDom', () => {
  it('strips nested color spans before re-coloring', () => {
    const root = document.createElement('div')
    root.innerHTML = '<span class="rt-red">Alert</span>'

    stripRichTextColorMarkup(root)

    expect(root.innerHTML).toBe('Alert')
  })

  it('applies black by removing color markup without nesting', () => {
    const editor = document.createElement('div')
    editor.className = 'rich-text-editor'
    editor.setAttribute('contenteditable', 'true')
    editor.innerHTML = '<span class="rt-red">Alert</span>'
    const range = document.createRange()
    range.selectNodeContents(editor)

    applyRichTextColorToRange(range, 'black')
    normalizeRichTextEditorHtml(editor)

    expect(editor.innerHTML).toBe('Alert')
  })

  it('applies black when only the text node is selected inside a color span', () => {
    const editor = document.createElement('div')
    editor.className = 'rich-text-editor'
    editor.setAttribute('contenteditable', 'true')
    editor.innerHTML = '<span class="rt-red">Alert</span>'
    const text = editor.querySelector('span')!.firstChild as Text
    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, text.length)

    applyRichTextColorToRange(range, 'black')
    normalizeRichTextEditorHtml(editor)

    expect(editor.innerHTML).toBe('Alert')
  })

  it('applies black when the color span inherits isContentEditable', () => {
    const editor = document.createElement('div')
    editor.className = 'rich-text-editor'
    editor.setAttribute('contenteditable', 'true')
    editor.innerHTML = '<span class="rt-red">Alert</span>'
    const redSpan = editor.querySelector('span')!
    Object.defineProperty(redSpan, 'isContentEditable', { get: () => true })
    const range = document.createRange()
    range.selectNodeContents(redSpan)

    applyRichTextColorToRange(range, 'black')
    normalizeRichTextEditorHtml(editor)

    expect(editor.innerHTML).toBe('Alert')
  })

  it('replaces one color with another without nesting spans', () => {
    const editor = document.createElement('div')
    editor.innerHTML = '<span class="rt-red">Alert</span>'
    const range = document.createRange()
    range.selectNodeContents(editor)

    const span = applyRichTextColorToRange(range, 'green')

    expect(span?.className).toBe('rt-green')
    expect(editor.innerHTML).toBe('<span class="rt-green">Alert</span>')
  })

  it('unwraps redundant rt-black spans on normalize', () => {
    const editor = document.createElement('div')
    editor.innerHTML = '<span class="rt-black">Plain</span>'

    normalizeRichTextEditorHtml(editor)

    expect(editor.innerHTML).toBe('Plain')
  })
})
