import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Button, Modal, Spinner } from 'react-bootstrap'
import { Link, useParams } from 'react-router-dom'
import RunDetailsLocationReviewList from '../features/monthlyRoutes/RunDetailsLocationReviewList'
import RunDetailsPreRunMessageCard from '../features/monthlyRoutes/RunDetailsPreRunMessageCard'
import RunWorkflowStepper from '../features/monthlyRoutes/RunWorkflowStepper'
import type { RunReviewFilter } from '../features/monthlyRoutes/notableStopChanges'
import {
  parseYearMonth,
  runOfficeStatusPillLabel,
  worksheetOfficeRunActivity,
  worksheetRunExplicitlyCompleted,
  type MonthlyRunDetailLocationStop,
  type MonthlyRunDetailPayload,
  type MonthlySpecialistTechRow,
  type TechnicianWorksheetRun,
} from '../features/monthlyRoutes/monthlyRoutesShared'
import {
  canOfficeCompleteRun,
  deriveRunWorkflowStage,
  runFieldEnded,
  runInOfficePrepPhase,
  runIsPrepared,
} from '../features/monthlyRoutes/runWorkflowShared'
import {
  computeRunDetailsPrepSummary,
  dispatchRunLocationExpand,
  filterRunDetailLocations,
  patchRunDetailLocationBilling,
  patchRunDetailPreRunMessage,
  patchRunDetailLocationStop,
  runLocationReviewDomId,
  type RunLocationReviewFilter,
} from '../features/monthlyRoutes/runDetailsLocationReview'
import { clearWorksheetCache } from '../features/monthlyRoutes/worksheetOfflineStore'
import { apiJson, isAbortError } from '../lib/apiClient'
import MonthlyRunDetailPageSkeleton from './MonthlyRunDetailPageSkeleton'

const MONTH_FIRST_RE = /^\d{4}-\d{2}-01$/

function formatMonthHeading(monthFirstIso: string): string {
  const ym = parseYearMonth(monthFirstIso)
  if (!ym) return monthFirstIso
  return new Intl.DateTimeFormat('en-CA', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(ym.year, ym.month - 1, 1)))
}

function formatRunTimestamp(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d)
}

function specialistTechLabel(t: MonthlySpecialistTechRow): string {
  return (t.tech_name || t.name || '').trim() || '—'
}

function completedByTechniciansPillLabel(techs: MonthlySpecialistTechRow[]): string | null {
  const names = techs.map(specialistTechLabel).filter((n) => n !== '—')
  if (!names.length) return null
  return `Completed by ${names.join(', ')}`
}

function runActivityVariant(activity: ReturnType<typeof worksheetOfficeRunActivity>): string {
  switch (activity) {
    case 'completed':
      return 'success'
    case 'active':
      return 'primary'
    default:
      return 'secondary'
  }
}

function toLocationFilter(filter: RunReviewFilter): RunLocationReviewFilter {
  return filter
}

export default function MonthlyRunDetailPage() {
  const { routeId, monthIso } = useParams<{ routeId: string; monthIso: string }>()
  const idNum = routeId ? parseInt(routeId, 10) : NaN
  const monthQuery = (monthIso || '').trim()
  const monthOk = MONTH_FIRST_RE.test(monthQuery) && parseYearMonth(monthQuery) != null

  const [payload, setPayload] = useState<MonthlyRunDetailPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [runLifecycleAction, setRunLifecycleAction] = useState<
    'prepare' | 'review_complete' | 'complete' | 'reopen' | null
  >(null)
  const [resetRunModalOpen, setResetRunModalOpen] = useState(false)
  const [resetRunBusy, setResetRunBusy] = useState(false)
  const [reviewFilter, setReviewFilter] = useState<RunLocationReviewFilter>('all')

  const loadRunDetails = useCallback(async (signal?: AbortSignal) => {
    if (!Number.isFinite(idNum) || !monthOk) return
    const qs = new URLSearchParams({ month: monthQuery })
    const data = await apiJson<MonthlyRunDetailPayload>(
      `/api/monthly_routes/routes/${idNum}/run_details?${qs.toString()}`,
      { signal },
    )
    setPayload(data)
    setError(null)
  }, [idNum, monthOk, monthQuery])

  useEffect(() => {
    if (!Number.isFinite(idNum) || !monthOk) {
      setLoading(false)
      setError('Invalid route or month.')
      return
    }
    const ac = new AbortController()
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        await loadRunDetails(ac.signal)
      } catch (e) {
        if (isAbortError(e)) return
        setError(e instanceof Error ? e.message : 'Failed to load run details.')
        setPayload(null)
      } finally {
        if (!ac.signal.aborted) setLoading(false)
      }
    })()
    return () => ac.abort()
  }, [idNum, monthOk, loadRunDetails])

  const onBillingPatched = useCallback((locationId: number, billingStatus: string) => {
    setPayload((prev) => {
      if (!prev?.locations?.length) return prev
      return {
        ...prev,
        locations: patchRunDetailLocationBilling(
          prev.locations,
          locationId,
          billingStatus,
          prev.month_date,
        ),
      }
    })
  }, [])

  const onPreRunMessagePatched = useCallback((preRunMessage: string | null) => {
    setPayload((prev) => {
      if (!prev?.run) return prev
      return {
        ...prev,
        run: patchRunDetailPreRunMessage(prev.run, preRunMessage),
      }
    })
  }, [])

  const onStopPatched = useCallback(
    (testingSiteId: number, patch: Partial<MonthlyRunDetailLocationStop>) => {
      setPayload((prev) => {
        if (!prev?.locations?.length) return prev
        return {
          ...prev,
          locations: patchRunDetailLocationStop(
            prev.locations,
            testingSiteId,
            prev.month_date,
            patch,
          ),
        }
      })
    },
    [],
  )

  const onMarkPrepared = useCallback(async () => {
    if (!Number.isFinite(idNum) || !monthOk) return
    if (runLifecycleAction != null) return
    setRunLifecycleAction('prepare')
    try {
      await apiJson<{ run: TechnicianWorksheetRun }>(
        `/api/monthly_routes/routes/${idNum}/runs/prepare`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ month_date: monthQuery }),
        },
      )
      clearWorksheetCache(idNum, monthQuery)
      await loadRunDetails()
    } catch {
      window.alert('Could not mark route prepared. Try again.')
    } finally {
      setRunLifecycleAction(null)
    }
  }, [idNum, monthOk, monthQuery, loadRunDetails, runLifecycleAction])

  const onMarkReviewComplete = useCallback(async () => {
    if (!Number.isFinite(idNum) || !monthOk || !payload?.run) return
    if (runLifecycleAction != null) return
    setRunLifecycleAction('review_complete')
    try {
      await apiJson<{ run: TechnicianWorksheetRun }>(
        `/api/monthly_routes/routes/${idNum}/runs/review_complete`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ month_date: monthQuery }),
        },
      )
      clearWorksheetCache(idNum, monthQuery)
      await loadRunDetails()
    } catch {
      window.alert('Could not mark review complete. Try again.')
    } finally {
      setRunLifecycleAction(null)
    }
  }, [idNum, monthOk, monthQuery, payload?.run, loadRunDetails, runLifecycleAction])

  const onCompleteJob = useCallback(async () => {
    if (!Number.isFinite(idNum) || !monthOk || !payload?.run) return
    if (worksheetRunExplicitlyCompleted(payload.run)) return
    if (runLifecycleAction != null) return
    setRunLifecycleAction('complete')
    try {
      await apiJson<{ run: TechnicianWorksheetRun }>(
        `/api/monthly_routes/routes/${idNum}/runs/complete`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ month_date: monthQuery }),
        },
      )
      clearWorksheetCache(idNum, monthQuery)
      await loadRunDetails()
    } catch {
      window.alert('Could not complete job. Try again.')
    } finally {
      setRunLifecycleAction(null)
    }
  }, [idNum, monthOk, monthQuery, payload?.run, loadRunDetails, runLifecycleAction])

  const onReopenJob = useCallback(async () => {
    if (!Number.isFinite(idNum) || !monthOk || !payload?.run) return
    if (!worksheetRunExplicitlyCompleted(payload.run)) return
    if (runLifecycleAction != null) return
    setRunLifecycleAction('reopen')
    try {
      await apiJson<{ run: TechnicianWorksheetRun }>(
        `/api/monthly_routes/routes/${idNum}/runs/reopen`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ month_date: monthQuery }),
        },
      )
      clearWorksheetCache(idNum, monthQuery)
      await loadRunDetails()
    } catch {
      window.alert('Could not reopen job. Try again.')
    } finally {
      setRunLifecycleAction(null)
    }
  }, [idNum, monthOk, monthQuery, payload?.run, loadRunDetails, runLifecycleAction])

  const onConfirmResetRun = useCallback(async () => {
    if (!Number.isFinite(idNum) || !monthOk || payload?.run == null) return
    if (worksheetRunExplicitlyCompleted(payload.run)) return
    setResetRunBusy(true)
    try {
      const qs = new URLSearchParams({ month: monthQuery })
      await apiJson<{ ok: boolean }>(
        `/api/monthly_routes/routes/${idNum}/worksheet/reset_run?${qs.toString()}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: 'office' }),
        },
      )
      clearWorksheetCache(idNum, monthQuery)
      setResetRunModalOpen(false)
      await loadRunDetails()
    } catch (e) {
      const msg =
        typeof e === 'object' && e != null && 'error' in (e as Record<string, unknown>)
          ? String((e as { error?: unknown }).error)
          : 'Could not reset run.'
      window.alert(msg)
    } finally {
      setResetRunBusy(false)
    }
  }, [idNum, monthOk, monthQuery, payload?.run, loadRunDetails])

  const worksheetTo = `/monthlies/routes/${idNum}/worksheet/${encodeURIComponent(monthQuery)}`
  const routeTo = `/monthlies/routes/${idNum}`

  const runActivity = useMemo(
    () => worksheetOfficeRunActivity(payload?.run ?? null),
    [payload?.run],
  )

  const locations = payload?.locations ?? []
  const prepPhase = runInOfficePrepPhase(payload?.run ?? null)
  const prepSummary = useMemo(() => computeRunDetailsPrepSummary(locations), [locations])

  const focusRunReview = useCallback(
    (nextFilter?: RunReviewFilter) => {
      const filter: RunLocationReviewFilter =
        nextFilter != null ? toLocationFilter(nextFilter) : 'all'
      setReviewFilter(filter)
      const monthDate = payload?.month_date ?? monthQuery
      const matched = filterRunDetailLocations(locations, filter, monthDate)
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      window.requestAnimationFrame(() => {
        document.getElementById('run-review-section')?.scrollIntoView({
          behavior: reduceMotion ? 'auto' : 'smooth',
          block: 'start',
        })
        const first = matched[0]
        if (first) {
          dispatchRunLocationExpand(runLocationReviewDomId(first.location_id))
        }
      })
    },
    [locations, monthQuery, payload?.month_date],
  )

  if (!Number.isFinite(idNum) || !monthOk) {
    return (
      <div className="monthly-route-detail-page">
        <div className="monthly-route-detail-container container py-4">
          <Alert variant="warning">Invalid route or month.</Alert>
          <Link to="/monthlies/routes">Back to Monthly Routes</Link>
        </div>
      </div>
    )
  }

  if (loading) {
    return <MonthlyRunDetailPageSkeleton />
  }

  if (error || !payload) {
    return (
      <div className="monthly-route-detail-page">
        <div className="monthly-route-detail-container container py-4">
          <Alert variant="danger">{error || 'Run not found.'}</Alert>
          <Link to={routeTo}>Back to route</Link>
        </div>
      </div>
    )
  }

  const { route, counts, specialists_month, run } = payload
  const monthHeading = formatMonthHeading(payload.month_date)
  const completedByLabel = completedByTechniciansPillLabel(
    specialists_month?.top_technicians ?? [],
  )
  const runCompleted = worksheetRunExplicitlyCompleted(run)
  const workflowStage = deriveRunWorkflowStage(run)
  const showMarkPrepared = !runCompleted && (run == null || !runIsPrepared(run))
  const showMarkReviewComplete =
    run != null && !runCompleted && runFieldEnded(run) && !run?.office_review_completed_at
  const showCompleteJob = run != null && !runCompleted && canOfficeCompleteRun(run)
  const showReopenJob = run != null && runCompleted
  const showResetRun = run != null && !runCompleted
  const lifecycleBusy = runLifecycleAction != null

  return (
    <div className="monthly-route-detail-page monthly-run-detail-page">
      <div className="monthly-route-detail-container">
        <nav className="monthly-run-detail-breadcrumb" aria-label="Breadcrumb">
          <Link to="/monthlies/routes" className="monthly-location-back-link">
            Monthly Routes
          </Link>
          <span className="monthly-run-detail-breadcrumb__sep" aria-hidden>
            /
          </span>
          <Link to={routeTo} className="monthly-location-back-link">
            {route.label}
          </Link>
        </nav>

        <section className="monthly-route-detail-hero monthly-location-detail-surface monthly-run-detail-hero">
          <div className="monthly-route-detail-hero__copy">
            <div className="monthly-location-detail-eyebrow">Run details</div>
            <h1 className="monthly-location-detail-title">
              {monthHeading}
              <span className="monthly-run-detail-hero__route-ref"> · {route.label}</span>
            </h1>
            <RunWorkflowStepper run={run} className="monthly-run-detail-workflow mb-3" />
            <div className="monthly-route-detail-hero__meta">
              <Badge bg={runActivityVariant(runActivity)} className="monthly-route-pill">
                {runOfficeStatusPillLabel(runActivity, payload.month_date, route, undefined, run)}
              </Badge>
              {run?.source ? (
                <Badge bg="light" text="dark" className="monthly-route-pill">
                  Source: {run.source}
                </Badge>
              ) : null}
              {formatRunTimestamp(run?.started_at) ? (
                <Badge bg="light" text="dark" className="monthly-route-pill">
                  Field started {formatRunTimestamp(run?.started_at)}
                </Badge>
              ) : null}
              {formatRunTimestamp(run?.field_ended_at) ? (
                <Badge bg="light" text="dark" className="monthly-route-pill">
                  Field ended {formatRunTimestamp(run?.field_ended_at)}
                </Badge>
              ) : null}
              {formatRunTimestamp(run?.office_review_completed_at) ? (
                <Badge bg="light" text="dark" className="monthly-route-pill">
                  Review done {formatRunTimestamp(run?.office_review_completed_at)}
                </Badge>
              ) : null}
              {formatRunTimestamp(run?.completed_at) ? (
                <Badge bg="light" text="dark" className="monthly-route-pill">
                  Closed {formatRunTimestamp(run?.completed_at)}
                </Badge>
              ) : null}
            </div>
            {workflowStage === 'awaiting_office_review' ? (
              <p className="small text-muted mb-0 mt-2">
                Technicians finished field work. Set billing and follow-ups in the review section below,
                then mark review complete.
              </p>
            ) : null}
            {run == null ? (
              <p className="small text-muted mb-0 mt-2">
                No run file yet for this month. Review stops below, then mark prepared when technicians may
                start field work.
              </p>
            ) : null}
          </div>
          <div className="monthly-route-detail-hero__right">
            <div className="monthly-route-detail-actions">
              {showMarkPrepared ? (
                <Button
                  size="sm"
                  variant="outline-primary"
                  className="monthly-location-detail-action"
                  disabled={lifecycleBusy}
                  onClick={() => void onMarkPrepared()}
                >
                  {runLifecycleAction === 'prepare' ? (
                    <>
                      <Spinner animation="border" size="sm" className="me-1" aria-hidden />
                      Preparing…
                    </>
                  ) : (
                    'Mark prepared'
                  )}
                </Button>
              ) : null}
              {showMarkReviewComplete ? (
                <Button
                  size="sm"
                  variant="outline-primary"
                  className="monthly-location-detail-action"
                  disabled={lifecycleBusy}
                  onClick={() => void onMarkReviewComplete()}
                >
                  {runLifecycleAction === 'review_complete' ? (
                    <>
                      <Spinner animation="border" size="sm" className="me-1" aria-hidden />
                      Saving…
                    </>
                  ) : (
                    'Mark review complete'
                  )}
                </Button>
              ) : null}
              {showReopenJob ? (
                <Button
                  size="sm"
                  variant="outline-warning"
                  className="monthly-location-detail-action"
                  disabled={lifecycleBusy}
                  onClick={() => void onReopenJob()}
                >
                  {runLifecycleAction === 'reopen' ? (
                    <>
                      <Spinner animation="border" size="sm" className="me-1" aria-hidden />
                      Reopening…
                    </>
                  ) : (
                    'Reopen job'
                  )}
                </Button>
              ) : null}
              {showCompleteJob ? (
                <Button
                  size="sm"
                  variant="success"
                  className="monthly-location-detail-action"
                  disabled={lifecycleBusy}
                  onClick={() => void onCompleteJob()}
                >
                  {runLifecycleAction === 'complete' ? (
                    <>
                      <Spinner animation="border" size="sm" className="me-1" aria-hidden />
                      Completing…
                    </>
                  ) : (
                    'Complete job'
                  )}
                </Button>
              ) : null}
              {showResetRun ? (
                <Button
                  size="sm"
                  variant="outline-danger"
                  className="monthly-location-detail-action"
                  disabled={lifecycleBusy || resetRunBusy}
                  onClick={() => setResetRunModalOpen(true)}
                >
                  Reset run
                </Button>
              ) : null}
              <Link
                to={worksheetTo}
                className="btn btn-outline-primary btn-sm monthly-location-detail-action"
              >
                <i className="bi bi-table" aria-hidden />
                Open technician worksheet
              </Link>
            </div>
            {completedByLabel ? (
              <div
                className="monthly-route-detail-hero__specialists"
                aria-label="ServiceTrade technicians"
              >
                <Badge bg="light" text="dark" className="monthly-route-pill">
                  {completedByLabel}
                </Badge>
              </div>
            ) : null}
          </div>
        </section>

        {prepPhase ? (
          <div className="monthly-run-detail-prep-summary" aria-label="Prep summary">
            <div className="monthly-run-detail-kpi monthly-location-detail-surface">
              <div className="monthly-run-detail-kpi__value tabular-nums">{prepSummary.stopCount}</div>
              <div className="monthly-run-detail-kpi__label">
                {prepSummary.stopCount === 1 ? 'Stop' : 'Stops'}
              </div>
            </div>
            <div className="monthly-run-detail-kpi monthly-location-detail-surface">
              <div className="monthly-run-detail-kpi__value tabular-nums">{prepSummary.locationCount}</div>
              <div className="monthly-run-detail-kpi__label">
                {prepSummary.locationCount === 1 ? 'Location' : 'Locations'}
              </div>
            </div>
            {prepSummary.multiSiteLocationCount > 0 ? (
              <div className="monthly-run-detail-kpi monthly-location-detail-surface">
                <div className="monthly-run-detail-kpi__value tabular-nums">
                  {prepSummary.multiSiteLocationCount}
                </div>
                <div className="monthly-run-detail-kpi__label">Multi-site</div>
              </div>
            ) : null}
            <div className="monthly-run-detail-kpi monthly-location-detail-surface">
              <div className="monthly-run-detail-kpi__value tabular-nums">
                {prepSummary.openDeficiencyCount}
              </div>
              <div className="monthly-run-detail-kpi__label">Open deficiencies</div>
            </div>
          </div>
        ) : (
          <div className="monthly-run-detail-kpis" aria-label="Run outcome counts">
            {(
              [
                {
                  key: 'all_good' as const,
                  count: counts.all_good_count,
                  label: 'All good',
                  modifier: 'all-good',
                },
                {
                  key: 'passed_with_problems' as const,
                  count: counts.passed_with_problems_count,
                  label: 'Passed w/ problems',
                  modifier: 'passed-problems',
                },
                {
                  key: 'failed' as const,
                  count: counts.failed_count,
                  label: 'Failed',
                  modifier: 'failed',
                },
                {
                  key: 'skipped' as const,
                  count: counts.skipped_count,
                  label: 'Skipped',
                  modifier: 'skipped',
                },
              ] as const
            ).map(({ key, count, label, modifier }) =>
              count > 0 ? (
                <button
                  key={key}
                  type="button"
                  className={`monthly-run-detail-kpi monthly-location-detail-surface monthly-run-detail-kpi--interactive monthly-run-detail-kpi--${modifier}`}
                  onClick={() => focusRunReview(key)}
                >
                  <div className="monthly-run-detail-kpi__value tabular-nums">{count}</div>
                  <div className="monthly-run-detail-kpi__label">{label}</div>
                </button>
              ) : (
                <div
                  key={key}
                  className={`monthly-run-detail-kpi monthly-location-detail-surface monthly-run-detail-kpi--${modifier}`}
                >
                  <div className="monthly-run-detail-kpi__value tabular-nums">{count}</div>
                  <div className="monthly-run-detail-kpi__label">{label}</div>
                </div>
              ),
            )}
          </div>
        )}

        {prepPhase ? (
          <RunDetailsPreRunMessageCard
            routeId={idNum}
            monthDate={payload.month_date}
            run={run}
            onPreRunMessagePatched={onPreRunMessagePatched}
          />
        ) : null}

        {locations.length > 0 ? (
          <RunDetailsLocationReviewList
            locations={locations}
            monthDate={payload.month_date}
            routeId={idNum}
            run={run}
            runCompleted={runCompleted}
            reviewSummary={payload.review_summary ?? null}
            filter={reviewFilter}
            onFilterChange={setReviewFilter}
            onBillingPatched={onBillingPatched}
            onStopPatched={onStopPatched}
            onDeficiencyUpdated={loadRunDetails}
          />
        ) : (
          <section id="run-review-section" className="monthly-location-detail-surface p-3">
            <p className="monthly-run-detail-empty mb-0">No worksheet stops for this run yet.</p>
          </section>
        )}
      </div>
      <Modal
        show={resetRunModalOpen}
        onHide={() => {
          if (!resetRunBusy) setResetRunModalOpen(false)
        }}
        centered
        backdrop={resetRunBusy ? 'static' : true}
      >
        <Modal.Header closeButton={!resetRunBusy}>
          <Modal.Title className="h6 mb-0">Reset this run?</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="mb-2">
            This clears everything recorded during this run for this month: tested/skipped outcomes,
            clock events, times, run comments, field edits (panel, annual month, access codes, etc.), billing
            status on each site, and the sites-with-updates change log. Worksheet rows are restored
            from the library master.
          </p>
          <p className="mb-0 small text-muted">
            If the job was marked complete, use <strong>Reopen job</strong> first.
          </p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" size="sm" disabled={resetRunBusy} onClick={() => setResetRunModalOpen(false)}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" disabled={resetRunBusy} onClick={() => void onConfirmResetRun()}>
            {resetRunBusy ? (
              <>
                <Spinner animation="border" size="sm" className="me-1" aria-hidden />
                Resetting…
              </>
            ) : (
              'Yes, reset run'
            )}
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  )
}
