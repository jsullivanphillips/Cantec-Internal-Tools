import { useCallback, useMemo, useState } from 'react'

import { Button, Spinner } from 'react-bootstrap'

import RunDetailsFieldChangesTable from './RunDetailsFieldChangesTable'
import RunDetailsHistoryTable from './RunDetailsHistoryTable'
import RunDetailsPrepareTable from './RunDetailsPrepareTable'
import RunDetailsReviewTable from './RunDetailsReviewTable'

import type {
  MonthlyRunDetailDeficiencySummary,
  MonthlyRunDetailLocation,
  TechnicianWorksheetRun,
} from './monthlyRoutesShared'

import {
  computeRunDetailsProgress,
  countRunDetailFieldEditLocations,
  filterRunDetailFieldEditLocations,
  flattenRunDetailPrepRows,
  listAutoOfficeBillingUpdates,
  type RunDetailReviewSectionTab,
} from './runDetailsLocationReview'
import type { OfficeBillingStatus } from './officeRunReviewShared'
import { apiJson } from '../../lib/apiClient'

import { canOfficeEditBilling, runInOfficePrepPhase, worksheetRunFieldInProgress } from './runWorkflowShared'

import type { RunDetailsStopPatchApi } from './useRunDetailsStopPatch'

import type { TechnicianWorksheetStop } from './monthlyRoutesShared'

import type { PaperworkViewMode } from './paperworkViewMode'

export type RunReviewOutcomeCounts = {
  all_good_count: number
  passed_with_problems_count: number
  failed_count: number
  skipped_count: number
}

const REVIEW_OUTCOME_PROGRESS: {
  key: keyof RunReviewOutcomeCounts
  label: string
  modifier: string
}[] = [
  { key: 'all_good_count', label: 'all good', modifier: 'all-good' },
  { key: 'passed_with_problems_count', label: 'passed w/ problems', modifier: 'passed-problems' },
  { key: 'failed_count', label: 'failed', modifier: 'failed' },
  { key: 'skipped_count', label: 'skipped', modifier: 'skipped' },
]

type BillingPatchResponse = {
  ok: boolean
  location_id: number
  month_date: string
  billing_status: OfficeBillingStatus
}

function formatAutoBillingError(err: unknown): string {
  if (err && typeof err === 'object') {
    const o = err as { error?: unknown; code?: unknown }
    if (typeof o.error === 'string' && o.error.trim()) return o.error
    if (o.code === 'billing_before_field_end') {
      return 'Billing can be set after technicians end the field run.'
    }
  }
  if (typeof err === 'string' && err.trim()) return err
  return 'Could not auto-set billing. Try again or set billing manually.'
}

export default function RunDetailsLocationReviewList({
  locations,
  monthDate,
  routeId,
  run,
  runCompleted,
  sectionTab,
  onSectionTabChange,
  onBillingPatched,
  stopPatch,
  onStopMergedFromWorksheet,
  onDeficiencyUpdated,
  showHistoryTab = false,
  historyStops = [],
  historyLoading = false,
  historyCapturedAt = null,
  historyFieldWorkReopened = false,
  onTicketsChanged,
  paperworkViewMode,
  prepEditsDisabled = false,
  outcomeCounts,
  onRouteOrderChanged,
}: {
  locations: MonthlyRunDetailLocation[]
  monthDate: string
  routeId: number
  run: TechnicianWorksheetRun | null
  runCompleted: boolean
  sectionTab?: RunDetailReviewSectionTab
  onSectionTabChange?: (tab: RunDetailReviewSectionTab) => void
  onBillingPatched: (locationId: number, billingStatus: string) => void
  stopPatch: RunDetailsStopPatchApi
  onStopMergedFromWorksheet: (stop: TechnicianWorksheetStop, scope?: 'full' | 'deficiency') => void
  onDeficiencyUpdated?: (
    testingSiteId: number,
    updated: MonthlyRunDetailDeficiencySummary,
  ) => void | Promise<void>
  showHistoryTab?: boolean
  historyStops?: TechnicianWorksheetStop[]
  historyLoading?: boolean
  historyCapturedAt?: string | null
  historyFieldWorkReopened?: boolean
  onTicketsChanged?: () => void
  /** When set, renders a single locked view (Paperwork) with no tab bar. */
  paperworkViewMode?: PaperworkViewMode
  /** Block prep edits until the Pacific current month run is closed (future months). */
  prepEditsDisabled?: boolean
  outcomeCounts?: RunReviewOutcomeCounts
  onRouteOrderChanged?: (orderedLocationIds: number[]) => void | Promise<void>
}) {
  const [autoBillingBusy, setAutoBillingBusy] = useState(false)
  const [autoBillingError, setAutoBillingError] = useState<string | null>(null)

  const prepPhase = paperworkViewMode === 'preparation' || runInOfficePrepPhase(run)
  const showBillingColumn = canOfficeEditBilling(run) && !runCompleted
  const fieldWorkOpen = worksheetRunFieldInProgress(run)

  const progress = useMemo(
    () => computeRunDetailsProgress(locations, monthDate, runCompleted),
    [locations, monthDate, runCompleted],
  )

  const fieldEditLocationCount = useMemo(
    () => countRunDetailFieldEditLocations(locations),
    [locations],
  )

  const fieldChangeLocations = useMemo(
    () => filterRunDetailFieldEditLocations(locations),
    [locations],
  )

  const prepRows = useMemo(() => flattenRunDetailPrepRows(locations), [locations])

  const effectiveSectionTab: RunDetailReviewSectionTab =
    paperworkViewMode === 'exact_history'
      ? 'run_history'
      : paperworkViewMode === 'run_review'
        ? 'run_review'
        : sectionTab ?? 'run_review'

  const showRunReview =
    effectiveSectionTab === 'run_review' && paperworkViewMode !== 'exact_history'

  const autoBillingUpdates = useMemo(
    () => (showBillingColumn && showRunReview ? listAutoOfficeBillingUpdates(locations, monthDate) : []),
    [locations, monthDate, showBillingColumn, showRunReview],
  )

  const onAutoSetBilling = useCallback(async () => {
    if (autoBillingUpdates.length === 0 || autoBillingBusy) return
    setAutoBillingBusy(true)
    setAutoBillingError(null)
    const failures: string[] = []
    for (const { locationId, billingStatus } of autoBillingUpdates) {
      const loc = locations.find((item) => item.location_id === locationId)
      const previous = loc?.billing_status ?? 'unset'
      onBillingPatched(locationId, billingStatus)
      try {
        const qs = new URLSearchParams({ month: monthDate })
        const res = await apiJson<BillingPatchResponse>(
          `/api/monthly_routes/routes/${routeId}/locations/${locationId}/billing_status?${qs.toString()}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ billing_status: billingStatus }),
          },
        )
        const serverStatus = (res.billing_status || billingStatus).trim().toLowerCase()
        if (serverStatus !== billingStatus.trim().toLowerCase()) {
          onBillingPatched(locationId, res.billing_status)
        }
      } catch (err) {
        onBillingPatched(locationId, previous ?? 'unset')
        failures.push(loc?.location_label || `Location ${locationId}`)
        if (failures.length === 1) {
          setAutoBillingError(formatAutoBillingError(err))
        }
      }
    }
    if (failures.length > 1) {
      setAutoBillingError(`Could not update billing for ${failures.length} locations.`)
    }
    setAutoBillingBusy(false)
  }, [
    autoBillingBusy,
    autoBillingUpdates,
    locations,
    monthDate,
    onBillingPatched,
    routeId,
  ])

  if (prepPhase) {
    if (prepRows.length === 0) {
      return (
        <section
          id="run-review-section"
          className="monthly-run-detail-locations"
          aria-label="Sites on this run"
        >
          <p className="monthly-run-detail-empty mb-0">No stops on this route yet.</p>
        </section>
      )
    }

    return (
      <section
        id="run-review-section"
        className="monthly-run-detail-locations"
        aria-label="Sites on this run"
      >
        <RunDetailsPrepareTable
          rows={prepRows}
          routeId={routeId}
          monthDate={monthDate}
          stopPatch={stopPatch}
          onDeficiencyUpdated={onDeficiencyUpdated}
          prepEditsDisabled={prepEditsDisabled}
          onRouteOrderChanged={onRouteOrderChanged}
        />
      </section>
    )
  }

  const showRunHistory = effectiveSectionTab === 'run_history'
  const showFieldChanges = effectiveSectionTab === 'field_changes'
  const lockedPaperwork = paperworkViewMode != null

  return (
    <section
      id="run-review-section"
      className="monthly-run-detail-locations"
      aria-label="Sites on this run"
    >
      {paperworkViewMode !== 'exact_history' ? (
        <h2 className="monthly-run-detail-section__title">
          {paperworkViewMode === 'run_review' ? 'Run review' : 'Sites on this run'}
        </h2>
      ) : null}

      {fieldWorkOpen && !prepPhase ? (
        <p className="small text-muted mb-2">
          Technicians are still on this run. Billing choices unlock after they end field work; you can
          review outcomes and deficiencies below.
        </p>
      ) : null}

      {showRunReview ? (
        <>
          <div className="monthly-run-detail-progress" aria-label="Review progress">
            {showBillingColumn ? (
              <span className="monthly-run-detail-progress__item">
                <strong className="tabular-nums">{progress.billingDecidedCount}</strong>
                <span className="text-muted"> / {progress.locationCount} billing decided</span>
              </span>
            ) : null}
            {outcomeCounts
              ? REVIEW_OUTCOME_PROGRESS.map(({ key, label, modifier }) => (
                  <span
                    key={key}
                    className={`monthly-run-detail-progress__item monthly-run-detail-progress__item--${modifier}`}
                  >
                    <strong className="tabular-nums">{outcomeCounts[key]}</strong>
                    <span className="text-muted"> {label}</span>
                  </span>
                ))
              : null}
            {runCompleted && progress.prepRemainingCount > 0 ? (
              <span className="monthly-run-detail-progress__item">
                <strong className="tabular-nums">{progress.prepRemainingCount}</strong>
                <span className="text-muted"> prep remaining</span>
              </span>
            ) : null}
            {showBillingColumn ? (
              <span className="monthly-run-detail-progress__item monthly-run-detail-progress__item--action">
                <Button
                  size="sm"
                  variant="outline-primary"
                  className="monthly-run-detail-auto-billing-btn"
                  disabled={autoBillingBusy || autoBillingUpdates.length === 0}
                  onClick={() => void onAutoSetBilling()}
                >
                  {autoBillingBusy ? (
                    <>
                      <Spinner animation="border" size="sm" className="me-1" aria-hidden />
                      Auto setting…
                    </>
                  ) : (
                    'Auto set billing'
                  )}
                </Button>
              </span>
            ) : null}
          </div>
          {autoBillingError ? (
            <p className="small text-danger mb-2" role="alert">
              {autoBillingError}
            </p>
          ) : null}
        </>
      ) : null}

      {!lockedPaperwork ? (
        <div className="run-review-filter" role="tablist" aria-label="Run views">
          {showHistoryTab ? (
            <button
              type="button"
              role="tab"
              aria-selected={showRunHistory}
              className={`run-review-filter__btn${showRunHistory ? ' run-review-filter__btn--active' : ''}`}
              onClick={() => onSectionTabChange?.('run_history')}
            >
              Run history
            </button>
          ) : null}
          <button
            type="button"
            role="tab"
            aria-selected={showRunReview}
            className={`run-review-filter__btn${showRunReview ? ' run-review-filter__btn--active' : ''}`}
            onClick={() => onSectionTabChange?.('run_review')}
          >
            Run review
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={showFieldChanges}
            className={`run-review-filter__btn${showFieldChanges ? ' run-review-filter__btn--active' : ''}`}
            onClick={() => onSectionTabChange?.('field_changes')}
          >
            {fieldEditLocationCount > 0
              ? `Field changes (${fieldEditLocationCount})`
              : 'Field changes'}
          </button>
        </div>
      ) : null}

      {showRunHistory ? (
        historyLoading ? (
          <div className="run-details-history-section">
            <div className="run-details-history-shell run-details-history-shell--loading">
              <div className="d-flex align-items-center gap-2 text-muted small py-2">
                <Spinner animation="border" size="sm" aria-hidden />
                Loading exact history…
              </div>
            </div>
          </div>
        ) : historyStops.length > 0 ? (
          <RunDetailsHistoryTable
            stops={historyStops}
            monthDate={monthDate}
            capturedAt={historyCapturedAt}
            fieldWorkReopened={historyFieldWorkReopened}
            runCompleted={runCompleted}
          />
        ) : (
          <div className="run-details-history-section">
            <div className="run-details-history-shell">
              <header className="run-details-history-shell__header">
                <div className="run-details-history-shell__title-block">
                  <p className="run-details-history-shell__eyebrow">Paperwork</p>
                  <h2 className="run-details-history-shell__title">Exact history</h2>
                </div>
              </header>
              <p className="run-details-history-shell__empty mb-0">
                No field submission captured for this run.
              </p>
            </div>
          </div>
        )
      ) : null}

      {showRunReview ? (
        <RunDetailsReviewTable
          locations={locations}
          routeId={routeId}
          monthDate={monthDate}
          run={run}
          showBillingColumn={showBillingColumn}
          onBillingPatched={onBillingPatched}
          stopPatch={stopPatch}
          onStopMergedFromWorksheet={onStopMergedFromWorksheet}
          onDeficiencyUpdated={onDeficiencyUpdated}
          onTicketsChanged={onTicketsChanged}
        />
      ) : showFieldChanges ? (
        <RunDetailsFieldChangesTable
          locations={fieldChangeLocations}
          routeId={routeId}
          monthDate={monthDate}
        />
      ) : null}
    </section>
  )
}
