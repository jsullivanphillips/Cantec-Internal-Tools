import { useCallback, useMemo, useRef, useState, type RefObject } from 'react'
import type { PortalFieldEditActions } from './PortalEditableFieldRow'

const KEYBOARD_SCROLL_DELAYS_MS = [80, 320, 400, 600] as const
const KEYBOARD_VIEWPORT_SHRINK_PX = 40

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
  const getRow = () => rowRef.current
  const run = () => scrollPortalFieldRowIntoView(getRow())
  const vv = window.visualViewport
  const baselineHeight = vv?.height ?? window.innerHeight

  run()
  requestAnimationFrame(run)
  const timers = KEYBOARD_SCROLL_DELAYS_MS.map((delayMs) => window.setTimeout(run, delayMs))

  const onViewportChange = () => {
    if (!vv) {
      run()
      return
    }
    // iPad/iOS often opens the keyboard after focus; re-scroll once the viewport shrinks.
    if (vv.height < baselineHeight - KEYBOARD_VIEWPORT_SHRINK_PX) {
      run()
    }
  }

  vv?.addEventListener('resize', onViewportChange)
  vv?.addEventListener('scroll', onViewportChange)

  return () => {
    timers.forEach((timer) => window.clearTimeout(timer))
    vv?.removeEventListener('resize', onViewportChange)
    vv?.removeEventListener('scroll', onViewportChange)
  }
}

export function schedulePortalFieldRowScrollForElement(row: HTMLElement | null): () => void {
  const rowRef = { current: row }
  return schedulePortalFieldRowScroll(rowRef)
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
