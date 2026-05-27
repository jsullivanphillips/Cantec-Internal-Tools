import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Card, Modal, Spinner } from 'react-bootstrap'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  parseYearMonth,
  worksheetRunExplicitlyCompleted,
  type TechnicianWorksheetRun,
} from '../features/monthlyRoutes/monthlyRoutesShared'
import { apiJson } from '../lib/apiClient'

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
  current_month_first: string
  current_month_run: TechnicianWorksheetRun | null
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
  if (run.opened_at) {
    const d = new Date(run.opened_at)
    if (!Number.isNaN(d.getTime())) {
      parts.push(`File opened ${d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`)
    }
  }
  if (run.started_at) {
    const d = new Date(run.started_at)
    if (!Number.isNaN(d.getTime())) {
      parts.push(`Field started ${d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`)
    }
  }
  if (run.completed_at) {
    const d = new Date(run.completed_at)
    if (!Number.isNaN(d.getTime())) {
      parts.push(`Ended ${d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`)
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
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [regenerateError, setRegenerateError] = useState<string | null>(null)
  const [regenerateNotice, setRegenerateNotice] = useState<string | null>(null)
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

  const openWorksheetForMonth = useCallback(
    (monthFirstIso: string, fromPriorRun = false) => {
      nav(`/tech/route/${idNum}/worksheet/${encodeURIComponent(monthFirstIso)}`, {
        state: fromPriorRun ? { fromPriorRun: true } : undefined,
      })
    },
    [idNum, nav],
  )

  const regeneratePaperwork = useCallback(async () => {
    if (Number.isNaN(idNum)) return
    setRegenerateError(null)
    setRegenerateNotice(null)
    setRegenerating(true)
    try {
      const body = await apiJson<{
        ok: boolean
        stops_created: number
        stops_refreshed: number
      }>(`/api/technician_portal/routes/${idNum}/regenerate_paperwork`, { method: 'POST' })
      const total = (body.stops_created ?? 0) + (body.stops_refreshed ?? 0)
      setRegenerateNotice(
        total > 0
          ? `Paperwork refreshed for ${total} ${total === 1 ? 'stop' : 'stops'}. Open the worksheet to review.`
          : 'Paperwork is up to date.',
      )
      setShowRegenerateConfirm(false)
      await load()
    } catch (e) {
      const maybe = e as { code?: string; message?: string }
      if (maybe?.code === 'run_completed') {
        setRegenerateError('This month’s run is completed. Ask the office to reopen it first.')
      } else if (maybe?.code === 'portal_locked') {
        nav('/tech', { replace: true })
      } else {
        setRegenerateError('Could not refresh paperwork. Try again.')
      }
    } finally {
      setRegenerating(false)
    }
  }, [idNum, load, nav])

  const monthLabel = data ? formatMonthHeading(data.current_month_first) : ''
  const canRegeneratePaperwork =
    data != null && !worksheetRunExplicitlyCompleted(data.current_month_run)

  return (
    <div className="container py-4" style={{ maxWidth: '40rem' }}>
      <div className="mb-3">
        <Link to="/tech/start" className="btn btn-link text-primary px-0 mb-2">
          ← Back to routes
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

          {regenerateNotice ? (
            <Alert variant="success" className="mb-3" onClose={() => setRegenerateNotice(null)} dismissible>
              {regenerateNotice}
            </Alert>
          ) : null}
          {regenerateError ? (
            <Alert variant="danger" className="mb-3" onClose={() => setRegenerateError(null)} dismissible>
              {regenerateError}
            </Alert>
          ) : null}

          {data.current_month_run == null ? (
            <Card className="shadow-sm border-primary mb-4">
              <Card.Body className="py-4">
                <div className="fw-semibold mb-2">This month</div>
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
                {canRegeneratePaperwork ? (
                  <Button
                    variant="outline-secondary"
                    className="w-100 mt-2"
                    type="button"
                    disabled={regenerating}
                    onClick={() => setShowRegenerateConfirm(true)}
                  >
                    Refresh paperwork from office data
                  </Button>
                ) : null}
              </Card.Body>
            </Card>
          ) : (
            <Card className="shadow-sm border-primary mb-4">
              <Card.Body className="py-4">
                <div className="fw-semibold mb-2">This month</div>
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
                {canRegeneratePaperwork ? (
                  <Button
                    variant="outline-secondary"
                    className="w-100 mt-2"
                    type="button"
                    disabled={regenerating}
                    onClick={() => setShowRegenerateConfirm(true)}
                  >
                    Refresh paperwork from office data
                  </Button>
                ) : null}
              </Card.Body>
            </Card>
          )}

          <Modal show={showRegenerateConfirm} onHide={() => setShowRegenerateConfirm(false)} centered>
            <Modal.Header closeButton>
              <Modal.Title>Refresh paperwork?</Modal.Title>
            </Modal.Header>
            <Modal.Body>
              <p className="mb-2">
                This reloads testing procedures, tech notes, panel info, and other sheet fields for {monthLabel} from
                the latest office and prior-run data.
              </p>
              <p className="mb-0 text-muted small">
                Times, tested/skipped results, and run comments you already entered are kept. To clear field progress,
                use <strong>Reset run</strong> on the worksheet.
              </p>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" type="button" onClick={() => setShowRegenerateConfirm(false)}>
                Cancel
              </Button>
              <Button variant="primary" type="button" disabled={regenerating} onClick={() => void regeneratePaperwork()}>
                {regenerating ? (
                  <>
                    <Spinner animation="border" size="sm" className="me-2" /> Refreshing…
                  </>
                ) : (
                  'Refresh paperwork'
                )}
              </Button>
            </Modal.Footer>
          </Modal>

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
