import { useCallback, useEffect, useId, useState } from 'react'
import { Badge, Collapse, Spinner } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import { billingStatusLabel, billingStatusVariant } from './officeRunReviewShared'
import RunReviewOutcomeLabel from './RunReviewOutcomeLabel'
import RunDetailsSiteChangeGroups from './RunDetailsSiteChangeGroups'
import type { NotableChangeItem, NotableStopChangeCard } from './notableStopChanges'
import {
  RUN_REVIEW_EXPAND_CARD_EVENT,
  runReviewCardTier,
  runReviewResultHeadlineClass,
  runReviewStopDomId,
} from './notableStopChanges'
import { stopShowsNoDeficienciesConfirmedPill } from './runDetailsDeficiencyDisplay'
import type { MonthlyRunDetailReviewStopDetailPayload } from './monthlyRoutesShared'
import { apiJson } from '../../lib/apiClient'

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
  const showNoDefPill = stopShowsNoDeficienciesConfirmedPill(stop)

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
        <RunReviewOutcomeLabel
          stop={stop}
          monthDate={monthDate}
          headline={resultHeadline}
          badgeClass={resultClass}
        />
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

export default function RunDetailsSiteChangeCard({
  card,
  routeId,
  monthDate,
  onDetailLoaded,
}: {
  card: NotableStopChangeCard
  routeId: number
  monthDate: string
  onDetailLoaded: (testingSiteId: number, changes: NotableChangeItem[]) => void
}) {
  const { changes, stopNumber, displayAddress, resultHeadline, stop, siteLabel, siteIndex, siteCount } =
    card
  const monthIso = stop.month_date || monthDate
  const tier = runReviewCardTier(card, monthIso)
  const bodyId = useId()
  const [cardExpanded, setCardExpanded] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const needsDetailFetch = card.hasFieldEdits === true && changes.length === 0
  const hasDetails = changes.length > 0 || needsDetailFetch || siteCount > 1

  const loadDetail = useCallback(async () => {
    if (!needsDetailFetch || detailLoading) return
    setDetailLoading(true)
    setDetailError(null)
    try {
      const qs = new URLSearchParams({ month: monthDate })
      const data = await apiJson<MonthlyRunDetailReviewStopDetailPayload>(
        `/api/monthly_routes/routes/${routeId}/run_details/review/stops/${stop.testing_site_id}?${qs.toString()}`,
      )
      onDetailLoaded(stop.testing_site_id, data.changes)
    } catch {
      setDetailError('Could not load site changes.')
    } finally {
      setDetailLoading(false)
    }
  }, [
    needsDetailFetch,
    detailLoading,
    monthDate,
    routeId,
    stop.testing_site_id,
    onDetailLoaded,
  ])

  useEffect(() => {
    if (cardExpanded && needsDetailFetch) {
      void loadDetail()
    }
  }, [cardExpanded, needsDetailFetch, loadDetail])

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
            {detailLoading ? (
              <div className="run-detail-site-card__loading py-2">
                <Spinner animation="border" size="sm" aria-label="Loading site changes" />
              </div>
            ) : null}
            {detailError ? (
              <p className="text-danger small mb-0" role="alert">
                {detailError}
              </p>
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
