import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Modal } from 'react-bootstrap'
import type { TechnicianWorksheetStop } from './monthlyRoutesShared'
import { buildKeyViewItems } from './portalKeyViewShared'

type Props = {
  show: boolean
  onHide: () => void
  stops: TechnicianWorksheetStop[]
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
const WHEEL_FOCUS_SCALE = 1.04
const WHEEL_MIN_SCALE = 0.92
const WHEEL_MIN_OPACITY = 0.4
const WHEEL_CLEAR_NEIGHBOR_COUNT = 3
const WHEEL_FOG_RAMP_ITEMS = 2.5

function wheelItemVisual(distancePx: number, itemHeight: number) {
  const rowHeight = Math.max(itemHeight, 1)
  const itemDistance = Math.abs(distancePx) / rowHeight

  if (itemDistance <= WHEEL_CLEAR_NEIGHBOR_COUNT) {
    const centerT = itemDistance / WHEEL_CLEAR_NEIGHBOR_COUNT
    return {
      scale: WHEEL_FOCUS_SCALE - centerT * (WHEEL_FOCUS_SCALE - 1),
      opacity: 1,
    }
  }

  const fogT = Math.min(
    (itemDistance - WHEEL_CLEAR_NEIGHBOR_COUNT) / WHEEL_FOG_RAMP_ITEMS,
    1,
  )
  return {
    scale: 1 - fogT * (1 - WHEEL_MIN_SCALE),
    opacity: 1 - fogT * (1 - WHEEL_MIN_OPACITY),
  }
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

  const findNearestIndex = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller || items.length === 0) return 0
    const centerY = scroller.scrollTop + scroller.clientHeight / 2
    let nearest = 0
    let nearestDist = Number.POSITIVE_INFINITY
    items.forEach((item, index) => {
      const el = itemRefs.current.get(item.testingSiteId)
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
    let focusedTestingSiteId: number | null = null
    let nearestDist = Number.POSITIVE_INFINITY
    items.forEach((item) => {
      const el = itemRefs.current.get(item.testingSiteId)
      if (!el) return
      const itemCenter = el.offsetTop + el.offsetHeight / 2
      const dist = Math.abs(itemCenter - centerY)
      if (dist < nearestDist) {
        nearestDist = dist
        focusedTestingSiteId = item.testingSiteId
      }
    })
    items.forEach((item) => {
      const el = itemRefs.current.get(item.testingSiteId)
      if (!el) return
      const itemCenter = el.offsetTop + el.offsetHeight / 2
      const { scale, opacity } = wheelItemVisual(itemCenter - centerY, el.offsetHeight)
      el.style.opacity = String(opacity)
      el.style.transform = `scale(${scale})`
      el.classList.toggle(
        'pw-key-view-item--focused',
        focusedTestingSiteId != null && item.testingSiteId === focusedTestingSiteId,
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

  const snapToNearest = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      const scroller = scrollerRef.current
      if (!scroller || items.length === 0) return
      const nearest = findNearestIndex()
      const target = items[nearest]
      if (!target) return
      const el = itemRefs.current.get(target.testingSiteId)
      if (!el) return
      if (behavior === 'auto') {
        el.scrollIntoView({ block: 'center', behavior: 'auto' })
        updateWheelVisuals()
        return
      }
      settleSnapRef.current = true
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    },
    [findNearestIndex, items, updateWheelVisuals],
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
    const frame = window.requestAnimationFrame(() => {
      const target = items[index]
      if (!target) return
      const el = itemRefs.current.get(target.testingSiteId)
      el?.scrollIntoView({ block: 'center', behavior: 'auto' })
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
      updateWheelVisuals()
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
  }, [show, updateWheelVisuals, snapToNearest, cancelMomentum])

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
                  key={item.testingSiteId}
                  ref={(el) => {
                    if (el) itemRefs.current.set(item.testingSiteId, el)
                    else itemRefs.current.delete(item.testingSiteId)
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
