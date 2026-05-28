import { useEffect, useId, useState } from 'react'
import { Badge, Collapse } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import { billingStatusLabel, billingStatusVariant } from './officeRunReviewShared'
import RunDetailsSiteChangeGroups from './RunDetailsSiteChangeGroups'
import type { NotableStopChangeCard } from './notableStopChanges'
import {
  RUN_REVIEW_EXPAND_CARD_EVENT,
  runReviewCardTier,
  runReviewResultHeadlineClass,
  runReviewStopDomId,
} from './notableStopChanges'

function RunReviewSiteHeaderSummary({
  card,
  cardExpanded,
  hasDetails,
  onToggle,
  controlsId,
}: {
  card: NotableStopChangeCard
  cardExpanded: boolean
  hasDetails: boolean
  onToggle: () => void
  controlsId: string
}) {
  const { stopNumber, displayAddress, locationId, resultHeadline, stop, siteIndex } = card
  const monthDate = stop.month_date
  const resultClass = runReviewResultHeadlineClass(stop, monthDate)
  const billingStatus = (stop.billing_status || '').trim()
  const showBillingBadge = siteIndex === 1 && billingStatus.length > 0
  const showNoDefPill =
    stop.test_outcome === 'passed_with_problems' && stop.confirmed_no_deficiencies === true

  const summaryRow = (
    <>
      <span
        className="run-detail-site-card__stop tabular-nums"
        title="Position on this month's route worksheet"
      >
        Stop {stopNumber}
      </span>
      <span className="run-detail-site-card__address-wrap">
        <Link
          to={`/monthlies/locations/${locationId}`}
          className="run-detail-site-card__address"
          onClick={(e) => e.stopPropagation()}
        >
          {displayAddress}
        </Link>
      </span>
      {showBillingBadge ? (
        <Badge
          bg={billingStatusVariant(billingStatus)}
          className="run-detail-site-card__billing-badge"
        >
          {billingStatusLabel(billingStatus)}
        </Badge>
      ) : null}
      {resultHeadline ? (
        <span className={`run-detail-site-card__badge ${resultClass}`}>{resultHeadline}</span>
      ) : null}
      {showNoDefPill ? (
        <span className="run-detail-site-card__no-def-pill">No deficiencies confirmed</span>
      ) : null}
    </>
  )

  if (!hasDetails) {
    return <div className="run-detail-site-card__header-row">{summaryRow}</div>
  }

  return (
    <div
      className="run-detail-site-card__header-row run-detail-site-card__header-row--toggle"
      role="button"
      tabIndex={0}
      aria-expanded={cardExpanded}
      aria-controls={controlsId}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onToggle()
        }
      }}
    >
      <i
        className={`bi run-detail-site-card__chevron ${cardExpanded ? 'bi-chevron-up' : 'bi-chevron-down'}`}
        aria-hidden
      />
      {summaryRow}
    </div>
  )
}

export default function RunDetailsSiteChangeCard({ card }: { card: NotableStopChangeCard }) {
  const { changes, stopNumber, displayAddress, resultHeadline, stop, siteLabel, siteIndex, siteCount } =
    card
  const monthDate = stop.month_date
  const tier = runReviewCardTier(card, monthDate)
  const bodyId = useId()
  const [cardExpanded, setCardExpanded] = useState(false)
  const hasDetails = changes.length > 0 || siteCount > 1

  useEffect(() => {
    const domId = runReviewStopDomId(card)
    const onExpandCard = (event: Event) => {
      const detail = (event as CustomEvent<{ domId?: string }>).detail
      if (detail?.domId === domId) {
        setCardExpanded(true)
      }
    }
    window.addEventListener(RUN_REVIEW_EXPAND_CARD_EVENT, onExpandCard)
    return () => window.removeEventListener(RUN_REVIEW_EXPAND_CARD_EVENT, onExpandCard)
  }, [card])

  const tierClass = tier === 'tested_only' ? 'tested' : tier

  return (
    <article
      className={`run-detail-site-card monthly-location-detail-surface run-detail-site-card--tier-${tierClass}${hasDetails && !cardExpanded ? ' run-detail-site-card--collapsed' : ''}${hasDetails && cardExpanded ? ' run-detail-site-card--expanded' : ''}`}
      aria-label={
        resultHeadline
          ? `Stop ${stopNumber}, ${displayAddress}: ${resultHeadline}`
          : `Stop ${stopNumber}, ${displayAddress}`
      }
    >
      <header className="run-detail-site-card__header">
        <RunReviewSiteHeaderSummary
          card={card}
          cardExpanded={cardExpanded}
          hasDetails={hasDetails}
          onToggle={() => setCardExpanded((v) => !v)}
          controlsId={bodyId}
        />
      </header>
      {hasDetails ? (
        <Collapse in={cardExpanded}>
          <div id={bodyId} className="run-detail-site-card__body">
            {siteCount > 1 ? (
              <div className="run-detail-site-card__site-meta text-muted small">
                {siteLabel !== 'Primary testing location' ? (
                  <>
                    <span className="run-detail-site-card__site">{siteLabel}</span>
                    <span className="run-detail-site-card__site-sep" aria-hidden>
                      {' '}
                      ·{' '}
                    </span>
                  </>
                ) : null}
                Site {siteIndex} of {siteCount} at this address
              </div>
            ) : null}
            {changes.length > 0 ? (
              <div className="run-detail-site-card__changes">
                <RunDetailsSiteChangeGroups changes={changes} />
              </div>
            ) : null}
          </div>
        </Collapse>
      ) : null}
    </article>
  )
}
