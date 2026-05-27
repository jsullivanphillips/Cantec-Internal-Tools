import { useEffect, useMemo, useState } from 'react'
import { Card } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import type {
  MonthlyRouteOverviewPayload,
  MonthlyRouteOverviewRow,
} from '../features/monthlyRoutes/monthlyRoutesShared'
import {
  isRoutePlacedOnOverviewCalendar,
  MONTHLY_ROUTE_CALENDAR_WEEK_COUNT,
  MONTHLY_ROUTE_CALENDAR_WEEKDAY_HEADERS,
  routeCalendarCellKey,
} from '../features/monthlyRoutes/monthlyRoutesShared'
import { apiJson, isAbortError } from '../lib/apiClient'

function RouteOverviewCard({ row }: { row: MonthlyRouteOverviewRow }) {
  const { route } = row
  const count = route.location_count
  const countLabel =
    typeof count === 'number'
      ? `${count} active location${count === 1 ? '' : 's'}`
      : null

  return (
    <Link
      to={`/monthlies/routes/${route.id}`}
      className="monthly-routes-overview-calendar__card text-decoration-none"
    >
      <div className="monthly-routes-overview-calendar__card-label fw-semibold">{route.label}</div>
      {countLabel ? (
        <div className="monthly-routes-overview-calendar__card-meta small text-muted">{countLabel}</div>
      ) : null}
    </Link>
  )
}

export default function MonthlyRoutesOverviewPage() {
  const [payload, setPayload] = useState<MonthlyRouteOverviewPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    apiJson<MonthlyRouteOverviewPayload>('/api/monthly_routes/routes', {
      signal: controller.signal,
    })
      .then((data) => {
        if (active) setPayload(data)
      })
      .catch((err) => {
        if (!isAbortError(err) && active) setError('Unable to load route overview.')
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

  const { cellsByKey, unscheduledRows } = useMemo(() => {
    const map = new Map<string, MonthlyRouteOverviewRow[]>()
    const unscheduled: MonthlyRouteOverviewRow[] = []
    for (const row of rows) {
      const key = routeCalendarCellKey(row.route.week_occurrence, row.route.weekday_iso)
      if (!key) {
        unscheduled.push(row)
        continue
      }
      const bucket = map.get(key)
      if (bucket) bucket.push(row)
      else map.set(key, [row])
    }
    for (const bucket of map.values()) {
      bucket.sort((a, b) => a.route.route_number - b.route.route_number)
    }
    unscheduled.sort((a, b) => a.route.route_number - b.route.route_number)
    return { cellsByKey: map, unscheduledRows: unscheduled }
  }, [rows])

  const weekRows = useMemo(
    () => Array.from({ length: MONTHLY_ROUTE_CALENDAR_WEEK_COUNT }, (_, i) => i + 1),
    []
  )

  const hasPlacedRoutes = rows.some((row) => isRoutePlacedOnOverviewCalendar(row.route))

  return (
    <div className="d-flex flex-column gap-3">
      <Card className="app-surface-card">
        <Card.Body className="p-3 p-md-4">
          <h2 className="processing-page-title mb-0">Routes</h2>
        </Card.Body>
      </Card>
      <Card className="app-surface-card">
        <Card.Body className="p-3 p-md-4">
          {error ? <div className="text-danger">{error}</div> : null}
          {loading ? <div className="text-muted">Loading routes...</div> : null}
          {!loading && !error ? (
            rows.length === 0 ? (
              <div className="text-muted">No routes with active locations found.</div>
            ) : (
              <>
                <div
                  className="monthly-routes-overview-calendar"
                  role="grid"
                  aria-label="Monthly routes by week and weekday"
                >
                  <div className="monthly-routes-overview-calendar__header" role="row">
                    <div
                      className="monthly-routes-overview-calendar__corner"
                      role="columnheader"
                      aria-hidden
                    />
                    {MONTHLY_ROUTE_CALENDAR_WEEKDAY_HEADERS.map((day) => (
                      <div
                        key={day}
                        className="monthly-routes-overview-calendar__day-header"
                        role="columnheader"
                      >
                        {day}
                      </div>
                    ))}
                  </div>
                  {weekRows.map((week) => (
                    <div key={week} className="monthly-routes-overview-calendar__week-row" role="row">
                      <div
                        className="monthly-routes-overview-calendar__week-label"
                        role="rowheader"
                      >
                        Week {week}
                      </div>
                      {MONTHLY_ROUTE_CALENDAR_WEEKDAY_HEADERS.map((_, weekdayIso) => {
                        const key = routeCalendarCellKey(week, weekdayIso)
                        const cellRows = key ? (cellsByKey.get(key) ?? []) : []
                        return (
                          <div
                            key={`${week}-${weekdayIso}`}
                            className="monthly-routes-overview-calendar__cell"
                            role="gridcell"
                          >
                            <div className="monthly-routes-overview-calendar__cell-stack">
                              {cellRows.map((row) => (
                                <RouteOverviewCard key={row.route.id} row={row} />
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
                {!hasPlacedRoutes && unscheduledRows.length > 0 ? (
                  <div className="text-muted mt-3">
                    Routes could not be placed on the calendar (invalid week or weekday).
                  </div>
                ) : null}
                {unscheduledRows.length > 0 ? (
                  <div className="monthly-routes-overview-calendar__unscheduled mt-4">
                    <h3 className="h6 text-muted mb-2">Unscheduled</h3>
                    <div className="monthly-routes-overview-calendar__unscheduled-stack d-flex flex-column gap-2">
                      {unscheduledRows.map((row) => (
                        <RouteOverviewCard key={row.route.id} row={row} />
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            )
          ) : null}
        </Card.Body>
      </Card>
    </div>
  )
}
