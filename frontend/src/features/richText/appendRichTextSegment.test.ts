import { describe, expect, it } from 'vitest'
import { appendBlueRichTextSegment } from './appendRichTextSegment'

describe('appendBlueRichTextSegment', () => {
  it('wraps plain text in rt-blue', () => {
    expect(appendBlueRichTextSegment(null, 'Battery')).toBe(
      '<span class="rt-blue">Battery</span>',
    )
  })

  it('escapes HTML in user input', () => {
    expect(appendBlueRichTextSegment(null, '<script>alert(1)</script>')).toBe(
      '<span class="rt-blue">&lt;script&gt;alert(1)&lt;/script&gt;</span>',
    )
  })

  it('appends with br when existing content present', () => {
    expect(appendBlueRichTextSegment('<span class="rt-blue">Battery</span>', 'Door holder')).toBe(
      '<span class="rt-blue">Battery</span><br><span class="rt-blue">Door holder</span>',
    )
  })

  it('ignores empty submissions', () => {
    expect(appendBlueRichTextSegment('Existing', '   ')).toBe('Existing')
  })
})
