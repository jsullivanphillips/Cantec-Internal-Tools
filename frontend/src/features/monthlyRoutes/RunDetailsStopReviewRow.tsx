import { useCallback, useEffect, useId, useState } from 'react'
import { Spinner } from 'react-bootstrap'
import RunDetailsDeficiencyList from './RunDetailsDeficiencyList'
import RunDetailsSiteChangeGroups from './RunDetailsSiteChangeGroups'
import type {
  MonthlyRunDetailDeficiencySummary,
  MonthlyRunDetailReviewStopDetailPayload,
} from './monthlyRoutesShared'
import type { NotableChangeItem, NotableStopChangeCard } from './notableStopChanges'
import RunReviewOutcomeLabel from './RunReviewOutcomeLabel'
import { runReviewResultHeadlineClass } from './notableStopChanges'
import { stopShowsNoDeficienciesConfirmedPill } from './runDetailsDeficiencyDisplay'
import { apiJson } from '../../lib/apiClient'

export function RunDetailsStopTestBlock({
  card,
  showSiteLabel,
  onOpen,
  activeDeficiencyCount = 0,
}: {
  card: NotableStopChangeCard
  showSiteLabel: boolean
  onOpen?: () => void
  activeDeficiencyCount?: number
}) {
  const { resultHeadline, stop, siteLabel, siteIndex, siteCount, stopNumber } = card
  const monthIso = stop.month_date
  const resultClass = runReviewResultHeadlineClass(stop, monthIso)
  const showNoDefPill = stopShowsNoDeficienciesConfirmedPill(stop, activeDeficiencyCount)
  const showSiteMeta = showSiteLabel && siteCount > 1

  if (!resultHeadline && !showNoDefPill && !showSiteMeta && !onOpen) return null

  const inner = (
    <>
      {showSiteMeta ? (
        <div className="run-location-card__test-site text-muted small">
          <span className="tabular-nums">Stop {stopNumber}</span>
          <span>
            {siteLabel !== 'Primary testing location' ? siteLabel : `Site ${siteIndex}`}
            {siteCount > 1 ? ` · ${siteIndex} of ${siteCount}` : ''}
          </span>
        </div>
      ) : null}
      {resultHeadline ? (
        <RunReviewOutcomeLabel
          stop={stop}
          monthDate={monthIso}
          headline={resultHeadline}
          badgeClass={resultClass}
          className="run-location-card__outcome"
        />
      ) : null}
      {showNoDefPill ? (
        <span className="run-details-stop-row__no-def-pill">No deficiencies confirmed</span>
      ) : null}
    </>
  )

  if (!onOpen) {
    return <div className="run-location-card__test-stop">{inner}</div>
  }

  return (
    <button
      type="button"
      className="run-location-card__test-stop-btn"
      onClick={onOpen}
      aria-label={`View site details for stop ${stopNumber}`}
    >
      {inner}
    </button>
  )
}

export function RunDetailsStopDeficienciesBlock({
  card,
  deficiencies,
  showSiteLabel,
  locationLabel,
  routeId,
  monthDate,
  readOnly,
  onDeficiencyUpdated,
}: {
  card: NotableStopChangeCard
  deficiencies: MonthlyRunDetailDeficiencySummary[]
  showSiteLabel: boolean
  locationLabel?: string
  routeId: number
  monthDate: string
  readOnly?: boolean
  onDeficiencyUpdated?: (
    testingSiteId: number,
    updated: MonthlyRunDetailDeficiencySummary,
  ) => void | Promise<void>
}) {
  const { siteLabel, siteIndex, siteCount, stopNumber } = card
  const showSiteMeta = showSiteLabel && siteCount > 1

  if (!deficiencies.length) return null

  return (
    <div className="run-location-card__deficiencies-stop">
      {showSiteMeta ? (
        <div className="run-location-card__deficiencies-site text-muted small">
          <span className="tabular-nums">Stop {stopNumber}</span>
          <span>
            {siteLabel !== 'Primary testing location' ? siteLabel : `Site ${siteIndex}`}
          </span>
        </div>
      ) : null}
      <RunDetailsDeficiencyList
        deficiencies={deficiencies}
        routeId={routeId}
        monthDate={monthDate}
        testingSiteId={card.stop.testing_site_id}
        readOnly={readOnly}
        onDeficiencyUpdated={onDeficiencyUpdated}
        modalContext={{
          locationLabel,
          stopNumber,
          siteLabel: showSiteMeta ? siteLabel : undefined,
        }}
      />
    </div>
  )
}

export function RunDetailsStopFollowUpBlock({
  card,
  routeId,
  monthDate,
  showSiteLabel,
  showFieldChanges = true,
  onDetailLoaded,
}: {
  card: NotableStopChangeCard
  routeId: number
  monthDate: string
  showSiteLabel: boolean
  /** When false, only job comments are shown (run review table). */
  showFieldChanges?: boolean
  onDetailLoaded: (testingSiteId: number, changes: NotableChangeItem[]) => void
}) {
  const { changes, stopNumber, stop, siteLabel, siteIndex, siteCount } = card
  const bodyId = useId()
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const needsDetailFetch =
    showFieldChanges && card.hasFieldEdits === true && changes.length === 0
  const hasChangeDetails = showFieldChanges && (changes.length > 0 || needsDetailFetch)
  const runComment = (stop.run_comments || '').trim()
  const showSiteMeta = showSiteLabel && siteCount > 1

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
  }, [needsDetailFetch, detailLoading, monthDate, routeId, stop.testing_site_id, onDetailLoaded])

  useEffect(() => {
    if (needsDetailFetch) void loadDetail()
  }, [needsDetailFetch, loadDetail])

  const hasContent = runComment.length > 0 || hasChangeDetails

  if (!hasContent) return null

  return (
    <div className="run-location-card__changes-stop">
      {showSiteMeta ? (
        <div className="run-location-card__changes-site text-muted small mb-1">
          <span className="tabular-nums">Stop {stopNumber}</span>
          <span>
            {siteLabel !== 'Primary testing location' ? siteLabel : `Site ${siteIndex}`}
          </span>
        </div>
      ) : null}
      {runComment ? (
        <div className="run-details-stop-row__job-comment" role="note">
          <span className="run-details-stop-row__job-comment-label">Job comment</span>
          <p className="run-details-stop-row__job-comment-text mb-0">{runComment}</p>
        </div>
      ) : null}
      {hasChangeDetails ? (
        <div className="run-location-card__field-changes" id={bodyId}>
          <div className="run-location-card__field-changes-label small text-muted">Field changes</div>
          {detailLoading ? (
            <div className="py-1">
              <Spinner animation="border" size="sm" aria-label="Loading site changes" />
            </div>
          ) : null}
          {detailError ? (
            <p className="text-danger small mb-0" role="alert">
              {detailError}
            </p>
          ) : null}
          {changes.length > 0 ? <RunDetailsSiteChangeGroups changes={changes} /> : null}
        </div>
      ) : null}
    </div>
  )
}

/** @deprecated Use RunDetailsStopTestBlock and RunDetailsStopFollowUpBlock */
export default function RunDetailsStopReviewRow({
  card,
  routeId,
  monthDate,
  hideIdentity = false,
  showSiteLabel = false,
  onDetailLoaded,
}: {
  card: NotableStopChangeCard
  routeId: number
  monthDate: string
  hideIdentity?: boolean
  showSiteLabel?: boolean
  onDetailLoaded: (testingSiteId: number, changes: NotableChangeItem[]) => void
}) {
  if (hideIdentity) {
    return (
      <RunDetailsStopFollowUpBlock
        card={card}
        routeId={routeId}
        monthDate={monthDate}
        showSiteLabel={showSiteLabel}
        onDetailLoaded={onDetailLoaded}
      />
    )
  }
  return (
    <>
      <RunDetailsStopTestBlock card={card} showSiteLabel={showSiteLabel} />
      <RunDetailsStopFollowUpBlock
        card={card}
        routeId={routeId}
        monthDate={monthDate}
        showSiteLabel={showSiteLabel}
        onDetailLoaded={onDetailLoaded}
      />
    </>
  )
}
