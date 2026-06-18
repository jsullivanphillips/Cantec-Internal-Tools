import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Modal } from 'react-bootstrap'
import type { RouteKeyAuditPayload } from '../keys/keysAdminShared'
import type { TechnicianWorksheetLocation } from './monthlyRoutesShared'
import { buildKeyViewItems, type KeyViewItem } from './portalKeyViewShared'

type Props = {
  show: boolean
  onHide: () => void
  stops: TechnicianWorksheetLocation[]
  activeStopId: number | null
  keyAudit?: RouteKeyAuditPayload | null
  /** Shown on the printed key sheet (e.g. route display name). */
  routeLabel?: string | null
  /** Plain list without test-outcome row colors (route details office view). */
  monochrome?: boolean
}

type MouseDragState = {
  startY: number
  startScrollTop: number
  pointerId: number
  lastY: number
  lastTime: number
  velocityY: number
}

const MOMENTUM_FRICTION = 0.92
const MOMENTUM_MIN_VELOCITY = 0.35
const MOMENTUM_FLING_THRESHOLD = 0.45
const WHEEL_MIN_OPACITY = 0.4
const WHEEL_CLEAR_NEIGHBOR_COUNT = 3
const WHEEL_FOG_RAMP_ITEMS = 2.5
const PRINT_BODY_CLASS = 'pw-key-view-print-active'
const PRINT_MONOCHROME_BODY_CLASS = 'pw-key-view-print-monochrome'

function keyIssueLabel(issue: KeyViewItem['keyIssue']): string | null {
  switch (issue) {
    case 'unlinked':
      return 'Key not linked'
    case 'unavailable':
      return 'Key unavailable'
    case 'wrong_route':
      return 'Wrong route'
    default:
      return null
  }
}

function formatPrintDate(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function KeyViewDocument({
  items,
  routeLabel,
  printDateLabel,
  showPrintDate,
  showOutcomeColors = false,
  className,
  innerRef,
}: {
  items: KeyViewItem[]
  routeLabel?: string | null
  printDateLabel?: string
  showPrintDate?: boolean
  showOutcomeColors?: boolean
  className?: string
  innerRef?: RefObject<HTMLDivElement | null>
}) {
  const trimmedRouteLabel = routeLabel?.trim() || null
  const stopLabel = `${items.length} ${items.length === 1 ? 'stop' : 'stops'}`

  return (
    <div
      ref={innerRef}
      className={className}
      data-row-count={items.length}
    >
      <header className="pw-key-view-document__header">
        <h1 className="pw-key-view-document__title">Key view</h1>
        {trimmedRouteLabel ? (
          <p className="pw-key-view-document__route">{trimmedRouteLabel}</p>
        ) : null}
        <p className="pw-key-view-document__meta">
          {showPrintDate && printDateLabel ? (
            <>
              Printed {printDateLabel}
              <span aria-hidden="true"> · </span>
            </>
          ) : null}
          {stopLabel}
        </p>
      </header>
      <table className="pw-key-view-document__table">
        <thead>
          <tr>
            <th scope="col">Stop</th>
            <th scope="col">Ring</th>
            <th scope="col">Key</th>
            <th scope="col">Address</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const issueLabel = keyIssueLabel(item.keyIssue)
            return (
              <tr
                key={item.locationId}
                className={['pw-key-view-document__row', showOutcomeColors ? item.statusClass : '']
                  .filter(Boolean)
                  .join(' ')}
              >
                <td className="pw-key-view-document__stop">{item.stopNumber}</td>
                <td>{item.ring}</td>
                <td className="pw-key-view-document__key">
                  {item.keyCode}
                  {item.keyIssue ? (
                    <span
                      className="pw-key-view-document__issue"
                      title={issueLabel ?? undefined}
                      aria-label={issueLabel ?? undefined}
                    >
                      <i className="bi bi-exclamation-triangle-fill" aria-hidden />
                    </span>
                  ) : null}
                </td>
                <td>{item.addressLabel}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function wheelItemVisual(distancePx: number, itemHeight: number) {
  const rowHeight = Math.max(itemHeight, 1)
  const itemDistance = Math.abs(distancePx) / rowHeight

  if (itemDistance <= WHEEL_CLEAR_NEIGHBOR_COUNT) {
    return 1
  }

  const fogT = Math.min(
    (itemDistance - WHEEL_CLEAR_NEIGHBOR_COUNT) / WHEEL_FOG_RAMP_ITEMS,
    1,
  )
  return 1 - fogT * (1 - WHEEL_MIN_OPACITY)
}

function snapScrollTop(scroller: HTMLDivElement) {
  scroller.scrollTop = Math.round(scroller.scrollTop)
}

export default function PortalKeyViewModal({
  show,
  onHide,
  stops,
  activeStopId,
  keyAudit,
  routeLabel,
  monochrome = false,
}: Props) {
  const items = useMemo(
    () => buildKeyViewItems(stops, activeStopId, keyAudit),
    [stops, activeStopId, keyAudit],
  )
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const printSheetRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const dragRef = useRef<MouseDragState | null>(null)
  const momentumFrameRef = useRef(0)
  const pointerActiveRef = useRef(false)
  const momentumActiveRef = useRef(false)
  const settleSnapRef = useRef(false)
  const focusedIndexRef = useRef(0)
  const [printing, setPrinting] = useState(false)

  const findNearestIndex = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller || items.length === 0) return 0
    const centerY = scroller.scrollTop + scroller.clientHeight / 2
    let nearest = 0
    let nearestDist = Number.POSITIVE_INFINITY
    items.forEach((item, index) => {
      const el = itemRefs.current.get(item.locationId)
      if (!el) return
      const itemCenter = el.offsetTop + el.offsetHeight / 2
      const dist = Math.abs(itemCenter - centerY)
      if (dist < nearestDist) {
        nearestDist = dist
        nearest = index
      }
    })
    return nearest
  }, [items])

  const updateWheelVisuals = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const centerY = scroller.scrollTop + scroller.clientHeight / 2
    let focusedlocationId: number | null = null
    let nearestDist = Number.POSITIVE_INFINITY
    items.forEach((item) => {
      const el = itemRefs.current.get(item.locationId)
      if (!el) return
      const itemCenter = el.offsetTop + el.offsetHeight / 2
      const dist = Math.abs(itemCenter - centerY)
      if (dist < nearestDist) {
        nearestDist = dist
        focusedlocationId = item.locationId
      }
    })
    items.forEach((item) => {
      const el = itemRefs.current.get(item.locationId)
      if (!el) return
      const itemCenter = el.offsetTop + el.offsetHeight / 2
      const opacity = wheelItemVisual(itemCenter - centerY, el.offsetHeight)
      el.style.opacity = String(opacity)
      el.classList.toggle(
        'pw-key-view-item--focused',
        focusedlocationId != null && item.locationId === focusedlocationId,
      )
    })
  }, [items])

  const cancelMomentum = useCallback(() => {
    if (momentumFrameRef.current) {
      window.cancelAnimationFrame(momentumFrameRef.current)
      momentumFrameRef.current = 0
    }
    momentumActiveRef.current = false
  }, [])

  const scrollToIndex = useCallback(
    (index: number, behavior: ScrollBehavior = 'smooth') => {
      const scroller = scrollerRef.current
      if (!scroller || items.length === 0) return
      const clamped = Math.max(0, Math.min(index, items.length - 1))
      const target = items[clamped]
      if (!target) return
      const el = itemRefs.current.get(target.locationId)
      if (!el) return
      cancelMomentum()
      if (behavior === 'auto') {
        el.scrollIntoView({ block: 'center', behavior: 'auto' })
        snapScrollTop(scroller)
        updateWheelVisuals()
        return
      }
      settleSnapRef.current = true
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    },
    [items, cancelMomentum, updateWheelVisuals],
  )

  const snapToNearest = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      scrollToIndex(findNearestIndex(), behavior)
    },
    [findNearestIndex, scrollToIndex],
  )

  const moveSelectionBy = useCallback(
    (delta: number) => {
      if (items.length === 0) return
      const next = Math.max(0, Math.min(focusedIndexRef.current + delta, items.length - 1))
      focusedIndexRef.current = next
      scrollToIndex(next)
    },
    [items.length, scrollToIndex],
  )

  const startMouseMomentum = useCallback(
    (initialVelocityPxPerMs: number) => {
      const scroller = scrollerRef.current
      if (!scroller) return
      cancelMomentum()
      momentumActiveRef.current = true
      let velocity = -initialVelocityPxPerMs * 1000
      let lastTime = performance.now()

      const tick = (now: number) => {
        const dt = Math.min(now - lastTime, 32)
        lastTime = now
        if (Math.abs(velocity) < MOMENTUM_MIN_VELOCITY) {
          momentumFrameRef.current = 0
          momentumActiveRef.current = false
          snapToNearest('smooth')
          return
        }
        scroller.scrollTop += velocity * (dt / 1000)
        velocity *= Math.pow(MOMENTUM_FRICTION, dt / 16)
        updateWheelVisuals()
        momentumFrameRef.current = window.requestAnimationFrame(tick)
      }
      momentumFrameRef.current = window.requestAnimationFrame(tick)
    },
    [cancelMomentum, snapToNearest, updateWheelVisuals],
  )

  useEffect(() => {
    if (!show || monochrome) return
    const activeIndex = items.findIndex((item) => item.isActiveStop)
    const index = activeIndex >= 0 ? activeIndex : 0
    focusedIndexRef.current = index
    const frame = window.requestAnimationFrame(() => {
      const target = items[index]
      if (!target) return
      const el = itemRefs.current.get(target.locationId)
      el?.scrollIntoView({ block: 'center', behavior: 'auto' })
      if (scrollerRef.current) snapScrollTop(scrollerRef.current)
      updateWheelVisuals()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [show, monochrome, items, updateWheelVisuals])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller || !show || monochrome) return
    let frame = 0
    const onScroll = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(updateWheelVisuals)
    }
    const onScrollEnd = () => {
      snapScrollTop(scroller)
      updateWheelVisuals()
      focusedIndexRef.current = findNearestIndex()
      if (pointerActiveRef.current || momentumActiveRef.current) return
      if (settleSnapRef.current) {
        settleSnapRef.current = false
        return
      }
      snapToNearest('smooth')
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    scroller.addEventListener('scrollend', onScrollEnd, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      scroller.removeEventListener('scrollend', onScrollEnd)
      window.cancelAnimationFrame(frame)
      cancelMomentum()
    }
  }, [show, monochrome, updateWheelVisuals, snapToNearest, cancelMomentum, findNearestIndex])

  useEffect(() => {
    if (!show || monochrome) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        moveSelectionBy(1)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        moveSelectionBy(-1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [show, monochrome, moveSelectionBy])

  useEffect(() => {
    if (!show) return
    const onAfterPrint = () => {
      setPrinting(false)
      document.body.classList.remove(PRINT_BODY_CLASS)
      document.body.classList.remove(PRINT_MONOCHROME_BODY_CLASS)
    }
    window.addEventListener('afterprint', onAfterPrint)
    return () => {
      window.removeEventListener('afterprint', onAfterPrint)
      setPrinting(false)
      document.body.classList.remove(PRINT_BODY_CLASS)
      document.body.classList.remove(PRINT_MONOCHROME_BODY_CLASS)
    }
  }, [show])

  const handlePrint = useCallback(() => {
    setPrinting(true)
    document.body.classList.add(PRINT_BODY_CLASS)
    if (monochrome) {
      document.body.classList.add(PRINT_MONOCHROME_BODY_CLASS)
    }
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => window.print()))
  }, [monochrome])

  const printDateLabel = useMemo(() => formatPrintDate(), [show, items.length])

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    pointerActiveRef.current = true
    settleSnapRef.current = false
    const scroller = scrollerRef.current
    if (!scroller) return
    cancelMomentum()
    if (event.pointerType !== 'mouse') return
    const now = performance.now()
    dragRef.current = {
      startY: event.clientY,
      startScrollTop: scroller.scrollTop,
      pointerId: event.pointerId,
      lastY: event.clientY,
      lastTime: now,
      velocityY: 0,
    }
    scroller.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    const scroller = scrollerRef.current
    if (!drag || !scroller || drag.pointerId !== event.pointerId) return
    const now = performance.now()
    const dt = now - drag.lastTime
    if (dt > 0 && dt < 80) {
      drag.velocityY = (event.clientY - drag.lastY) / dt
    }
    drag.lastY = event.clientY
    drag.lastTime = now
    const deltaY = event.clientY - drag.startY
    scroller.scrollTop = drag.startScrollTop - deltaY
    updateWheelVisuals()
  }

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    pointerActiveRef.current = false
    const drag = dragRef.current
    const scroller = scrollerRef.current
    if (!drag || !scroller || drag.pointerId !== event.pointerId) return
    const velocityY = drag.velocityY
    dragRef.current = null
    scroller.releasePointerCapture(event.pointerId)
    if (Math.abs(velocityY) >= MOMENTUM_FLING_THRESHOLD) {
      startMouseMomentum(velocityY)
      return
    }
    snapToNearest('smooth')
  }

  return (
    <Modal
      show={show}
      onHide={onHide}
      fullscreen
      className={`pw-key-view-modal${monochrome ? ' pw-key-view-modal--monochrome' : ''}`}
      contentClassName="pw-key-view-modal-content"
      backdropClassName={`pw-key-view-modal-backdrop${monochrome ? ' pw-key-view-modal-backdrop--office' : ''}`}
    >
      <Modal.Body className="pw-key-view-modal-body">
        <div className="pw-key-view-toolbar">
          <button
            type="button"
            className="pw-key-view-print"
            onClick={handlePrint}
            aria-label="Print key view"
          >
            <i className="bi bi-printer" aria-hidden />
            <span className="pw-key-view-print__label">Print</span>
          </button>
          <button
            type="button"
            className="pw-key-view-close"
            onClick={onHide}
            aria-label="Close key view"
          >
            <i className="bi bi-x-lg" aria-hidden />
          </button>
        </div>
        {monochrome ? (
          <KeyViewDocument
            items={items}
            routeLabel={routeLabel}
            printDateLabel={printDateLabel}
            showPrintDate={printing}
            className="pw-key-view-document pw-key-view-document--office"
            innerRef={printSheetRef}
          />
        ) : (
          <>
            <div className="pw-key-view-title">Key view</div>
            <div className="pw-key-view-wheel">
              <div
                ref={scrollerRef}
                className="pw-key-view-wheel-scroller"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={(event) => {
                  pointerActiveRef.current = false
                  onPointerUp(event)
                }}
              >
                {items.map((item) => {
                  const classNames = ['pw-key-view-item', item.statusClass].filter(Boolean).join(' ')
                  return (
                    <div
                      key={item.locationId}
                      ref={(el) => {
                        if (el) itemRefs.current.set(item.locationId, el)
                        else itemRefs.current.delete(item.locationId)
                      }}
                      className={classNames}
                    >
                      <span className="pw-key-view-stop-num">{item.stopNumber}</span>
                      <span className="pw-key-view-ring">
                        <i className="bi bi-circle pw-key-view-ring-icon" aria-hidden />
                        {item.ring}
                      </span>
                      <span className="pw-key-view-key-block">
                        <span className="pw-key-view-key-code">
                          {item.keyCode}
                          {item.keyIssue ? (
                            <span
                              className="text-warning ms-1"
                              title={keyIssueLabel(item.keyIssue) ?? undefined}
                            >
                              <i className="bi bi-exclamation-triangle-fill" aria-hidden />
                            </span>
                          ) : null}
                        </span>
                        <span className="pw-key-view-address">{item.addressLabel}</span>
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
            <KeyViewDocument
              items={items}
              routeLabel={routeLabel}
              printDateLabel={printDateLabel}
              showPrintDate
              showOutcomeColors
              className="pw-key-view-print-sheet"
              innerRef={printSheetRef}
            />
          </>
        )}
      </Modal.Body>
    </Modal>
  )
}
