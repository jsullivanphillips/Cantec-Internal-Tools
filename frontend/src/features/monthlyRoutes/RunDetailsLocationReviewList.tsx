import { useMemo, useState } from 'react'

import { Form, Spinner } from 'react-bootstrap'

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
  computeRunDetailsPrepSummary,
  computeRunDetailsProgress,
  countRunDetailFieldEditLocations,
  filterRunDetailFieldEditLocations,
  filterRunDetailPrepRows,
  flattenRunDetailPrepRows,
  type RunDetailReviewSectionTab,
} from './runDetailsLocationReview'

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
  jobItemsByLocationId = {},
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
  jobItemsByLocationId?: Record<number, { description: string; quantity: number }[]>
  /** When set, renders a single locked view (Paperwork) with no tab bar. */
  paperworkViewMode?: PaperworkViewMode
  /** Block prep edits until the Pacific current month run is closed (future months). */
  prepEditsDisabled?: boolean
  outcomeCounts?: RunReviewOutcomeCounts
  onRouteOrderChanged?: () => void | Promise<void>
}) {
  const [prepSearch, setPrepSearch] = useState('')

  const prepPhase = paperworkViewMode === 'preparation' || runInOfficePrepPhase(run)
  const showBillingColumn = canOfficeEditBilling(run) && !runCompleted
  const fieldWorkOpen = worksheetRunFieldInProgress(run)

  const prepSummary = useMemo(() => computeRunDetailsPrepSummary(locations), [locations])

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

  const prepRows = useMemo(() => {
    const rows = flattenRunDetailPrepRows(locations)
    return filterRunDetailPrepRows(rows, prepSearch)
  }, [locations, prepSearch])

  const effectiveSectionTab: RunDetailReviewSectionTab =
    paperworkViewMode === 'exact_history'
      ? 'run_history'
      : paperworkViewMode === 'run_review'
        ? 'run_review'
        : sectionTab ?? 'run_review'

  if (prepPhase) {
    return (
      <section
        id="run-review-section"
        className="monthly-run-detail-locations"
        aria-label="Sites on this run"
      >
        <div className="monthly-location-detail-surface run-details-prep-section">
          <div className="run-details-prep-section__header">
            <h2 className="monthly-run-detail-section__title mb-0">Run preparation</h2>
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
              prepEditsDisabled={prepEditsDisabled}
              reorderDisabled={prepSearch.trim().length > 0}
              onRouteOrderChanged={onRouteOrderChanged}
            />
          )}
        </div>
      </section>
    )
  }

  const showRunHistory = effectiveSectionTab === 'run_history'
  const showRunReview = effectiveSectionTab === 'run_review'
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
        </div>
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
          jobItemsByLocationId={jobItemsByLocationId}
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
