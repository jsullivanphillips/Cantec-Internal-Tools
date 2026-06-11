import { useEffect, useMemo, useState } from 'react'
import { Card, Col, Row } from 'react-bootstrap'
import {
  buildRouteOverviewCardToneMap,
  countRoutesToPrepare,
  countRoutesToProcess,
  type MonthlyDashboardPayload,
} from '../features/monthlyRoutes/monthlyDashboardShared'
import {
  formatRouteOverviewMonthHeading,
  monthFirstIsoPacificToday,
} from '../features/monthlyRoutes/monthlyRoutesShared'
import MonthlyRoutesWorkweekCalendar from '../features/monthlyRoutes/MonthlyRoutesWorkweekCalendar'
import { apiJson, isAbortError } from '../lib/apiClient'

function MonthlyDashboardLegend() {
  return (
    <div className="monthly-routes-overview-calendar__legend small text-muted d-flex flex-wrap gap-3">
      <span className="monthly-routes-overview-calendar__legend-item">
        <span
          className="monthly-routes-overview-calendar__legend-swatch monthly-routes-overview-calendar__card--tone-reviewed-closed"
          aria-hidden
        />
        Reviewed &amp; closed
      </span>
      <span className="monthly-routes-overview-calendar__legend-item">
        <span
          className="monthly-routes-overview-calendar__legend-swatch monthly-routes-overview-calendar__card--tone-completed-light"
          aria-hidden
        />
        Completed
      </span>
      <span className="monthly-routes-overview-calendar__legend-item">
        <span
          className="monthly-routes-overview-calendar__legend-swatch monthly-routes-overview-calendar__card--tone-prepared"
          aria-hidden
        />
        Prepared
      </span>
      <span className="monthly-routes-overview-calendar__legend-item">
        <span
          className="monthly-routes-overview-calendar__legend-swatch monthly-routes-overview-calendar__card--tone-field_active"
          aria-hidden
        />
        Active
      </span>
      <span className="monthly-routes-overview-calendar__legend-item">
        <span
          className="monthly-routes-overview-calendar__legend-swatch monthly-routes-overview-calendar__card--tone-neutral"
          aria-hidden
        />
        Other
      </span>
    </div>
  )
}

export default function MonthlyHomePage() {
  const [payload, setPayload] = useState<MonthlyDashboardPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const monthFirstIso = useMemo(() => monthFirstIsoPacificToday(), [])
  const monthHeading = useMemo(() => formatRouteOverviewMonthHeading(monthFirstIso), [monthFirstIso])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    apiJson<MonthlyDashboardPayload>('/api/monthly_routes/dashboard', {
      signal: controller.signal,
    })
      .then((data) => {
        if (active) setPayload(data)
      })
      .catch((err) => {
        if (!isAbortError(err) && active) setError('Unable to load monthlies dashboard.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [])

  const rows = useMemo(() => payload?.routes ?? [], [payload])
  const routesToProcess = useMemo(() => countRoutesToProcess(rows), [rows])
  const routesToPrepare = useMemo(
    () => countRoutesToPrepare(rows, monthFirstIso),
    [rows, monthFirstIso],
  )
  const cardToneByRouteId = useMemo(() => buildRouteOverviewCardToneMap(rows), [rows])

  return (
    <div className="d-flex flex-column gap-3">
      <Card className="app-surface-card">
        <Card.Body className="p-3 p-md-4">
          <h2 className="processing-page-title mb-1">Monthlies</h2>
          <p className="text-muted mb-0">{monthHeading}</p>
        </Card.Body>
      </Card>

      <Card className="app-surface-card">
        <Card.Body className="p-3 p-md-4">
          {error ? <div className="text-danger mb-3">{error}</div> : null}
          {loading ? <div className="text-muted">Loading dashboard...</div> : null}
          {!loading && !error ? (
            <>
              <Row className="g-3 mb-4">
                <Col xs={12} md={4}>
                  <Card className="app-kpi-nested processing-tile h-100">
                    <Card.Body>
                      <div className="text-muted small mb-1">Routes with runs to be processed</div>
                      <div className="fs-3 fw-semibold">{routesToProcess}</div>
                      <div className="small text-muted mt-1">
                        Field ended, awaiting office review
                      </div>
                    </Card.Body>
                  </Card>
                </Col>
                <Col xs={12} md={4}>
                  <Card className="app-kpi-nested processing-tile h-100">
                    <Card.Body>
                      <div className="text-muted small mb-1">Runs to be prepared</div>
                      <div className="fs-3 fw-semibold">{routesToPrepare}</div>
                      <div className="small text-muted mt-1">
                        Scheduled this month, not yet prepared
                      </div>
                    </Card.Body>
                  </Card>
                </Col>
                <Col xs={12} md={4}>
                  <Card className="app-kpi-nested processing-tile h-100">
                    <Card.Body>
                      <div className="text-muted small mb-1">Open tickets</div>
                      <div className="fs-3 fw-semibold">—</div>
                      <div className="small text-muted mt-1">Coming soon</div>
                    </Card.Body>
                  </Card>
                </Col>
              </Row>

              <h3 className="h5 mb-3">All routes</h3>
              <MonthlyRoutesWorkweekCalendar
                rows={rows}
                monthFirstIso={monthFirstIso}
                monthHeading={monthHeading}
                cardToneByRouteId={cardToneByRouteId}
                legend={<MonthlyDashboardLegend />}
              />
            </>
          ) : null}
        </Card.Body>
      </Card>
    </div>
  )
}
