import { useCallback, useEffect, useMemo, useState } from 'react'
import { Accordion, Alert, Badge, Button, Modal, Spinner } from 'react-bootstrap'
import { Link, useParams } from 'react-router-dom'
import OfficeWorksheetReadOnlyTable from '../features/monthlyRoutes/OfficeWorksheetReadOnlyTable'
import type { OfficeFieldChange } from '../features/monthlyRoutes/officeWorksheetTableShared'
import {
  parseYearMonth,
  runOfficeStatusPillLabel,
  worksheetOfficeRunActivity,
  worksheetRunExplicitlyCompleted,
  type MonthlyRunDetailPayload,
  type MonthlySpecialistTechRow,
  type TechnicianWorksheetRun,
} from '../features/monthlyRoutes/monthlyRoutesShared'
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

export default function MonthlyRunDetailPage() {
  const { routeId, monthIso } = useParams<{ routeId: string; monthIso: string }>()
  const idNum = routeId ? parseInt(routeId, 10) : NaN
  const monthQuery = (monthIso || '').trim()
  const monthOk = MONTH_FIRST_RE.test(monthQuery) && parseYearMonth(monthQuery) != null

  const [payload, setPayload] = useState<MonthlyRunDetailPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** Which lifecycle action is in flight; keeps loading label on the clicked button only. */
  const [runLifecycleAction, setRunLifecycleAction] = useState<'complete' | 'reopen' | null>(null)
  const [resetRunModalOpen, setResetRunModalOpen] = useState(false)
  const [resetRunBusy, setResetRunBusy] = useState(false)

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

  const fieldChangesByLocation = useMemo(() => {
    const map = new Map<number, OfficeFieldChange[]>()
    for (const loc of payload?.field_changes_by_location ?? []) {
      map.set(loc.location_id, loc.changes)
    }
    return map
  }, [payload?.field_changes_by_location])

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

  const { route, counts, specialists_month, notable_stops, run } = payload
  const notableStopCount = notable_stops.length
  const monthHeading = formatMonthHeading(payload.month_date)
  const completedByLabel = completedByTechniciansPillLabel(
    specialists_month?.top_technicians ?? [],
  )
  const runCompleted = worksheetRunExplicitlyCompleted(run)
  const showCompleteJob = run != null && !runCompleted
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
            <div className="monthly-route-detail-hero__meta">
              <Badge bg={runActivityVariant(runActivity)} className="monthly-route-pill">
                {runOfficeStatusPillLabel(runActivity, payload.month_date, route)}
              </Badge>
              {run?.source ? (
                <Badge bg="light" text="dark" className="monthly-route-pill">
                  Source: {run.source}
                </Badge>
              ) : null}
              {formatRunTimestamp(run?.started_at) ? (
                <Badge bg="light" text="dark" className="monthly-route-pill">
                  Started {formatRunTimestamp(run?.started_at)}
                </Badge>
              ) : null}
              {formatRunTimestamp(run?.completed_at) ? (
                <Badge bg="light" text="dark" className="monthly-route-pill">
                  Completed {formatRunTimestamp(run?.completed_at)}
                </Badge>
              ) : null}
            </div>
          </div>
          <div className="monthly-route-detail-hero__right">
            <div className="monthly-route-detail-actions">
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

        <div className="monthly-run-detail-kpis" aria-label="Run outcome counts">
          <div className="monthly-run-detail-kpi monthly-location-detail-surface">
            <div className="monthly-run-detail-kpi__value tabular-nums">{counts.sites_tested_count}</div>
            <div className="monthly-run-detail-kpi__label">Tested</div>
          </div>
          <div className="monthly-run-detail-kpi monthly-location-detail-surface">
            <div className="monthly-run-detail-kpi__value tabular-nums">
              {counts.skipped_non_annual_count}
            </div>
            <div className="monthly-run-detail-kpi__label">Skipped</div>
          </div>
          <div className="monthly-run-detail-kpi monthly-location-detail-surface">
            <div className="monthly-run-detail-kpi__value tabular-nums">{counts.skipped_annual_count}</div>
            <div className="monthly-run-detail-kpi__label">Annuals</div>
          </div>
        </div>

        <Accordion
          defaultActiveKey="notable-worksheet"
          className="monthly-run-detail-notable-accordion"
        >
          <Accordion.Item eventKey="notable-worksheet" className="monthly-location-detail-surface border-0">
            <Accordion.Header>
              <span className="monthly-run-detail-notable-accordion__title">Sites with updates</span>
              <span className="monthly-run-detail-notable-accordion__meta text-muted small ms-2">
                {notableStopCount === 1 ? '1 stop' : `${notableStopCount} stops`}
              </span>
            </Accordion.Header>
            <Accordion.Body className="p-0 pt-2">
              {notableStopCount > 0 ? (
                <div className="technician-worksheet-page monthly-run-detail-notable-worksheet">
                  <div className="tw-office-dashboard tw-office-dashboard--embedded">
                    <OfficeWorksheetReadOnlyTable
                      stops={notable_stops}
                      monthDate={payload.month_date}
                      fieldChangesByLocation={fieldChangesByLocation}
                      layout="embedded"
                      neutralStopNumbers
                      highlightUpdatedCells
                      hideEmptyChangeColumns
                    />
                  </div>
                </div>
              ) : (
                <p className="monthly-run-detail-empty mb-0 px-3 pb-3">
                  No skipped stops or property updates for this run.
                </p>
              )}
            </Accordion.Body>
          </Accordion.Item>
        </Accordion>
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
            This clears tested/skipped outcomes, time in/out, and run comments for this month.
            Annual skips are preserved. Site notes and panel details are not cleared.
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
