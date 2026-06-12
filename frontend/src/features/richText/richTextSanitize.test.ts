import { describe, expect, it } from 'vitest'
import {
  normalizeRichTextComment,
  richTextIsEmpty,
  richTextValuesEqual,
  sanitizeRichTextHtml,
  stripRichTextToPlain,
} from './richTextSanitize'

describe('richTextSanitize', () => {
  it('preserves plain text', () => {
    expect(sanitizeRichTextHtml('Check panel')).toBe('Check panel')
  })

  it('allows bold and color spans', () => {
    expect(sanitizeRichTextHtml('<b>Warn</b> <span class="rt-red">Stop</span>')).toBe(
      '<b>Warn</b> <span class="rt-red">Stop</span>',
    )
  })

  it('strips scripts and disallowed tags', () => {
    expect(sanitizeRichTextHtml('<script>alert(1)</script>Hi')).toBe('alert(1)Hi')
    expect(sanitizeRichTextHtml('<a href="x">Link</a>')).toBe('Link')
  })

  it('keeps allowed span color classes only', () => {
    expect(sanitizeRichTextHtml('<span class="rt-red evil">X</span>')).toBe('<span class="rt-red">X</span>')
  })

  it('normalizes empty rich text to null', () => {
    expect(normalizeRichTextComment('<b></b>')).toBeNull()
    expect(normalizeRichTextComment('   ')).toBeNull()
  })

  it('strips markup to plain text', () => {
    expect(stripRichTextToPlain('<span class="rt-red">A</span> plain')).toBe('A plain')
  })

  it('detects empty values', () => {
    expect(richTextIsEmpty('<b></b>')).toBe(true)
    expect(richTextIsEmpty('Note')).toBe(false)
  })

  it('compares normalized rich text values', () => {
    expect(richTextValuesEqual('<b>Hi</b>', '<strong>Hi</strong>')).toBe(false)
    expect(richTextValuesEqual('Same', 'Same')).toBe(true)
  })
})
