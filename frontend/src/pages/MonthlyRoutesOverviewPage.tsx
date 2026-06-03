import { useEffect, useMemo, useState } from 'react'
import { Card } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import type {
  MonthlyRouteOverviewPayload,
  MonthlyRouteOverviewRow,
} from '../features/monthlyRoutes/monthlyRoutesShared'
import {
  buildPacificWorkweekCalendarGrid,
  effectiveRouteTestDayIso,
  formatRouteOverviewMonthHeading,
  monthFirstIsoPacificToday,
  MONTHLY_ROUTE_OVERVIEW_WORKDAY_COLUMN_COUNT,
  MONTHLY_ROUTE_OVERVIEW_WORKDAY_HEADERS,
} from '../features/monthlyRoutes/monthlyRoutesShared'
import { apiJson, isAbortError } from '../lib/apiClient'

type RouteOverviewCardProps = {
  row: MonthlyRouteOverviewRow
  /** When false (calendar cell), only show route number — date is on the cell. */
  showScheduleHint?: boolean
}

function RouteOverviewCard({ row, showScheduleHint = false }: RouteOverviewCardProps) {
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
      <div className="monthly-routes-overview-calendar__card-label fw-semibold">
        R{route.route_number}
        {showScheduleHint ? ` · ${route.label}` : null}
      </div>
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

  const monthFirstIso = useMemo(() => monthFirstIsoPacificToday(), [])
  const monthHeading = useMemo(() => formatRouteOverviewMonthHeading(monthFirstIso), [monthFirstIso])

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

  const { calendarCells, routesByDateIso, unscheduledRows } = useMemo(() => {
    const calendarCells = buildPacificWorkweekCalendarGrid(monthFirstIso)
    const routesByDateIso = new Map<string, MonthlyRouteOverviewRow[]>()
    const unscheduled: MonthlyRouteOverviewRow[] = []

    for (const row of rows) {
      const effectiveIso = effectiveRouteTestDayIso(monthFirstIso, row.route)
      if (!effectiveIso) {
        unscheduled.push(row)
        continue
      }
      const ym = monthFirstIso.slice(0, 7)
      if (!effectiveIso.startsWith(ym)) {
        unscheduled.push(row)
        continue
      }
      const bucket = routesByDateIso.get(effectiveIso)
      if (bucket) bucket.push(row)
      else routesByDateIso.set(effectiveIso, [row])
    }

    for (const bucket of routesByDateIso.values()) {
      bucket.sort((a, b) => a.route.route_number - b.route.route_number)
    }
    unscheduled.sort((a, b) => a.route.route_number - b.route.route_number)

    return { calendarCells, routesByDateIso, unscheduledRows: unscheduled }
  }, [rows, monthFirstIso])

  const weekCount = calendarCells.length / MONTHLY_ROUTE_OVERVIEW_WORKDAY_COLUMN_COUNT

  return (
    <div className="d-flex flex-column gap-3">
      <Card className="app-surface-card">
        <Card.Body className="p-3 p-md-4">
          <h2 className="processing-page-title mb-1">Routes</h2>
          <p className="text-muted mb-0">{monthHeading}</p>
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
                  className="monthly-routes-overview-calendar monthly-routes-overview-calendar--workweek"
                  style={{ gridTemplateRows: `auto repeat(${weekCount}, minmax(5.5rem, auto))` }}
                  role="grid"
                  aria-label={`Monthly routes for ${monthHeading}`}
                >
                  <div className="monthly-routes-overview-calendar__header" role="row">
                    {MONTHLY_ROUTE_OVERVIEW_WORKDAY_HEADERS.map((day) => (
                      <div
                        key={day}
                        className="monthly-routes-overview-calendar__day-header"
                        role="columnheader"
                      >
                        {day}
                      </div>
                    ))}
                  </div>
                  {Array.from({ length: weekCount }, (_, weekIndex) => (
                    <div
                      key={weekIndex}
                      className="monthly-routes-overview-calendar__week-row"
                      role="row"
                    >
                      {calendarCells
                        .slice(
                          weekIndex * MONTHLY_ROUTE_OVERVIEW_WORKDAY_COLUMN_COUNT,
                          weekIndex * MONTHLY_ROUTE_OVERVIEW_WORKDAY_COLUMN_COUNT +
                            MONTHLY_ROUTE_OVERVIEW_WORKDAY_COLUMN_COUNT,
                        )
                        .map((cell, cellIndex) => {
                          if (cell.isPadding) {
                            return (
                              <div
                                key={`pad-${weekIndex}-${cellIndex}`}
                                className="monthly-routes-overview-calendar__cell monthly-routes-overview-calendar__cell--padding"
                                role="gridcell"
                                aria-hidden
                              />
                            )
                          }
                          const cellRows = routesByDateIso.get(cell.iso) ?? []
                          const cellClassNames = [
                            'monthly-routes-overview-calendar__cell',
                            cell.isToday ? 'monthly-routes-overview-calendar__cell--today' : '',
                            cell.isHoliday ? 'monthly-routes-overview-calendar__cell--holiday' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')
                          return (
                            <div
                              key={cell.iso}
                              className={cellClassNames}
                              role="gridcell"
                              aria-label={
                                cell.holidayName
                                  ? `${cell.dayOfMonth}, ${cell.holidayName}`
                                  : String(cell.dayOfMonth)
                              }
                            >
                              <div className="monthly-routes-overview-calendar__cell-day">
                                {cell.dayOfMonth}
                              </div>
                              {cell.isHoliday && cellRows.length === 0 && cell.holidayName ? (
                                <div className="monthly-routes-overview-calendar__holiday-label small text-muted">
                                  {cell.holidayName}
                                </div>
                              ) : null}
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
                {unscheduledRows.length > 0 ? (
                  <div className="monthly-routes-overview-calendar__unscheduled mt-4">
                    <h3 className="h6 text-muted mb-2">Unscheduled this month</h3>
                    <div className="monthly-routes-overview-calendar__unscheduled-stack d-flex flex-column gap-2">
                      {unscheduledRows.map((row) => (
                        <RouteOverviewCard key={row.route.id} row={row} showScheduleHint />
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
