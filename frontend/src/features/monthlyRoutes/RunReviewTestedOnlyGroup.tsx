import { useCallback, useImperativeHandle, useRef, useState, forwardRef } from 'react'
import { Collapse } from 'react-bootstrap'
import RunDetailsSiteChangeCard from './RunDetailsSiteChangeCard'
import type { NotableChangeItem, NotableStopChangeCard } from './notableStopChanges'
import { RUN_REVIEW_TESTED_GROUP_DOM_ID, runReviewStopDomId } from './notableStopChanges'

export type RunReviewTestedOnlyGroupHandle = {
  expandAndScroll: () => void
}

const RunReviewTestedOnlyGroup = forwardRef<
  RunReviewTestedOnlyGroupHandle,
  {
    cards: NotableStopChangeCard[]
    defaultExpanded?: boolean
    routeId: number
    monthDate: string
    onCardDetailLoaded: (locationId: number, changes: NotableChangeItem[]) => void
  }
>(function RunReviewTestedOnlyGroup(
  { cards, defaultExpanded = false, routeId, monthDate, onCardDetailLoaded },
  ref,
) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const scrollAfterExpandRef = useRef(false)

  const scrollToWrapper = useCallback(() => {
    const wrapper = document.getElementById(RUN_REVIEW_TESTED_GROUP_DOM_ID)
    if (!wrapper) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    wrapper.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' })
  }, [])

  const expandAndScroll = useCallback(() => {
    if (expanded) {
      scrollToWrapper()
      return
    }
    scrollAfterExpandRef.current = true
    setExpanded(true)
  }, [expanded, scrollToWrapper])

  useImperativeHandle(ref, () => ({ expandAndScroll }), [expandAndScroll])

  if (cards.length === 0) return null

  const label =
    cards.length === 1 ? '1 tested (no edits)' : `${cards.length} tested (no edits)`

  return (
    <div
      id={RUN_REVIEW_TESTED_GROUP_DOM_ID}
      className="run-review-tested-group monthly-location-detail-surface"
    >
      <button
        type="button"
        className="run-review-tested-group__toggle"
        aria-expanded={expanded}
        aria-controls="run-review-tested-only-group-panel"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="run-review-tested-group__label">{label}</span>
        <i
          className={`bi ${expanded ? 'bi-chevron-up' : 'bi-chevron-down'}`}
          aria-hidden
        />
      </button>
      <Collapse
        in={expanded}
        onEntered={() => {
          if (scrollAfterExpandRef.current) {
            scrollAfterExpandRef.current = false
            scrollToWrapper()
          }
        }}
      >
        <div id="run-review-tested-only-group-panel">
          <ul className="run-review-tested-group__list list-unstyled mb-0">
            {cards.map((card) => (
              <li key={`${card.locationId}:${card.stop.location_id}`} id={runReviewStopDomId(card)}>
                <RunDetailsSiteChangeCard
                  card={card}
                  routeId={routeId}
                  monthDate={monthDate}
                  onDetailLoaded={onCardDetailLoaded}
                />
              </li>
            ))}
          </ul>
        </div>
      </Collapse>
    </div>
  )
})

export default RunReviewTestedOnlyGroup
