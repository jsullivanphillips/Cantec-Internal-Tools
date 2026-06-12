import DOMPurify from 'dompurify'
import { RICH_TEXT_COLOR_CLASS_NAMES } from './richTextColors'

const ALLOWED_TAGS = new Set(['b', 'strong', 'span', 'br'])
const TAG_RE = /<(\/?)([a-zA-Z0-9]+)([^>]*)>/g
const CLASS_ATTR_RE = /class\s*=\s*(?:"([^"]*)"|'([^']*)')/i

let purifierConfigured = false

function filterSpanClassAttr(rawAttrs: string): string {
  const match = CLASS_ATTR_RE.exec(rawAttrs)
  if (!match) return rawAttrs
  const classes = (match[1] || match[2] || '').split(/\s+/).filter(Boolean)
  const allowed = classes.filter((name) => RICH_TEXT_COLOR_CLASS_NAMES.has(name))
  if (allowed.length === 0) {
    return rawAttrs.replace(CLASS_ATTR_RE, '')
  }
  return rawAttrs.replace(CLASS_ATTR_RE, `class="${allowed.join(' ')}"`)
}

function sanitizeRichTextHtmlWithoutDom(value: string): string {
  if (!value.includes('<')) return value
  return value.replace(TAG_RE, (_full, closing: string, tagName: string, attrs: string) => {
    const tag = tagName.toLowerCase()
    if (!ALLOWED_TAGS.has(tag)) return ''
    if (closing) return `</${tag}>`
    if (tag === 'span') return `<span${filterSpanClassAttr(attrs)}>`
    return `<${tag}>`
  })
}

function configurePurifier(): void {
  if (purifierConfigured || typeof window === 'undefined') return
  DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
    if (data.attrName !== 'class' || node.tagName.toLowerCase() !== 'span') return
    const classes = String(data.attrValue ?? '')
      .split(/\s+/)
      .filter(Boolean)
    const allowed = classes.filter((name) => RICH_TEXT_COLOR_CLASS_NAMES.has(name))
    if (allowed.length === 0) {
      data.attrValue = ''
      data.keepAttr = false
      return
    }
    data.attrValue = allowed.join(' ')
  })
  purifierConfigured = true
}

export function containsRichTextMarkup(value: string): boolean {
  return /<[^>]+>/.test(value)
}

export function sanitizeRichTextHtml(value: string | null | undefined): string {
  const raw = (value ?? '').trim()
  if (!raw) return ''
  if (typeof window === 'undefined' || typeof DOMPurify.sanitize !== 'function') {
    return sanitizeRichTextHtmlWithoutDom(raw).trim()
  }
  configurePurifier()
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: [...ALLOWED_TAGS],
    ALLOWED_ATTR: ['class'],
  }).trim()
}

export function normalizeRichTextComment(value: string | null | undefined): string | null {
  const sanitized = sanitizeRichTextHtml(value)
  if (!sanitized) return null
  const plain = stripRichTextToPlain(sanitized)
  if (!plain.trim()) return null
  return sanitized
}

export function stripRichTextToPlain(value: string | null | undefined): string {
  const raw = (value ?? '').trim()
  if (!raw) return ''
  if (!containsRichTextMarkup(raw)) return raw
  configurePurifier()
  const sanitized = sanitizeRichTextHtml(raw)
  if (typeof document === 'undefined') {
    return sanitized.replace(/<[^>]+>/g, '')
  }
  const el = document.createElement('div')
  el.innerHTML = sanitized
  return el.textContent ?? ''
}

export function richTextIsEmpty(value: string | null | undefined): boolean {
  return stripRichTextToPlain(value).trim().length === 0
}

export function richTextValuesEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeRichTextComment(a) ?? ''
  const right = normalizeRichTextComment(b) ?? ''
  return left === right
}
