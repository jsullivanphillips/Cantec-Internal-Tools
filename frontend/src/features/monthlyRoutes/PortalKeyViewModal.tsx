import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

export default function PortalKeyViewModal({ show, onHide, stops, activeStopId }: Props) {
  const items = useMemo(() => buildKeyViewItems(stops, activeStopId), [stops, activeStopId])
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const dragRef = useRef<MouseDragState | null>(null)
  const momentumFrameRef = useRef(0)
  const [focusedIndex, setFocusedIndex] = useState(0)

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

  const updateFocusedIndex = useCallback(() => {
    setFocusedIndex(findNearestIndex())
  }, [findNearestIndex])

  const cancelMomentum = useCallback(() => {
    if (momentumFrameRef.current) {
      window.cancelAnimationFrame(momentumFrameRef.current)
      momentumFrameRef.current = 0
    }
  }, [])

  const snapToNearest = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      const scroller = scrollerRef.current
      if (!scroller || items.length === 0) return
      const nearest = findNearestIndex()
      const target = items[nearest]
      if (!target) return
      const el = itemRefs.current.get(target.testingSiteId)
      el?.scrollIntoView({ block: 'center', behavior })
      setFocusedIndex(nearest)
    },
    [findNearestIndex, items],
  )

  const startMouseMomentum = useCallback(
    (initialVelocityPxPerMs: number) => {
      const scroller = scrollerRef.current
      if (!scroller) return
      cancelMomentum()
      let velocity = -initialVelocityPxPerMs * 1000
      let lastTime = performance.now()

      const tick = (now: number) => {
        const dt = Math.min(now - lastTime, 32)
        lastTime = now
        if (Math.abs(velocity) < MOMENTUM_MIN_VELOCITY) {
          momentumFrameRef.current = 0
          snapToNearest('smooth')
          return
        }
        scroller.scrollTop += velocity * (dt / 1000)
        velocity *= Math.pow(MOMENTUM_FRICTION, dt / 16)
        momentumFrameRef.current = window.requestAnimationFrame(tick)
      }
      momentumFrameRef.current = window.requestAnimationFrame(tick)
    },
    [cancelMomentum, snapToNearest],
  )

  useEffect(() => {
    if (!show) return
    const activeIndex = items.findIndex((item) => item.isActiveStop)
    const index = activeIndex >= 0 ? activeIndex : 0
    setFocusedIndex(index)
    const frame = window.requestAnimationFrame(() => {
      const target = items[index]
      if (!target) return
      const el = itemRefs.current.get(target.testingSiteId)
      el?.scrollIntoView({ block: 'center', behavior: 'auto' })
      updateFocusedIndex()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [show, items, updateFocusedIndex])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller || !show) return
    let frame = 0
    const onScroll = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(updateFocusedIndex)
    }
    const onScrollEnd = () => {
      updateFocusedIndex()
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    scroller.addEventListener('scrollend', onScrollEnd, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      scroller.removeEventListener('scrollend', onScrollEnd)
      window.cancelAnimationFrame(frame)
      cancelMomentum()
    }
  }, [show, updateFocusedIndex, cancelMomentum])

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse') return
    const scroller = scrollerRef.current
    if (!scroller) return
    cancelMomentum()
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
  }

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    const scroller = scrollerRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const velocityY = drag.velocityY
    dragRef.current = null
    scroller?.releasePointerCapture(event.pointerId)
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
            onPointerCancel={onPointerUp}
          >
            {items.map((item, index) => {
              const isFocused = index === focusedIndex
              const isDimmed = !isFocused
              const classNames = [
                'pw-key-view-item',
                item.statusClass,
                isFocused ? 'pw-key-view-item--focused' : '',
                isDimmed ? 'pw-key-view-item--dimmed' : '',
                item.isActiveStop ? 'pw-key-view-item--active-stop' : '',
              ]
                .filter(Boolean)
                .join(' ')
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
