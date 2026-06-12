import { useCallback, useEffect, useRef, type RefObject } from 'react'

/** Preserve selection when toolbar buttons live outside the contentEditable element. */
export function useRichTextSelection(editorRef: RefObject<HTMLElement | null>) {
  const savedRangeRef = useRef<Range | null>(null)

  const saveSelection = useCallback(() => {
    const editor = editorRef.current
    const selection = window.getSelection()
    if (!editor || !selection || selection.rangeCount === 0) return
    const range = selection.getRangeAt(0)
    if (!editor.contains(range.commonAncestorContainer)) return
    savedRangeRef.current = range.cloneRange()
  }, [editorRef])

  const restoreSelection = useCallback(() => {
    const editor = editorRef.current
    const range = savedRangeRef.current
    const selection = window.getSelection()
    if (!editor || !range || !selection) return false
    selection.removeAllRanges()
    selection.addRange(range)
    return true
  }, [editorRef])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return undefined

    const onSelectionChange = () => saveSelection()
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [editorRef, saveSelection])

  const runWithSelection = useCallback(
    (fn: () => void) => {
      editorRef.current?.focus({ preventScroll: true })
      restoreSelection()
      fn()
      saveSelection()
    },
    [editorRef, restoreSelection, saveSelection],
  )

  return { saveSelection, restoreSelection, runWithSelection }
}
