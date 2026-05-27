import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Button, Modal, Spinner, Table } from 'react-bootstrap'
import { Link, useParams } from 'react-router-dom'
import {
  parseYearMonth,
  runOfficeStatusPillLabel,
  worksheetOfficeRunActivity,
  worksheetRunExplicitlyCompleted,
  type MonthlyRunDetailFieldChange,
  type MonthlyRunDetailPayload,
  type MonthlySpecialistTechRow,
  type TechnicianWorksheetRun,
} from '../features/monthlyRoutes/monthlyRoutesShared'
import { clearWorksheetCache } from '../features/monthlyRoutes/worksheetOfflineStore'
import { apiJson, isAbortError } from '../lib/apiClient'

const MONTH_FIRST_RE = /^\d{4}-\d{2}-01$/

const WORKSHEET_FIELD_LABELS: Record<string, string> = {
  result_status: 'Result',
  skip_reason: 'Skip reason',
  testing_procedures: 'Testing procedures',
  inspection_tech_notes: 'Tech notes',
  time_in: 'Time in',
  time_out: 'Time out',
  annual_month: 'Annual month',
  ring: 'Ring',
  key_number: 'Key #',
  facp: 'FACP',
  monitoring: 'Monitoring',
  monitoring_notes: 'Monitoring notes',
  monitoring_company: 'Monitoring company',
  run_comments: 'Run comments',
  panel: 'Panel',
  panel_location: 'Panel location',
  door_code: 'Door code',
  property_management_company: 'Property management',
  building_name: 'Building',
}

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

function worksheetFieldLabel(fieldName: string): string {
  return WORKSHEET_FIELD_LABELS[fieldName] || fieldName.replace(/_/g, ' ')
}

function formatAuditValue(value: unknown): string {
  if (value == null) return '—'
  if (typeof value === 'string') {
    const s = value.trim()
    return s || '—'
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function formatChangedBy(row: MonthlyRunDetailFieldChange): string {
  const name = (row.changed_by_name || row.changed_by_username || '').trim()
  return name || '—'
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

function locationCommentLabel(displayAddress: string, building: string | null): string {
  const addr = displayAddress.trim()
  const b = (building || '').trim()
  if (addr && b) return `${addr} · ${b}`
  return addr || b || '—'
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
    return (
      <div className="d-flex justify-content-center align-items-center py-5">
        <Spinner animation="border" role="status">
          <span className="visually-hidden">Loading…</span>
        </Spinner>
      </div>
    )
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

  const { route, counts, specialists_month, run_comments, field_changes, run } = payload
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

        <section className="monthly-run-detail-section monthly-location-detail-surface">
          <h2 className="monthly-run-detail-section__title">Run comments</h2>
          {run_comments.length > 0 ? (
            <Table size="sm" className="monthly-run-detail-table mb-0" responsive>
              <thead>
                <tr>
                  <th>Location</th>
                  <th>Comment</th>
                </tr>
              </thead>
              <tbody>
                {run_comments.map((row) => (
                  <tr key={`${row.location_id}:${row.testing_site_id}`}>
                    <td className="monthly-run-detail-table__location">
                      {locationCommentLabel(row.display_address, row.building)}
                    </td>
                    <td>{row.run_comments}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <p className="monthly-run-detail-empty mb-0">No run comments recorded for this month.</p>
          )}
        </section>

        <section className="monthly-run-detail-section monthly-location-detail-surface">
          <h2 className="monthly-run-detail-section__title">Field changes</h2>
          <p className="monthly-run-detail-section__meta small text-muted mb-2">
            Worksheet edits logged in the audit trail. CSV snapshot imports may not appear here.
          </p>
          {field_changes.length > 0 ? (
            <Table size="sm" className="monthly-run-detail-table mb-0" responsive>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Location</th>
                  <th>Field</th>
                  <th>Change</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {field_changes.map((row) => (
                  <tr key={row.id}>
                    <td className="monthly-run-detail-table__when text-nowrap">
                      {formatRunTimestamp(row.changed_at) ?? '—'}
                    </td>
                    <td className="monthly-run-detail-table__location">{row.location_label}</td>
                    <td>{worksheetFieldLabel(row.field_name)}</td>
                    <td className="monthly-run-detail-table__change">
                      <span className="text-muted">{formatAuditValue(row.old_value)}</span>
                      <span className="monthly-run-detail-table__arrow" aria-hidden>
                        →
                      </span>
                      <span>{formatAuditValue(row.new_value)}</span>
                    </td>
                    <td>{formatChangedBy(row)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <p className="monthly-run-detail-empty mb-0">No field changes recorded for this run.</p>
          )}
        </section>
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
