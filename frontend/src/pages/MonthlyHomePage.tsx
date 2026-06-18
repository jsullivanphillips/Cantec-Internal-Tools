import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Nav, Tab } from 'react-bootstrap'
import {
  buildRouteOverviewCardToneMap,
  countRoutesToPrepare,
  countRoutesToProcess,
  type MonthlyDashboardPayload,
  type MonthlyDashboardRouteRow,
} from '../features/monthlyRoutes/monthlyDashboardShared'
import MonthlyDashboardKpiStrip from '../features/monthlyRoutes/MonthlyDashboardKpiStrip'
import {
  addCalendarMonths,
  formatRouteOverviewMonthHeading,
  monthFirstIsoPacificToday,
} from '../features/monthlyRoutes/monthlyRoutesShared'
import MonthlyRoutesWorkweekCalendar from '../features/monthlyRoutes/MonthlyRoutesWorkweekCalendar'
import BulkStJobReleaseButton from '../features/monthlyRoutes/BulkStJobReleaseButton'
import MonthlyDashboardIssues from '../features/monthlyRoutes/MonthlyDashboardIssues'
import MonthlyDashboardRouteBreakdown from '../features/monthlyRoutes/MonthlyDashboardRouteBreakdown'
import MonthlyDashboardRoutePerformance from '../features/monthlyRoutes/MonthlyDashboardRoutePerformance'
import MonthlyDashboardLocationMetrics from '../features/monthlyRoutes/MonthlyDashboardLocationMetrics'
import MonthlyTicketsQueue from '../features/monthlyRoutes/MonthlyTicketsQueue'
import { apiJson, isAbortError } from '../lib/apiClient'
import { PROCESSING_PAGE_TITLE_COMPACT_CLASS } from '../styles/pageTypography'

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
          className="monthly-routes-overview-calendar__legend-swatch monthly-routes-overview-calendar__card--tone-skipped"
          aria-hidden
        />
        Skipped
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

function dashboardUrl(monthFirstIso?: string): string {
  if (!monthFirstIso) return '/api/monthly_routes/dashboard'
  const qs = new URLSearchParams({ month_date: monthFirstIso })
  return `/api/monthly_routes/dashboard?${qs.toString()}`
}

function RouteOverviewMonthToolbar({
  monthFirstIso,
  onChangeMonth,
}: {
  monthFirstIso: string
  onChangeMonth: (monthFirstIso: string) => void
}) {
  const monthHeading = formatRouteOverviewMonthHeading(monthFirstIso)
  const previousMonth = addCalendarMonths(monthFirstIso, -1)
  const nextMonth = addCalendarMonths(monthFirstIso, 1)

  return (
    <div className="monthly-route-year-toolbar" aria-label="Calendar month selector">
      <Button
        type="button"
        variant="outline-secondary"
        size="sm"
        className="monthly-route-year-toolbar__button"
        disabled={!previousMonth}
        onClick={() => {
          if (previousMonth) onChangeMonth(previousMonth)
        }}
      >
        Previous
      </Button>
      <span className="monthly-route-year-toolbar__year tabular-nums" aria-live="polite">
        {monthHeading}
      </span>
      <Button
        type="button"
        variant="outline-secondary"
        size="sm"
        className="monthly-route-year-toolbar__button"
        disabled={!nextMonth}
        onClick={() => {
          if (nextMonth) onChangeMonth(nextMonth)
        }}
      >
        Next
      </Button>
    </div>
  )
}

export default function MonthlyHomePage() {
  const currentMonthFirstIso = useMemo(() => monthFirstIsoPacificToday(), [])
  const currentMonthHeading = useMemo(
    () => formatRouteOverviewMonthHeading(currentMonthFirstIso),
    [currentMonthFirstIso],
  )

  const [dashboardPayload, setDashboardPayload] = useState<MonthlyDashboardPayload | null>(null)
  const [calendarMonthFirstIso, setCalendarMonthFirstIso] = useState(currentMonthFirstIso)
  const [calendarRows, setCalendarRows] = useState<MonthlyDashboardRouteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [calendarLoading, setCalendarLoading] = useState(false)
  const [calendarError, setCalendarError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    apiJson<MonthlyDashboardPayload>(dashboardUrl(), {
      signal: controller.signal,
    })
      .then((data) => {
        if (!active) return
        setDashboardPayload(data)
        setCalendarMonthFirstIso(data.month_date)
        setCalendarRows(data.routes)
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
  }, [currentMonthFirstIso])

  useEffect(() => {
    if (loading) return

    if (calendarMonthFirstIso === dashboardPayload?.month_date) {
      setCalendarRows(dashboardPayload?.routes ?? [])
      setCalendarError(null)
      return
    }

    let active = true
    const controller = new AbortController()
    setCalendarLoading(true)
    setCalendarError(null)
    apiJson<MonthlyDashboardPayload>(dashboardUrl(calendarMonthFirstIso), {
      signal: controller.signal,
    })
      .then((data) => {
        if (active) setCalendarRows(data.routes)
      })
      .catch((err) => {
        if (!isAbortError(err) && active) {
          setCalendarError('Unable to load routes for this month.')
        }
      })
      .finally(() => {
        if (active) setCalendarLoading(false)
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [calendarMonthFirstIso, dashboardPayload?.month_date, loading])

  const kpiRows = useMemo(() => dashboardPayload?.routes ?? [], [dashboardPayload])
  const routesToProcess = useMemo(() => countRoutesToProcess(kpiRows), [kpiRows])
  const routesToPrepare = useMemo(
    () => countRoutesToPrepare(kpiRows, currentMonthFirstIso),
    [kpiRows, currentMonthFirstIso],
  )
  const cardToneByRouteId = useMemo(() => buildRouteOverviewCardToneMap(calendarRows), [calendarRows])
  const calendarMonthHeading = useMemo(
    () => formatRouteOverviewMonthHeading(calendarMonthFirstIso),
    [calendarMonthFirstIso],
  )
  const openTicketCount = dashboardPayload?.open_ticket_count ?? 0

  const refreshCalendarMonth = useCallback(() => {
    apiJson<MonthlyDashboardPayload>(dashboardUrl(calendarMonthFirstIso))
      .then((data) => setCalendarRows(data.routes))
      .catch(() => {
        /* keep existing rows */
      })
  }, [calendarMonthFirstIso])

  const refreshDashboard = useCallback(() => {
    apiJson<MonthlyDashboardPayload>(dashboardUrl())
      .then((data) => {
        setDashboardPayload(data)
        if (calendarMonthFirstIso === data.month_date) {
          setCalendarRows(data.routes)
        }
      })
      .catch(() => {
        /* keep existing payload */
      })
  }, [calendarMonthFirstIso])

  return (
    <div className="monthlies-dashboard-page d-flex flex-column gap-3">
      <Card className="app-surface-card monthly-hero-card monthlies-dashboard-hero">
        <Card.Body className="monthly-hero-card__body">
          <div className="monthly-hero-card__row">
            <div className="monthlies-dashboard-hero__title-line">
              <h1 className={`${PROCESSING_PAGE_TITLE_COMPACT_CLASS} m-0`}>Monthlies</h1>
              <span className="monthlies-dashboard-hero__month text-muted">{currentMonthHeading}</span>
            </div>
          </div>
          {!loading && !error ? (
            <MonthlyDashboardKpiStrip
              routesToProcess={routesToProcess}
              routesToPrepare={routesToPrepare}
              openTicketCount={openTicketCount}
            />
          ) : null}
        </Card.Body>
      </Card>

      {error ? (
        <Card className="app-surface-card">
          <Card.Body className="p-3 p-md-4">
            <div className="text-danger">{error}</div>
          </Card.Body>
        </Card>
      ) : null}
      {loading ? (
        <Card className="app-surface-card">
          <Card.Body className="p-3 p-md-4">
            <div className="text-muted">Loading dashboard...</div>
          </Card.Body>
        </Card>
      ) : null}
      {!loading && !error ? (
        <Tab.Container defaultActiveKey="routes">
          <div className="processing-tabs-shell app-surface-card">
            <Nav variant="tabs" className="mb-0 processing-tabs processing-tabs-shell__nav">
              <Nav.Item>
                <Nav.Link eventKey="routes">Routes</Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link eventKey="financial-performance">Financial Performance</Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link eventKey="route-performance">Route Performance</Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link eventKey="location-metrics">Location Metrics</Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link eventKey="tickets">Tickets</Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link eventKey="issues">Issues</Nav.Link>
              </Nav.Item>
            </Nav>
            <Tab.Content className="processing-tabs-shell__panel">
              <Tab.Pane eventKey="routes">
                <div className="monthly-dashboard-routes-toolbar mb-3">
                  <div className="monthly-dashboard-routes-toolbar__side" aria-hidden />
                  <RouteOverviewMonthToolbar
                    monthFirstIso={calendarMonthFirstIso}
                    onChangeMonth={setCalendarMonthFirstIso}
                  />
                  <div className="monthly-dashboard-routes-toolbar__side monthly-dashboard-routes-toolbar__side--end">
                    <BulkStJobReleaseButton
                      monthFirstIso={calendarMonthFirstIso}
                      onComplete={refreshCalendarMonth}
                    />
                  </div>
                </div>
                {calendarError ? <div className="text-danger mb-3">{calendarError}</div> : null}
                {calendarLoading ? (
                  <div className="text-muted mb-3">Loading routes for {calendarMonthHeading}...</div>
                ) : null}
                <MonthlyRoutesWorkweekCalendar
                  rows={calendarRows}
                  monthFirstIso={calendarMonthFirstIso}
                  monthHeading={calendarMonthHeading}
                  cardToneByRouteId={cardToneByRouteId}
                  legend={<MonthlyDashboardLegend />}
                />
              </Tab.Pane>
              <Tab.Pane eventKey="financial-performance">
                <MonthlyDashboardRouteBreakdown />
              </Tab.Pane>
              <Tab.Pane eventKey="route-performance">
                <MonthlyDashboardRoutePerformance />
              </Tab.Pane>
              <Tab.Pane eventKey="location-metrics">
                <MonthlyDashboardLocationMetrics />
              </Tab.Pane>
              <Tab.Pane eventKey="tickets">
                <MonthlyTicketsQueue onTicketsChanged={refreshDashboard} />
              </Tab.Pane>
              <Tab.Pane eventKey="issues">
                <MonthlyDashboardIssues />
              </Tab.Pane>
            </Tab.Content>
          </div>
        </Tab.Container>
      ) : null}
    </div>
  )
}
