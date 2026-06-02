import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import RunDetailsLocationBillingControl from './RunDetailsLocationBillingControl'
import RunDetailsLocationPrepPanel from './RunDetailsLocationPrepPanel'
import RunDetailsStopSiteModal from './RunDetailsStopSiteModal'
import RunReviewOutcomeLabel from './RunReviewOutcomeLabel'
import {
  RunDetailsStopDeficienciesBlock,
  RunDetailsStopFollowUpBlock,
  RunDetailsStopTestBlock,
} from './RunDetailsStopReviewRow'
import type { OfficeBillingStatus } from './officeRunReviewShared'
import type {
  MonthlyRunDetailLocation,
  TechnicianWorksheetRun,
  TechnicianWorksheetStop,
} from './monthlyRoutesShared'
import type { RunDetailsStopPatchApi } from './useRunDetailsStopPatch'
import type { NotableChangeItem } from './notableStopChanges'
import { mergeStopDetailChanges } from './notableStopChanges'
import {
  buildStopCardFromLocation,
  locationIdentityTone,
  locationIsCompact,
  locationPrimaryOutcomeDisplay,
  runLocationReviewDomId,
  RUN_LOCATION_EXPAND_EVENT,
} from './runDetailsLocationReview'
import { canOfficeEditBilling } from './runWorkflowShared'
import {
  runReviewDeficiencySummaries,
  stopShowsNoDeficienciesConfirmedPill,
} from './runDetailsDeficiencyDisplay'
import { apiJson } from '../../lib/apiClient'

function formatBillingPatchError(err: unknown): string {
  if (err && typeof err === 'object') {
    const o = err as { error?: unknown; code?: unknown }
    if (typeof o.error === 'string' && o.error.trim()) return o.error
    if (o.code === 'billing_before_field_end') {
      return 'Billing can be set after technicians end the field run.'
    }
  }
  if (typeof err === 'string' && err.trim()) return err
  return 'Failed to update billing.'
}

type BillingPatchResponse = {
  ok: boolean
  location_id: number
  month_date: string
  billing_status: OfficeBillingStatus
}

function stopNumberColumnLabel(location: MonthlyRunDetailLocation): {
  primary: string
  secondary: string | null
} {
  const first = location.first_stop_number
  const last = location.last_stop_number
  if (first > 0 && last > 0 && first !== last) {
    return { primary: String(first), secondary: String(last) }
  }
  if (first > 0) return { primary: String(first), secondary: null }
  return { primary: '—', secondary: null }
}

function locationHasDeficiencies(
  location: MonthlyRunDetailLocation,
  run: TechnicianWorksheetRun | null,
): boolean {
  return location.stops.some(
    (stop) => runReviewDeficiencySummaries(stop.deficiency_summaries, run).length > 0,
  )
}

function stopReviewDeficiencies(
  stop: MonthlyRunDetailLocation['stops'][number],
  run: TechnicianWorksheetRun | null,
) {
  return runReviewDeficiencySummaries(stop.deficiency_summaries, run)
}

export default function RunDetailsLocationCard({
  location,
  routeId,
  monthDate,
  run,
  runCompleted,
  forceExpanded,
  changeDetailsByStopId,
  onDetailLoaded,
  onBillingPatched,
  stopPatch,
  onStopMergedFromWorksheet,
  onDeficiencyUpdated,
}: {
  location: MonthlyRunDetailLocation
  routeId: number
  monthDate: string
  run: TechnicianWorksheetRun | null
  runCompleted: boolean
  forceExpanded?: boolean
  changeDetailsByStopId: Record<number, NotableChangeItem[]>
  onDetailLoaded: (testingSiteId: number, changes: NotableChangeItem[]) => void
  onBillingPatched: (locationId: number, billingStatus: string) => void
  stopPatch: RunDetailsStopPatchApi
  onStopMergedFromWorksheet: (stop: TechnicianWorksheetStop, scope?: 'full' | 'deficiency') => void
  onDeficiencyUpdated?: () => void | Promise<void>
}) {
  const readOnly = (run?.source || '').trim().toLowerCase() === 'csv_import'
  const showBilling = canOfficeEditBilling(run) && !runCompleted
  const compact = locationIsCompact(location, monthDate)
  const [changesExpanded, setChangesExpanded] = useState(!compact || forceExpanded === true)
  const [billingError, setBillingError] = useState<string | null>(null)
  const [siteModalStopId, setSiteModalStopId] = useState<number | null>(null)
  const domId = runLocationReviewDomId(location.location_id)
  const flags = location.attention_flags
  const multiStop = location.stops.length > 1

  const primaryOutcome = useMemo(
    () => locationPrimaryOutcomeDisplay(location, monthDate),
    [location, monthDate],
  )
  const identityTone = useMemo(
    () => locationIdentityTone(location, monthDate),
    [location, monthDate],
  )
  const stopLabel = useMemo(() => stopNumberColumnLabel(location), [location])
  const hasDeficiencies = useMemo(
    () => locationHasDeficiencies(location, run),
    [location, run],
  )

  useEffect(() => {
    if (forceExpanded) setChangesExpanded(true)
  }, [forceExpanded])

  useEffect(() => {
    const onExpand = (event: Event) => {
      const detail = (event as CustomEvent<{ domId?: string }>).detail
      if (detail?.domId === domId) setChangesExpanded(true)
    }
    window.addEventListener(RUN_LOCATION_EXPAND_EVENT, onExpand)
    return () => window.removeEventListener(RUN_LOCATION_EXPAND_EVENT, onExpand)
  }, [domId])

  const stopCards = useMemo(
    () =>
      location.stops.map((stop) => {
        const base = buildStopCardFromLocation(location, stop, monthDate)
        const loaded = changeDetailsByStopId[stop.testing_site_id]
        return loaded ? mergeStopDetailChanges(base, loaded) : base
      }),
    [location, monthDate, changeDetailsByStopId],
  )

  const setBilling = useCallback(
    async (billing_status: OfficeBillingStatus) => {
      const previous = location.billing_status
      const current = (previous || '').trim().toLowerCase()
      const next = billing_status.trim().toLowerCase()
      if (current === next) return
      setBillingError(null)
      onBillingPatched(location.location_id, billing_status)
      try {
        const qs = new URLSearchParams({ month: monthDate })
        const res = await apiJson<BillingPatchResponse>(
          `/api/monthly_routes/routes/${routeId}/locations/${location.location_id}/billing_status?${qs.toString()}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ billing_status }),
          },
        )
        const serverStatus = (res.billing_status || billing_status).trim().toLowerCase()
        if (serverStatus !== next) {
          onBillingPatched(location.location_id, res.billing_status)
        }
      } catch (e) {
        onBillingPatched(location.location_id, previous ?? 'unset')
        setBillingError(formatBillingPatchError(e))
      }
    },
    [routeId, monthDate, location.location_id, location.billing_status, onBillingPatched],
  )

  const showChangesToggle = compact && (flags.has_job_comment || runCompleted)

  const changesColVisible = changesExpanded || !compact || forceExpanded

  const openSiteModal = useCallback((testingSiteId: number) => {
    setSiteModalStopId(testingSiteId)
  }, [])

  const primaryTestingSiteId = stopCards[0]?.stop.testing_site_id

  return (
    <article
      id={domId}
      className={`run-location-card monthly-location-detail-surface${compact ? ' run-location-card--compact' : ''}${changesExpanded ? ' run-location-card--expanded' : ''}`}
      aria-label={location.location_label}
    >
      <div
        className={`run-location-card__layout${showBilling ? '' : ' run-location-card__layout--no-billing'}`}
      >
        <div
          className="run-location-card__stop-col"
          aria-label={
            stopLabel.secondary
              ? `Stops ${stopLabel.primary} to ${stopLabel.secondary}`
              : `Stop ${stopLabel.primary}`
          }
        >
          <span className="run-location-card__stop-hash" aria-hidden>
            #
          </span>
          <span className="run-location-card__stop-num tabular-nums">{stopLabel.primary}</span>
          {stopLabel.secondary ? (
            <>
              <span className="run-location-card__stop-range-sep" aria-hidden>
                –
              </span>
              <span className="run-location-card__stop-num tabular-nums">{stopLabel.secondary}</span>
            </>
          ) : null}
        </div>

        <div
          className={`run-location-card__test-col run-location-card__test-col--tone-${identityTone}${
            !multiStop && primaryTestingSiteId != null
              ? ' run-location-card__test-col--clickable'
              : ''
          }`}
          role={!multiStop && primaryTestingSiteId != null ? 'button' : undefined}
          tabIndex={!multiStop && primaryTestingSiteId != null ? 0 : undefined}
          onClick={
            !multiStop && primaryTestingSiteId != null
              ? () => openSiteModal(primaryTestingSiteId)
              : undefined
          }
          onKeyDown={
            !multiStop && primaryTestingSiteId != null
              ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    openSiteModal(primaryTestingSiteId)
                  }
                }
              : undefined
          }
          aria-label={
            !multiStop && primaryTestingSiteId != null
              ? `View site details for ${location.location_label}`
              : undefined
          }
        >
          <Link
            to={`/monthlies/locations/${location.location_id}`}
            className="run-location-card__address"
            onClick={(e) => e.stopPropagation()}
          >
            {location.location_label}
          </Link>
          {multiStop ? (
            <div className="run-location-card__test-stops">
              {stopCards.map((card, idx) => (
                <RunDetailsStopTestBlock
                  key={card.stop.testing_site_id}
                  card={card}
                  showSiteLabel
                  activeDeficiencyCount={
                    stopReviewDeficiencies(location.stops[idx], run).length
                  }
                  onOpen={() => openSiteModal(card.stop.testing_site_id)}
                />
              ))}
            </div>
          ) : (
            <>
              {primaryOutcome && stopCards[0] ? (
                <RunReviewOutcomeLabel
                  stop={stopCards[0].stop}
                  monthDate={monthDate}
                  headline={primaryOutcome.headline}
                  badgeClass={primaryOutcome.badgeClass}
                  className="run-location-card__outcome"
                />
              ) : null}
              {stopCards[0] &&
              stopShowsNoDeficienciesConfirmedPill(
                stopCards[0].stop,
                stopReviewDeficiencies(location.stops[0], run).length,
              ) ? (
                <span className="run-details-stop-row__no-def-pill">No deficiencies confirmed</span>
              ) : null}
            </>
          )}
        </div>

        {showBilling ? (
          <div className="run-location-card__billing-col">
            <RunDetailsLocationBillingControl
              billingStatus={location.billing_status}
              readOnly={readOnly}
              error={billingError}
              onChange={(status) => void setBilling(status)}
            />
          </div>
        ) : null}

        <div
          className={`run-location-card__deficiencies-col${hasDeficiencies ? ' run-location-card__deficiencies-col--has-items' : ''}`}
          aria-label="Deficiencies"
        >
          {hasDeficiencies ? (
            <div className="run-location-card__deficiencies-stops">
              {stopCards.map((card, idx) => (
                <RunDetailsStopDeficienciesBlock
                  key={card.stop.testing_site_id}
                  card={card}
                  deficiencies={stopReviewDeficiencies(location.stops[idx], run)}
                  showSiteLabel={multiStop}
                  locationLabel={location.location_label}
                  routeId={routeId}
                  monthDate={monthDate}
                  readOnly={readOnly}
                  onDeficiencyUpdated={onDeficiencyUpdated}
                />
              ))}
            </div>
          ) : null}
        </div>

        <div className="run-location-card__changes-col">
          {showChangesToggle ? (
            <button
              type="button"
              className="run-location-card__expand-btn btn btn-link btn-sm"
              aria-expanded={changesColVisible}
              onClick={() => setChangesExpanded((v) => !v)}
            >
              <i className={`bi ${changesColVisible ? 'bi-chevron-up' : 'bi-chevron-down'}`} aria-hidden />
              <span className="visually-hidden">
                {changesColVisible ? 'Collapse job comments' : 'Expand job comments'}
              </span>
            </button>
          ) : null}
          {changesColVisible ? (
            <div className="run-location-card__changes-body">
              <div className="run-location-card__changes-stops">
                {stopCards.map((card) => (
                  <RunDetailsStopFollowUpBlock
                    key={card.stop.testing_site_id}
                    card={card}
                    routeId={routeId}
                    monthDate={monthDate}
                    showSiteLabel={multiStop}
                    showFieldChanges={false}
                    onDetailLoaded={onDetailLoaded}
                  />
                ))}
              </div>
              {runCompleted ? (
                <RunDetailsLocationPrepPanel
                  location={location}
                  monthDate={monthDate}
                  stopPatch={stopPatch}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <RunDetailsStopSiteModal
        show={siteModalStopId != null}
        testingSiteId={siteModalStopId}
        routeId={routeId}
        monthDate={monthDate}
        run={run}
        onHide={() => setSiteModalStopId(null)}
        stopPatch={stopPatch}
        onStopMergedFromWorksheet={onStopMergedFromWorksheet}
      />
    </article>
  )
}
