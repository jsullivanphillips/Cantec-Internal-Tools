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
import { applyRichTextColorToSelection, normalizeRichTextEditorHtml } from './richTextEditorDom'
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
    normalizeRichTextEditorHtml(editor)
    const html = sanitizeRichTextHtml(editor.innerHTML)
    lastValueRef.current = html
    onChange?.(html)
  }, [onChange])

  const applyColor = useCallback(
    (colorId: RichTextColorId) => {
      if (disabled) return
      runWithSelection(() => {
        applyRichTextColorToSelection(colorId)
        emitChange()
      })
    },
    [disabled, emitChange, runWithSelection],
  )

  const applyBold = useCallback(() => {
    if (disabled) return
    runWithSelection(() => {
      document.execCommand('bold')
      emitChange()
    })
  }, [disabled, emitChange, runWithSelection])

  const buildHandle = useCallback((): RichTextEditorHandle => {
    return {
      focus: () => editorRef.current?.focus({ preventScroll: true }),
      applyBold,
      applyColor,
      getHtml: () => sanitizeRichTextHtml(editorRef.current?.innerHTML ?? ''),
      setHtml: (html: string) => {
        const editor = editorRef.current
        if (!editor) return
        const sanitized = sanitizeRichTextHtml(html)
        editor.innerHTML = sanitized
        lastValueRef.current = sanitized
      },
    }
  }, [applyBold, applyColor])

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

  useImperativeHandle(ref, () => buildHandle(), [buildHandle])

  useEffect(() => {
    if (!onHandleReady) return undefined
    const handle = buildHandle()
    onHandleReady(handle)
    return () => onHandleReady(null)
  }, [buildHandle, onHandleReady])

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
