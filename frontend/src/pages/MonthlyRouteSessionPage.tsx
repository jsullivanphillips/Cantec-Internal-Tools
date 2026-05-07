import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Card, Spinner, Table } from 'react-bootstrap'
import { Link, useParams } from 'react-router-dom'
import {
  parseYearMonth,
  type RouteTestingSessionPayload,
  type RouteTestingSessionStop,
} from '../features/monthlyRoutes/monthlyRoutesShared'
import { apiJson, isAbortError } from '../lib/apiClient'

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

function stopOrderDisplay(stop: RouteTestingSessionStop): string {
  const sess = stop.session_route_stop_order
  if (sess != null && Number.isFinite(sess)) {
    return String(Number(sess) + 1)
  }
  if (stop.route_stop_order != null && Number.isFinite(stop.route_stop_order)) {
    return String(Number(stop.route_stop_order) + 1)
  }
  return '—'
}

function statusBadgeVariant(stop: RouteTestingSessionStop): string {
  const s = (stop.result_status || '').toLowerCase()
  if (s === 'tested') return 'success'
  if (s === 'skipped') {
    const annualish =
      (stop.skip_reason || '').trim().toLowerCase() === 'annual' ||
      (stop.skip_reason || '').toLowerCase().includes('annual_booked')
    return annualish ? 'warning' : 'secondary'
  }
  return 'light'
}

function statusSummaryLabel(stop: RouteTestingSessionStop): string {
  const s = (stop.result_status || '').toLowerCase()
  if (s === 'skipped') {
    const sr = (stop.skip_reason || '').trim().toLowerCase()
    if (sr === 'annual' || sr.includes('annual_booked')) return 'Skipped (annual)'
    return 'Skipped'
  }
  if (s === 'tested') return 'Tested'
  return stop.result_status || '—'
}

export default function MonthlyRouteSessionPage() {
  const { routeId, monthIso } = useParams<{ routeId: string; monthIso: string }>()
  const idNum = routeId ? parseInt(routeId, 10) : NaN

  const monthOk = useMemo(() => {
    const raw = (monthIso || '').trim()
    return MONTH_FIRST_RE.test(raw) && parseYearMonth(raw) != null
  }, [monthIso])

  const monthQuery = useMemo(() => {
    const raw = (monthIso || '').trim()
    return monthOk ? raw : ''
  }, [monthIso, monthOk])

  const [payload, setPayload] = useState<RouteTestingSessionPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!routeId || Number.isNaN(idNum) || !monthOk || !monthQuery) {
        setPayload(null)
        setLoading(false)
        setError(null)
        return
      }
      setLoading(true)
      setError(null)
      try {
        const qs = new URLSearchParams({ month: monthQuery })
        const data = await apiJson<RouteTestingSessionPayload>(
          `/api/monthly_routes/routes/${idNum}/testing_session?${qs.toString()}`,
          { signal }
        )
        if (signal?.aborted) return
        setPayload(data)
      } catch (e) {
        if (isAbortError(e)) return
        const msg =
          typeof e === 'object' && e && 'error' in e ? String((e as { error: unknown }).error) : null
        setError(msg || 'Unable to load session ledger.')
        setPayload(null)
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [routeId, idNum, monthOk, monthQuery]
  )

  useEffect(() => {
    const c = new AbortController()
    void load(c.signal)
    return () => c.abort()
  }, [load])

  const countsLine = useMemo(() => {
    if (!payload?.counts) return null
    const c = payload.counts
    const parts = [
      `${c.sites_tested_count} tested`,
      `${c.skipped_non_annual_count} skipped`,
      `${c.skipped_annual_count} skipped (annual)`,
    ]
    return parts.join(' · ')
  }, [payload])

  const invalidParams =
    !routeId || Number.isNaN(idNum) || !monthIso ? (
      <Alert variant="danger">Missing route or month.</Alert>
    ) : !monthOk ? (
      <Alert variant="danger">
        Month must be a first-of-month key in the URL (example:{' '}
        <code className="user-select-all">2026-04-01</code>).
      </Alert>
    ) : null

  return (
    <div className="container py-4 monthly-route-session-page">
      <div className="d-flex flex-wrap align-items-baseline gap-2 mb-3">
        <Link
          to={Number.isNaN(idNum) ? '/monthlies/routes' : `/monthlies/routes/${idNum}`}
          className="small"
        >
          ← Back to route
        </Link>
        <Link to="/monthlies/routes" className="small text-muted">
          All routes
        </Link>
      </div>

      {invalidParams}

      {loading && !invalidParams ? (
        <div className="d-flex align-items-center gap-2 text-muted py-5 justify-content-center">
          <Spinner animation="border" size="sm" />
          Loading session…
        </div>
      ) : null}

      {!loading && error ? <Alert variant="danger">{error}</Alert> : null}

      {!loading && !error && !invalidParams && payload ? (
        <>
          <Card className="shadow-sm mb-3">
            <Card.Body>
              <h1 className="h4 mb-1">{payload.route.label}</h1>
              <div className="text-muted mb-2">{formatMonthHeading(payload.month_date)}</div>
              {countsLine ? <div className="small">{countsLine}</div> : null}
              {payload.route.display_name ? (
                <div className="small text-muted mt-1">{payload.route.display_name}</div>
              ) : null}
            </Card.Body>
          </Card>

          {payload.stops.length === 0 ? (
            <Alert variant="secondary">No sheet history rows for this month on this route.</Alert>
          ) : (
            <Card className="shadow-sm">
              <Card.Body className="p-0">
                <Table responsive hover size="sm" className="mb-0 align-middle">
                  <thead className="table-light">
                    <tr>
                      <th style={{ width: '3.25rem' }}>#</th>
                      <th
                        style={{ width: '4rem' }}
                        title="Sheet stop # when captured from route CSV import; otherwise current route order when still assigned here"
                      >
                        Stop
                      </th>
                      <th>Address</th>
                      <th style={{ width: '8rem' }}>Status</th>
                      <th>Skip reason</th>
                      <th>Sheet signal</th>
                      <th title="Stored when this month was imported (frozen per month); older imports fall back to current library fields">
                        Testing procedures
                      </th>
                      <th title="Stored when this month was imported (frozen per month); older imports fall back to current library fields">
                        Tech comments & notes
                      </th>
                      <th style={{ width: '5.5rem' }}>Time In</th>
                      <th style={{ width: '5.5rem' }}>Time Out</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payload.stops.map((stop) => (
                      <tr key={`${stop.location_id}-${stop.display_order}`}>
                        <td className="tabular-nums text-muted">{stop.display_order}</td>
                        <td className="tabular-nums">{stopOrderDisplay(stop)}</td>
                        <td>
                          <div className="d-flex flex-wrap align-items-center gap-2">
                            <Link
                              to={`/monthlies/locations/${stop.location_id}`}
                              className="fw-semibold text-break"
                            >
                              {stop.label_address}
                            </Link>
                            {!stop.still_on_route ? (
                              <Badge bg="info" text="dark">
                                Moved
                              </Badge>
                            ) : null}
                          </div>
                          {stop.building ? (
                            <div className="small text-muted text-break">{stop.building}</div>
                          ) : null}
                        </td>
                        <td>
                          <Badge bg={statusBadgeVariant(stop)} text={stop.result_status === 'skipped' ? 'dark' : undefined}>
                            {statusSummaryLabel(stop)}
                          </Badge>
                        </td>
                        <td className="small text-break">
                          {(stop.skip_reason || '').trim() ? stop.skip_reason : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="small text-break font-monospace">
                          {(stop.source_value_raw || '').trim() ? (
                            <div>{stop.source_value_raw}</div>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="small text-break" style={{ whiteSpace: 'pre-wrap', maxWidth: '22rem' }}>
                          {(stop.testing_procedures || '').trim() ? (
                            stop.testing_procedures
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="small text-break" style={{ whiteSpace: 'pre-wrap', maxWidth: '22rem' }}>
                          {(stop.inspection_tech_notes || '').trim() ? (
                            stop.inspection_tech_notes
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="small tabular-nums">{(stop.time_in || '').trim() || <span className="text-muted">—</span>}</td>
                        <td className="small tabular-nums">{(stop.time_out || '').trim() || <span className="text-muted">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Card.Body>
            </Card>
          )}
        </>
      ) : null}
    </div>
  )
}
