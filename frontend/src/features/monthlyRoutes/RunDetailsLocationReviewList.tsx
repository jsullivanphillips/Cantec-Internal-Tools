import { useMemo, useState } from 'react'

import { Form } from 'react-bootstrap'

import RunDetailsFieldChangesTable from './RunDetailsFieldChangesTable'
import RunDetailsPrepareTable from './RunDetailsPrepareTable'
import RunDetailsReviewTable from './RunDetailsReviewTable'

import type {
  MonthlyRunDetailLocation,
  TechnicianWorksheetRun,
} from './monthlyRoutesShared'

import {

  computeRunDetailsPrepSummary,

  computeRunDetailsProgress,

  countRunDetailFieldEditLocations,

  filterRunDetailFieldEditLocations,

  filterRunDetailLocations,

  filterRunDetailPrepRows,

  flattenRunDetailPrepRows,

  type RunDetailReviewSectionTab,

  type RunLocationReviewFilter,

} from './runDetailsLocationReview'

import { canOfficeEditBilling, runInOfficePrepPhase, worksheetRunFieldInProgress } from './runWorkflowShared'

import type { RunDetailsStopPatchApi } from './useRunDetailsStopPatch'

import type { TechnicianWorksheetStop } from './monthlyRoutesShared'



export default function RunDetailsLocationReviewList({

  locations,

  monthDate,

  routeId,

  run,

  runCompleted,

  filter,

  sectionTab,

  onSectionTabChange,

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

  /** Outcome filter from KPI chips (no filter bar in UI). */

  filter: RunLocationReviewFilter

  sectionTab: RunDetailReviewSectionTab

  onSectionTabChange: (tab: RunDetailReviewSectionTab) => void

  onBillingPatched: (locationId: number, billingStatus: string) => void

  stopPatch: RunDetailsStopPatchApi

  onStopMergedFromWorksheet: (stop: TechnicianWorksheetStop, scope?: 'full' | 'deficiency') => void

  onDeficiencyUpdated?: () => void | Promise<void>

}) {

  const [prepSearch, setPrepSearch] = useState('')



  const prepPhase = runInOfficePrepPhase(run)

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



  const runReviewLocations = useMemo(

    () => filterRunDetailLocations(locations, filter, monthDate),

    [locations, filter, monthDate],

  )



  const fieldChangeLocations = useMemo(

    () => filterRunDetailFieldEditLocations(locations),

    [locations],

  )



  const prepRows = useMemo(() => {

    const rows = flattenRunDetailPrepRows(locations)

    return filterRunDetailPrepRows(rows, prepSearch)

  }, [locations, prepSearch])



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



  const showRunReview = sectionTab === 'run_review'
  const showFieldChanges = sectionTab === 'field_changes'

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

      <div className="run-review-filter" role="tablist" aria-label="Run review views">

        <button

          type="button"

          role="tab"

          aria-selected={showRunReview}

          className={`run-review-filter__btn${showRunReview ? ' run-review-filter__btn--active' : ''}`}

          onClick={() => onSectionTabChange('run_review')}

        >

          Run review

        </button>

        <button

          type="button"

          role="tab"

          aria-selected={showFieldChanges}

          className={`run-review-filter__btn${showFieldChanges ? ' run-review-filter__btn--active' : ''}`}

          onClick={() => onSectionTabChange('field_changes')}

        >

          {fieldEditLocationCount > 0

            ? `Field changes (${fieldEditLocationCount})`

            : 'Field changes'}

        </button>

      </div>

      {showRunReview ? (

        <>

          {runReviewLocations.length === 0 && locations.length > 0 && filter !== 'all' ? (

            <p className="monthly-run-detail-empty mb-0">No locations match this outcome filter.</p>

          ) : (
            <RunDetailsReviewTable
              locations={runReviewLocations}
              routeId={routeId}
              monthDate={monthDate}
              run={run}
              showBillingColumn={showBillingColumn}
              onBillingPatched={onBillingPatched}
              stopPatch={stopPatch}
              onStopMergedFromWorksheet={onStopMergedFromWorksheet}
              onDeficiencyUpdated={onDeficiencyUpdated}
            />
          )}

        </>

      ) : (

        <RunDetailsFieldChangesTable

          locations={fieldChangeLocations}

          routeId={routeId}

          monthDate={monthDate}

        />

      )}

    </section>

  )

}

