import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Modal } from 'react-bootstrap'
import type { TechnicianWorksheetLocation } from './monthlyRoutesShared'
import { buildKeyViewItems } from './portalKeyViewShared'

type Props = {
  show: boolean
  onHide: () => void
  stops: TechnicianWorksheetLocation[]
  activeStopId: number | null
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

export default function PortalKeyViewModal({ show, onHide, stops, activeStopId }: Props) {
  const items = useMemo(() => buildKeyViewItems(stops, activeStopId), [stops, activeStopId])
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const dragRef = useRef<MouseDragState | null>(null)
  const momentumFrameRef = useRef(0)
  const pointerActiveRef = useRef(false)
  const momentumActiveRef = useRef(false)
  const settleSnapRef = useRef(false)
  const focusedIndexRef = useRef(0)

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
    if (!show) return
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
  }, [show, items, updateWheelVisuals])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller || !show) return
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
  }, [show, updateWheelVisuals, snapToNearest, cancelMomentum, findNearestIndex])

  useEffect(() => {
    if (!show) return
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
  }, [show, moveSelectionBy])

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
      className="pw-key-view-modal"
      contentClassName="pw-key-view-modal-content"
      backdropClassName="pw-key-view-modal-backdrop"
    >
      <Modal.Body className="pw-key-view-modal-body">
        <button
          type="button"
          className="pw-key-view-close"
          onClick={onHide}
          aria-label="Close key view"
        >
          <i className="bi bi-x-lg" aria-hidden />
        </button>
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
                    <span className="pw-key-view-key-code">{item.keyCode}</span>
                    <span className="pw-key-view-address">{item.addressLabel}</span>
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </Modal.Body>
    </Modal>
  )
}
