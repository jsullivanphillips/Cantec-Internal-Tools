import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import type { RouteOverviewCardTone, MonthlyDashboardRouteRow } from './monthlyDashboardShared'
import ServiceTradeJobStatusDot from './ServiceTradeJobStatusDot'
import { routeNumberDisplayLabel } from './technicianDemoRoute'
import {
  buildPacificWorkweekCalendarGrid,
  effectiveRouteTestDayIso,
  formatRouteOverviewMonthHeading,
  formatRouteTestDayLabel,
  MONTHLY_ROUTE_OVERVIEW_WORKDAY_COLUMN_COUNT,
  MONTHLY_ROUTE_OVERVIEW_WORKDAY_HEADERS,
  routeDisplayLabel,
} from './monthlyRoutesShared'

type RouteOverviewCardProps = {
  row: MonthlyDashboardRouteRow
  monthFirstIso: string
  /** When false (calendar cell), only show route number — date is on the cell. */
  showScheduleHint?: boolean
  tone?: RouteOverviewCardTone
}

function routeOverviewCardClassName(tone?: RouteOverviewCardTone): string {
  const classes = ['monthly-routes-overview-calendar__card']
  if (tone) {
    classes.push(`monthly-routes-overview-calendar__card--tone-${tone}`)
  }
  return classes.join(' ')
}

function formatRouteOverviewCardMeta(route: MonthlyDashboardRouteRow['route']): string | null {
  const count = route.location_count
  if (typeof count !== 'number') return null
  const annualCount = route.annual_count ?? 0
  const locationLabel = `${count} active location${count === 1 ? '' : 's'}`
  const annualLabel = `${annualCount} annual${annualCount === 1 ? '' : 's'}`
  return `${locationLabel} · ${annualLabel}`
}

function RouteOverviewCard({
  row,
  monthFirstIso,
  showScheduleHint = false,
  tone,
}: RouteOverviewCardProps) {
  const { route, service_trade_job_dot, st_schedule_mismatch } = row
  const countLabel = formatRouteOverviewCardMeta(route)
  const routeLabel = routeNumberDisplayLabel(route.route_number)
  const monthHeading = formatRouteOverviewMonthHeading(monthFirstIso)
  const mismatchTooltip = st_schedule_mismatch
    ? `Route ${formatRouteTestDayLabel(st_schedule_mismatch.route_date)} · ServiceTrade appointment ${formatRouteTestDayLabel(st_schedule_mismatch.appointment_date)}`
    : undefined

  return (
    <div className={routeOverviewCardClassName(tone)}>
      <div className="monthly-routes-overview-calendar__card-header">
        <Link
          to={`/monthlies/routes/${route.id}`}
          className="monthly-routes-overview-calendar__card-main text-decoration-none"
        >
          <div className="monthly-routes-overview-calendar__card-label fw-semibold">
            {routeLabel}
            {showScheduleHint ? ` · ${routeDisplayLabel(route)}` : null}
          </div>
          {st_schedule_mismatch ? (
            <span
              className="monthly-routes-overview-calendar__schedule-mismatch-pill badge rounded-pill"
              title={mismatchTooltip}
            >
              Date mismatch
            </span>
          ) : null}
          {countLabel ? (
            <div className="monthly-routes-overview-calendar__card-meta small text-muted">
              {countLabel}
            </div>
          ) : null}
        </Link>
        <div className="monthly-routes-overview-calendar__card-actions">
          <Link
            to={`/monthlies/routes/${route.id}/paperwork?month=${encodeURIComponent(monthFirstIso)}`}
            className="monthly-routes-overview-calendar__paperwork-btn"
            title="Open paperwork"
            aria-label={`Open paperwork for ${routeLabel}, ${monthHeading}`}
          >
            <i className="bi bi-folder2-open" aria-hidden />
          </Link>
          <ServiceTradeJobStatusDot
            dot={service_trade_job_dot}
            className="monthly-routes-overview-calendar__st-dot-wrap"
          />
        </div>
      </div>
    </div>
  )
}

export type MonthlyRoutesWorkweekCalendarProps = {
  rows: MonthlyDashboardRouteRow[]
  monthFirstIso: string
  monthHeading: string
  cardToneByRouteId?: Map<number, RouteOverviewCardTone>
  legend?: React.ReactNode
}

export default function MonthlyRoutesWorkweekCalendar({
  rows,
  monthFirstIso,
  monthHeading,
  cardToneByRouteId,
  legend,
}: MonthlyRoutesWorkweekCalendarProps) {
  const { calendarCells, routesByDateIso, unscheduledRows } = useMemo(() => {
    const calendarCells = buildPacificWorkweekCalendarGrid(monthFirstIso)
    const routesByDateIso = new Map<string, MonthlyDashboardRouteRow[]>()
    const unscheduled: MonthlyDashboardRouteRow[] = []

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

  if (rows.length === 0) {
    return <div className="text-muted">No routes with active locations found.</div>
  }

  return (
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
                        <RouteOverviewCard
                          key={row.route.id}
                          row={row}
                          monthFirstIso={monthFirstIso}
                          tone={cardToneByRouteId?.get(row.route.id)}
                        />
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
              <RouteOverviewCard
                key={row.route.id}
                row={row}
                monthFirstIso={monthFirstIso}
                showScheduleHint
                tone={cardToneByRouteId?.get(row.route.id)}
              />
            ))}
          </div>
        </div>
      ) : null}
      {legend ? <div className="mt-3">{legend}</div> : null}
    </>
  )
}
