import { useCallback, useMemo, useRef, useState, type RefObject } from 'react'
import type { PortalFieldEditActions } from './PortalEditableFieldRow'

/** Scroll an editing field row clear of the dock and on-screen keyboard. */
export function scrollPortalFieldRowIntoView(row: HTMLElement | null): void {
  if (!row) return
  const scroller = row.closest<HTMLElement>('.pw-mock-fields')
  if (!scroller) return

  const dock = row.closest('.pw-mock-detail')?.querySelector<HTMLElement>('.pw-mock-dock')
  const dockHeight = dock?.getBoundingClientRect().height ?? 0

  const rowRect = row.getBoundingClientRect()
  const scrollerRect = scroller.getBoundingClientRect()
  const visualViewport = window.visualViewport
  const viewportTop = visualViewport?.offsetTop ?? 0
  const viewportBottom = viewportTop + (visualViewport?.height ?? window.innerHeight)
  const visibleTop = Math.max(scrollerRect.top, viewportTop) + 16
  const visibleBottom = Math.min(scrollerRect.bottom, viewportBottom) - dockHeight - 16

  if (rowRect.top < visibleTop) {
    scroller.scrollTop -= visibleTop - rowRect.top
  } else if (rowRect.bottom > visibleBottom) {
    scroller.scrollTop += rowRect.bottom - visibleBottom
  }
}

export function schedulePortalFieldRowScroll(rowRef: RefObject<HTMLElement | null>): () => void {
  const run = () => scrollPortalFieldRowIntoView(rowRef.current)
  run()
  requestAnimationFrame(run)
  const t1 = window.setTimeout(run, 80)
  const t2 = window.setTimeout(run, 320)
  const vv = window.visualViewport
  vv?.addEventListener('resize', run)
  vv?.addEventListener('scroll', run)
  return () => {
    window.clearTimeout(t1)
    window.clearTimeout(t2)
    vv?.removeEventListener('resize', run)
    vv?.removeEventListener('scroll', run)
  }
}

type FieldHandlerMap = Map<string, Pick<PortalFieldEditActions, 'cancel' | 'save'>>

/**
 * Collect per-field save/cancel handlers without a shared "set null" cleanup race
 * when many editable rows mount/unmount in one worksheet.
 */
export function usePortalFieldEditActionRegistry(editingField: string | null) {
  const registryRef = useRef<FieldHandlerMap>(new Map())
  const [registryVersion, setRegistryVersion] = useState(0)

  const registerFieldEditActions = useCallback((actions: PortalFieldEditActions) => {
    registryRef.current.set(actions.fieldKey, {
      cancel: actions.cancel,
      save: actions.save,
    })
    setRegistryVersion((version) => version + 1)
  }, [])

  const unregisterFieldEditActions = useCallback((fieldKey: string) => {
    if (registryRef.current.delete(fieldKey)) {
      setRegistryVersion((version) => version + 1)
    }
  }, [])

  const activeFieldEditActions = useMemo((): PortalFieldEditActions | null => {
    if (!editingField) return null
    const handlers = registryRef.current.get(editingField)
    if (!handlers) return null
    return { fieldKey: editingField, ...handlers }
  }, [editingField, registryVersion])

  return {
    activeFieldEditActions,
    registerFieldEditActions,
    unregisterFieldEditActions,
  }
}
