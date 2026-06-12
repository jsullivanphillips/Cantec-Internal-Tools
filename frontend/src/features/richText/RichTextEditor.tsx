import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
} from 'react'
import type { RichTextColorId } from './richTextColors'
import { richTextColorClassName } from './richTextColors'
import { sanitizeRichTextHtml } from './richTextSanitize'
import { useRichTextSelection } from './useRichTextSelection'

export type RichTextEditorHandle = {
  focus: () => void
  applyBold: () => void
  applyColor: (colorId: RichTextColorId) => void
  getHtml: () => string
  setHtml: (html: string) => void
}

type RichTextEditorProps = {
  value: string
  disabled?: boolean
  placeholder?: string
  className?: string
  id?: string
  onChange?: (html: string) => void
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void
  onHandleReady?: (handle: RichTextEditorHandle | null) => void
}

function unwrapElement(element: Element): void {
  const parent = element.parentNode
  if (!parent) return
  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element)
  }
  parent.removeChild(element)
}

function normalizeEditorHtml(editor: HTMLElement): void {
  for (const span of Array.from(editor.querySelectorAll('span'))) {
    const classes = Array.from(span.classList)
    const colorClasses = classes.filter((name) => name.startsWith('rt-'))
    if (colorClasses.length === 0 && span.attributes.length === 0 && span.childNodes.length > 0) {
      unwrapElement(span)
    }
  }
}

const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(function RichTextEditor(
  { value, disabled = false, placeholder, className, id, onChange, onKeyDown, onHandleReady },
  ref,
) {
  const editorRef = useRef<HTMLDivElement>(null)
  const { runWithSelection } = useRichTextSelection(editorRef)
  const lastValueRef = useRef<string | undefined>(undefined)

  const emitChange = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    normalizeEditorHtml(editor)
    const html = sanitizeRichTextHtml(editor.innerHTML)
    lastValueRef.current = html
    onChange?.(html)
  }, [onChange])

  useLayoutEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const sanitizedValue = sanitizeRichTextHtml(value)
    if (lastValueRef.current === sanitizedValue) return
    const currentHtml = sanitizeRichTextHtml(editor.innerHTML)
    if (currentHtml === sanitizedValue) {
      lastValueRef.current = sanitizedValue
      return
    }
    lastValueRef.current = sanitizedValue
    editor.innerHTML = sanitizedValue
  }, [value])

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        editorRef.current?.focus({ preventScroll: true })
      },
      applyBold: () => {
        if (disabled) return
        runWithSelection(() => {
          document.execCommand('bold')
          emitChange()
        })
      },
      applyColor: (colorId: RichTextColorId) => {
        if (disabled) return
        const colorClass = richTextColorClassName(colorId)
        runWithSelection(() => {
          const selection = window.getSelection()
          if (!selection || selection.rangeCount === 0) return
          const range = selection.getRangeAt(0)
          if (range.collapsed) return

          const span = document.createElement('span')
          span.className = colorClass
          try {
            range.surroundContents(span)
          } catch {
            const fragment = range.extractContents()
            span.appendChild(fragment)
            range.insertNode(span)
          }
          selection.removeAllRanges()
          const nextRange = document.createRange()
          nextRange.selectNodeContents(span)
          selection.addRange(nextRange)
          emitChange()
        })
      },
      getHtml: () => sanitizeRichTextHtml(editorRef.current?.innerHTML ?? ''),
      setHtml: (html: string) => {
        const editor = editorRef.current
        if (!editor) return
        const sanitized = sanitizeRichTextHtml(html)
        editor.innerHTML = sanitized
        lastValueRef.current = sanitized
      },
    }),
    [disabled, emitChange, runWithSelection],
  )

  useEffect(() => {
    if (!onHandleReady) return undefined
    const handle: RichTextEditorHandle = {
      focus: () => editorRef.current?.focus({ preventScroll: true }),
      applyBold: () => {
        if (disabled) return
        runWithSelection(() => {
          document.execCommand('bold')
          emitChange()
        })
      },
      applyColor: (colorId: RichTextColorId) => {
        if (disabled) return
        const colorClass = richTextColorClassName(colorId)
        runWithSelection(() => {
          const selection = window.getSelection()
          if (!selection || selection.rangeCount === 0) return
          const range = selection.getRangeAt(0)
          if (range.collapsed) return
          const span = document.createElement('span')
          span.className = colorClass
          try {
            range.surroundContents(span)
          } catch {
            const fragment = range.extractContents()
            span.appendChild(fragment)
            range.insertNode(span)
          }
          selection.removeAllRanges()
          const nextRange = document.createRange()
          nextRange.selectNodeContents(span)
          selection.addRange(nextRange)
          emitChange()
        })
      },
      getHtml: () => sanitizeRichTextHtml(editorRef.current?.innerHTML ?? ''),
      setHtml: (html: string) => {
        const editor = editorRef.current
        if (!editor) return
        const sanitized = sanitizeRichTextHtml(html)
        editor.innerHTML = sanitized
        lastValueRef.current = sanitized
      },
    }
    onHandleReady(handle)
    return () => onHandleReady(null)
  }, [disabled, emitChange, onHandleReady, runWithSelection])

  return (
    <div
      ref={editorRef}
      id={id}
      role="textbox"
      aria-multiline="true"
      contentEditable={!disabled}
      suppressContentEditableWarning
      data-placeholder={placeholder}
      className={['rich-text-editor', className].filter(Boolean).join(' ')}
      onInput={() => emitChange()}
      onKeyDown={onKeyDown}
    />
  )
})

export default RichTextEditor
