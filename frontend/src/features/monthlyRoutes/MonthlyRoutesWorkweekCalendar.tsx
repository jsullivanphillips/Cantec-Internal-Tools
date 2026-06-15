import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import type { MonthlyRouteOverviewRow } from './monthlyRoutesShared'
import type { RouteOverviewCardTone } from './monthlyDashboardShared'
import { routeNumberDisplayLabel } from './technicianDemoRoute'
import {
  buildPacificWorkweekCalendarGrid,
  effectiveRouteTestDayIso,
  MONTHLY_ROUTE_OVERVIEW_WORKDAY_COLUMN_COUNT,
  MONTHLY_ROUTE_OVERVIEW_WORKDAY_HEADERS,
} from './monthlyRoutesShared'

type RouteOverviewCardProps = {
  row: MonthlyRouteOverviewRow
  /** When false (calendar cell), only show route number — date is on the cell. */
  showScheduleHint?: boolean
  tone?: RouteOverviewCardTone
}

function routeOverviewCardClassName(tone?: RouteOverviewCardTone): string {
  const classes = ['monthly-routes-overview-calendar__card', 'text-decoration-none']
  if (tone) {
    classes.push(`monthly-routes-overview-calendar__card--tone-${tone}`)
  }
  return classes.join(' ')
}

function formatRouteOverviewCardMeta(route: MonthlyRouteOverviewRow['route']): string | null {
  const count = route.location_count
  if (typeof count !== 'number') return null
  const annualCount = route.annual_count ?? 0
  const locationLabel = `${count} active location${count === 1 ? '' : 's'}`
  const annualLabel = `${annualCount} annual${annualCount === 1 ? '' : 's'}`
  return `${locationLabel} · ${annualLabel}`
}

function RouteOverviewCard({ row, showScheduleHint = false, tone }: RouteOverviewCardProps) {
  const { route } = row
  const countLabel = formatRouteOverviewCardMeta(route)

  return (
    <Link
      to={`/monthlies/routes/${route.id}`}
      className={routeOverviewCardClassName(tone)}
    >
      <div className="monthly-routes-overview-calendar__card-label fw-semibold">
        {routeNumberDisplayLabel(route.route_number)}
        {showScheduleHint ? ` · ${route.label}` : null}
      </div>
      {countLabel ? (
        <div className="monthly-routes-overview-calendar__card-meta small text-muted">{countLabel}</div>
      ) : null}
    </Link>
  )
}

export type MonthlyRoutesWorkweekCalendarProps = {
  rows: MonthlyRouteOverviewRow[]
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
