import { useCallback, useEffect, useMemo, useState } from 'react'
import { Form } from 'react-bootstrap'

import RunDetailsLocationCard from './RunDetailsLocationCard'
import RunDetailsLocationColumnHeader from './RunDetailsLocationColumnHeader'
import RunDetailsLocationFilterBar from './RunDetailsLocationFilterBar'
import RunDetailsPrepareTable from './RunDetailsPrepareTable'

import type {
  MonthlyRunDetailLocation,
  TechnicianWorksheetRun,
} from './monthlyRoutesShared'
import type { NotableChangeItem, RunReviewSummary } from './notableStopChanges'
import {
  computeRunDetailsPrepSummary,
  computeRunDetailsProgress,
  filterRunDetailLocations,
  filterRunDetailPrepRows,
  flattenRunDetailPrepRows,
  mapReviewSummaryPayload,
  type RunLocationReviewFilter,
} from './runDetailsLocationReview'
import { canOfficeEditBilling, runInOfficePrepPhase, worksheetRunFieldInProgress } from './runWorkflowShared'
import type { RunReviewSummaryPayload, TechnicianWorksheetStop } from './monthlyRoutesShared'
import type { RunDetailsStopPatchApi } from './useRunDetailsStopPatch'

export default function RunDetailsLocationReviewList({
  locations,
  monthDate,
  routeId,
  run,
  runCompleted,
  reviewSummary,
  filter,
  onFilterChange,
  onBillingPatched,
  stopPatch,
  onStopMergedFromWorksheet,
  onDeficiencyUpdated,
}: {
  locations: MonthlyRunDetailLocation[]
  monthDate: string
  routeId: number
  run: TechnicianWorksheetRun | null
  runCompleted: boolean
  reviewSummary: RunReviewSummaryPayload | null
  filter: RunLocationReviewFilter
  onFilterChange: (filter: RunLocationReviewFilter) => void
  onBillingPatched: (locationId: number, billingStatus: string) => void
  stopPatch: RunDetailsStopPatchApi
  onStopMergedFromWorksheet: (stop: TechnicianWorksheetStop, scope?: 'full' | 'deficiency') => void
  onDeficiencyUpdated?: () => void | Promise<void>
}) {
  const [changeDetailsByStopId, setChangeDetailsByStopId] = useState<Record<number, NotableChangeItem[]>>(
    {},
  )
  const [prepSearch, setPrepSearch] = useState('')

  const prepPhase = runInOfficePrepPhase(run)
  const showBillingColumn = canOfficeEditBilling(run) && !runCompleted
  const fieldWorkOpen = worksheetRunFieldInProgress(run)

  useEffect(() => {
    if (!showBillingColumn && filter === 'billing_unset') {
      onFilterChange('all')
    }
  }, [showBillingColumn, filter, onFilterChange])

  const summary: RunReviewSummary = useMemo(() => {
    if (reviewSummary) return mapReviewSummaryPayload(reviewSummary)
    return {
      stopCount: locations.reduce((n, loc) => n + loc.stops.length, 0),
      outcomeOnlyCount: 0,
      allGoodCount: 0,
      passedWithProblemsCount: 0,
      failedCount: 0,
      skippedCount: 0,
      updatedCount: 0,
    }
  }, [reviewSummary, locations])

  const prepSummary = useMemo(() => computeRunDetailsPrepSummary(locations), [locations])

  const progress = useMemo(
    () => computeRunDetailsProgress(locations, monthDate, runCompleted),
    [locations, monthDate, runCompleted],
  )

  const billingUnsetCount = useMemo(
    () => locations.filter((loc) => loc.attention_flags.billing_unset).length,
    [locations],
  )

  const filtered = useMemo(
    () => (prepPhase ? locations : filterRunDetailLocations(locations, filter, monthDate)),
    [locations, filter, monthDate, prepPhase],
  )

  const prepRows = useMemo(() => {
    const rows = flattenRunDetailPrepRows(filtered)
    return filterRunDetailPrepRows(rows, prepSearch)
  }, [filtered, prepSearch])

  const onDetailLoaded = useCallback((testingSiteId: number, changes: NotableChangeItem[]) => {
    setChangeDetailsByStopId((prev) => ({ ...prev, [testingSiteId]: changes }))
  }, [])

  const forceExpanded = filter !== 'all'

  if (prepPhase) {
    return (
      <section
        id="run-review-section"
        className="monthly-run-detail-locations"
        aria-label="Sites on this run"
      >
        <div className="monthly-location-detail-surface run-details-prep-section">
          <div className="run-details-prep-section__header">
            <h2 className="monthly-run-detail-section__title mb-0">Sites on this run</h2>
            <span className="monthly-run-detail-section__meta text-muted small tabular-nums">
              {prepSummary.stopCount} {prepSummary.stopCount === 1 ? 'stop' : 'stops'}
            </span>
          </div>
          <p className="monthly-run-detail-section__meta text-muted small mb-3">
            Click a field to edit. Use Save or Cancel before moving to another field.
          </p>
          {locations.length > 3 ? (
            <div className="run-details-prep-search mb-3">
              <Form.Control
                size="sm"
                type="search"
                className="run-details-prep-search__input"
                placeholder="Search address or stop #…"
                value={prepSearch}
                onChange={(e) => setPrepSearch(e.target.value)}
                aria-label="Search prep stops"
              />
            </div>
          ) : null}
          {prepRows.length === 0 && locations.length > 0 ? (
            <p className="monthly-run-detail-empty mb-0">
              {prepSearch.trim() ? 'No stops match this search.' : 'No stops on this route yet.'}
            </p>
          ) : (
            <RunDetailsPrepareTable
              rows={prepRows}
              routeId={routeId}
              monthDate={monthDate}
              stopPatch={stopPatch}
              onDeficiencyUpdated={onDeficiencyUpdated}
            />
          )}
        </div>
      </section>
    )
  }

  return (
    <section
      id="run-review-section"
      className="monthly-run-detail-locations"
      aria-label="Sites on this run"
    >
      <h2 className="monthly-run-detail-section__title">Sites on this run</h2>
      {fieldWorkOpen && !prepPhase ? (
        <p className="small text-muted mb-2">
          Technicians are still on this run. Billing choices unlock after they end field work; you can
          review outcomes and deficiencies below.
        </p>
      ) : null}
      <div className="monthly-run-detail-progress" aria-label="Review progress">
        {showBillingColumn ? (
          <span className="monthly-run-detail-progress__item">
            <strong className="tabular-nums">{progress.billingDecidedCount}</strong>
            <span className="text-muted"> / {progress.locationCount} billing decided</span>
          </span>
        ) : null}
        {progress.needsAttentionCount > 0 ? (
          <span className="monthly-run-detail-progress__item monthly-run-detail-progress__item--warn">
            <strong className="tabular-nums">{progress.needsAttentionCount}</strong>
            <span className="text-muted"> need attention</span>
          </span>
        ) : null}
        {runCompleted && progress.prepRemainingCount > 0 ? (
          <span className="monthly-run-detail-progress__item">
            <strong className="tabular-nums">{progress.prepRemainingCount}</strong>
            <span className="text-muted"> prep remaining</span>
          </span>
        ) : null}
      </div>
      <RunDetailsLocationFilterBar
        filter={filter}
        onFilterChange={onFilterChange}
        summary={summary}
        needsAttentionCount={progress.needsAttentionCount}
        billingUnsetCount={billingUnsetCount}
        showBillingFilters={showBillingColumn}
      />
      {filtered.length === 0 && locations.length > 0 ? (
        <p className="monthly-run-detail-empty mb-0">No locations match this filter.</p>
      ) : (
        <>
          <RunDetailsLocationColumnHeader showBilling={showBillingColumn} />
          <ul className="run-location-card-list list-unstyled mb-0">
          {filtered.map((location) => (
            <li key={location.location_id}>
              <RunDetailsLocationCard
                location={location}
                routeId={routeId}
                monthDate={monthDate}
                run={run}
                runCompleted={runCompleted}
                forceExpanded={forceExpanded}
                changeDetailsByStopId={changeDetailsByStopId}
                onDetailLoaded={onDetailLoaded}
                onBillingPatched={onBillingPatched}
                stopPatch={stopPatch}
                onStopMergedFromWorksheet={onStopMergedFromWorksheet}
                onDeficiencyUpdated={onDeficiencyUpdated}
              />
            </li>
          ))}
          </ul>
        </>
      )}
    </section>
  )
}
