import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Card, Spinner } from 'react-bootstrap'
import { Link, useNavigate, useParams } from 'react-router-dom'
import RunWorkflowStepper from '../features/monthlyRoutes/RunWorkflowStepper'
import PortalBlockingOverlay from '../features/monthlyRoutes/PortalBlockingOverlay'
import {
  parseYearMonth,
  worksheetRunExplicitlyCompleted,
  type TechnicianWorksheetRun,
} from '../features/monthlyRoutes/monthlyRoutesShared'
import { runFieldEnded } from '../features/monthlyRoutes/runWorkflowShared'
import { apiJson } from '../lib/apiClient'
import { fetchRouteKeyAudit, type RouteKeyAuditPayload } from '../features/keys/keysAdminShared'

type PortalRoute = {
  id: number
  route_number: number
  display_name: string | null
  weekday_iso: number
  week_occurrence: number
  label: string
  location_count: number
}

type PortalRouteSummaryResponse = {
  route: PortalRoute
  calendar_month_first: string
  current_month_first: string
  current_month_run: TechnicianWorksheetRun | null
  awaiting_office_prepare: boolean
  prior_runs: TechnicianWorksheetRun[]
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

function formatRunSubtitle(run: TechnicianWorksheetRun): string {
  const parts: string[] = []
  if (run.status === 'completed') parts.push('Completed')
  else parts.push('Open')
  if (run.started_at) {
    const d = new Date(run.started_at)
    if (!Number.isNaN(d.getTime())) {
      parts.push(`Field started ${d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`)
    }
  }
  if (run.field_ended_at) {
    const d = new Date(run.field_ended_at)
    if (!Number.isNaN(d.getTime())) {
      parts.push(`Field ended ${d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`)
    }
  }
  if (run.completed_at) {
    const d = new Date(run.completed_at)
    if (!Number.isNaN(d.getTime())) {
      parts.push(`Closed ${d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`)
    }
  }
  return parts.join(' · ')
}

export default function TechnicianPortalRoutePage() {
  const { routeId } = useParams<{ routeId: string }>()
  const nav = useNavigate()
  const idNum = routeId ? parseInt(routeId, 10) : NaN

  const [data, setData] = useState<PortalRouteSummaryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [runLifecycleBusy, setRunLifecycleBusy] = useState(false)
  const [runLifecycleMessage, setRunLifecycleMessage] = useState('Updating run…')
  const [keyAudit, setKeyAudit] = useState<RouteKeyAuditPayload | null>(null)
  const load = useCallback(async () => {
    if (Number.isNaN(idNum)) {
      setLoading(false)
      setError('Invalid route.')
      return
    }
    setError(null)
    setLoading(true)
    try {
      const payload = await apiJson<PortalRouteSummaryResponse>(
        `/api/technician_portal/routes/${idNum}/portal_route_summary`,
      )
      setData(payload)
    } catch (e) {
      const maybe = e as { code?: string }
      if (maybe?.code === 'portal_locked') {
        nav('/tech', { replace: true })
        return
      }
      if (maybe?.code === 'not_found') {
        setError('Route not found.')
      } else {
        setError('Unable to load route.')
      }
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [idNum, nav])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (Number.isNaN(idNum)) return
    void fetchRouteKeyAudit(idNum)
      .then(setKeyAudit)
      .catch(() => setKeyAudit(null))
  }, [idNum])

  const openWorksheetForMonth = useCallback(
    (monthFirstIso: string, fromPriorRun = false) => {
      nav(`/tech/route/${idNum}/worksheet/${encodeURIComponent(monthFirstIso)}`, {
        state: fromPriorRun ? { fromPriorRun: true } : undefined,
      })
    },
    [idNum, nav],
  )

  const monthLabel = data ? formatMonthHeading(data.current_month_first) : ''
  const primaryIsPromotedFuture =
    data != null && data.current_month_first > data.calendar_month_first
  const primarySectionTitle = primaryIsPromotedFuture ? monthLabel : 'This month'

  const endFieldRun = useCallback(async () => {
    if (Number.isNaN(idNum)) return
    setRunLifecycleMessage('Ending field run…')
    setRunLifecycleBusy(true)
    try {
      const body = await apiJson<{ run: TechnicianWorksheetRun }>(
        `/api/technician_portal/routes/${idNum}/runs/end`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        },
      )
      setData((prev) => (prev ? { ...prev, current_month_run: body.run } : prev))
    } catch {
      window.alert('Could not end run. Try again.')
    } finally {
      setRunLifecycleBusy(false)
    }
  }, [idNum])

  const reopenFieldRun = useCallback(async () => {
    if (Number.isNaN(idNum)) return
    setRunLifecycleMessage('Reopening run…')
    setRunLifecycleBusy(true)
    try {
      const body = await apiJson<{ run: TechnicianWorksheetRun }>(
        `/api/technician_portal/routes/${idNum}/runs/reopen_field`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        },
      )
      setData((prev) => (prev ? { ...prev, current_month_run: body.run } : prev))
    } catch {
      window.alert('Could not reopen run. Try again.')
    } finally {
      setRunLifecycleBusy(false)
    }
  }, [idNum])

  const currentRun = data?.current_month_run ?? null
  const primaryIsCalendarMonth =
    data != null && data.current_month_first === data.calendar_month_first
  const showEndRun =
    primaryIsCalendarMonth &&
    currentRun != null &&
    (currentRun.started_at || '').trim().length > 0 &&
    !runFieldEnded(currentRun) &&
    !worksheetRunExplicitlyCompleted(currentRun)
  const showReopenField =
    primaryIsCalendarMonth &&
    currentRun != null &&
    runFieldEnded(currentRun) &&
    !worksheetRunExplicitlyCompleted(currentRun)

  return (
    <div className="container py-4" style={{ maxWidth: '40rem' }}>
      <PortalBlockingOverlay show={runLifecycleBusy} message={runLifecycleMessage} />
      <div className="mb-3">
        <Link to="/tech/home" className="portal-flow-back d-inline-block mb-2">
          ← Back to home
        </Link>
        {loading ? (
          <div className="d-flex align-items-center gap-2 text-muted py-2">
            <Spinner size="sm" animation="border" /> Loading…
          </div>
        ) : null}
        {error ? <Alert variant="danger">{error}</Alert> : null}
      </div>

      {!loading && data ? (
        <>
          <div className="mb-4">
            <h1 className="h4 mb-1">{data.route.label}</h1>
            <div className="small text-muted">
              {data.route.location_count} {data.route.location_count === 1 ? 'stop' : 'stops'}
              {data.route.display_name ? ` · ${data.route.display_name}` : ''}
            </div>
          </div>

          {keyAudit != null && keyAudit.counts.issues > 0 ? (
            <Alert variant="warning" className="small mb-4">
              <strong>Key bag check:</strong> {keyAudit.counts.issues} issue
              {keyAudit.counts.issues === 1 ? '' : 's'} before you start —{' '}
              {keyAudit.counts.unlinked > 0 ? `${keyAudit.counts.unlinked} unlinked` : null}
              {keyAudit.counts.unlinked > 0 && keyAudit.counts.unavailable > 0 ? ', ' : null}
              {keyAudit.counts.unavailable > 0 ? `${keyAudit.counts.unavailable} unavailable` : null}
              {(keyAudit.counts.wrong_route > 0 || keyAudit.counts.missing_from_bag > 0) &&
              (keyAudit.counts.unlinked > 0 || keyAudit.counts.unavailable > 0)
                ? ', '
                : null}
              {keyAudit.counts.wrong_route > 0 ? `${keyAudit.counts.wrong_route} wrong route` : null}
              {keyAudit.counts.wrong_route > 0 && keyAudit.counts.missing_from_bag > 0 ? ', ' : null}
              {keyAudit.counts.missing_from_bag > 0
                ? `${keyAudit.counts.missing_from_bag} missing from bag`
                : null}
              . Ask the office to fix before signing out {keyAudit.bag_code}.
            </Alert>
          ) : null}

          {data.awaiting_office_prepare ? (
            <Card className="shadow-sm border-primary mb-4">
              <Card.Body className="py-4">
                <div className="fw-semibold mb-2">{primarySectionTitle}</div>
                <p className="text-muted small mb-0">
                  The office is still preparing the run for {monthLabel}. Check back once it has been released.
                </p>
              </Card.Body>
            </Card>
          ) : data.current_month_run == null ? (
            <Card className="shadow-sm border-primary mb-4">
              <Card.Body className="py-4">
                <div className="fw-semibold mb-2">{primarySectionTitle}</div>
                <p className="text-muted small mb-3">
                  No run file exists for {monthLabel} yet. Open the worksheet to review stops, then start the run from
                  the worksheet when you are ready. Other techs on the same route will join that run.
                </p>
                <Button
                  variant="primary"
                  size="lg"
                  className="w-100"
                  type="button"
                  onClick={() => openWorksheetForMonth(data.current_month_first)}
                >
                  Open worksheet for {monthLabel}
                </Button>
              </Card.Body>
            </Card>
          ) : (
            <Card className="shadow-sm border-primary mb-4">
              <Card.Body className="py-4">
                <div className="fw-semibold mb-1">{primarySectionTitle}</div>
                {primaryIsPromotedFuture ? (
                  <p className="text-muted small mb-3">
                    Field run starts {monthLabel}. You can review stops now; starting the run unlocks on that date.
                  </p>
                ) : null}
                <RunWorkflowStepper run={data.current_month_run} className="mb-3" />
                <Button
                  variant="primary"
                  size="lg"
                  className="w-100 text-start"
                  as="button"
                  type="button"
                  onClick={() => openWorksheetForMonth(data.current_month_run!.month_date)}
                >
                  <div>Open run for {monthLabel}</div>
                  <div className="small fw-normal opacity-75">{formatRunSubtitle(data.current_month_run)}</div>
                </Button>
                {(data.current_month_run.pre_run_message ?? '').trim().length > 0 ? (
                  <Alert variant="info" className="mt-3 mb-0 small tw-portal-pre-run-message">
                    <div className="fw-semibold mb-1">Note from office</div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>
                      {(data.current_month_run.pre_run_message ?? '').trim()}
                    </div>
                  </Alert>
                ) : null}
                {showEndRun ? (
                  <Button
                    variant="outline-success"
                    className="w-100 mt-2"
                    type="button"
                    disabled={runLifecycleBusy}
                    onClick={() => void endFieldRun()}
                  >
                    End field run
                  </Button>
                ) : null}
                {showReopenField ? (
                  <Button
                    variant="outline-warning"
                    className="w-100 mt-2"
                    type="button"
                    disabled={runLifecycleBusy}
                    onClick={() => void reopenFieldRun()}
                  >
                    Reopen run
                  </Button>
                ) : null}
              </Card.Body>
            </Card>
          )}

          <div className="fw-semibold mb-2">Previous runs</div>
          {data.prior_runs.length === 0 ? (
            <div className="text-muted small py-2">No earlier runs on file.</div>
          ) : (
            <div className="d-grid gap-2">
              {data.prior_runs.map((run) => (
                <Card
                  key={run.id}
                  as="button"
                  type="button"
                  className="text-start shadow-sm border-0 tw-portal-route-card"
                  onClick={() => openWorksheetForMonth(run.month_date, true)}
                >
                  <Card.Body className="d-flex align-items-center justify-content-between gap-3 py-3">
                    <div>
                      <div className="fw-semibold">{formatMonthHeading(run.month_date)}</div>
                      <div className="small text-muted">{formatRunSubtitle(run)}</div>
                    </div>
                    <i className="bi bi-chevron-right text-muted" aria-hidden />
                  </Card.Body>
                </Card>
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  )
}
