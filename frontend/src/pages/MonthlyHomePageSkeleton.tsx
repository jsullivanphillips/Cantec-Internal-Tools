import { MONTHLY_ROUTE_OVERVIEW_WORKDAY_HEADERS } from '../features/monthlyRoutes/monthlyRoutesShared'

const TAB_SKELETON_WIDTHS = ['3.5rem', '8.5rem', '6.5rem', '7rem', '4.25rem', '3.75rem'] as const
const CALENDAR_SKELETON_WEEK_COUNT = 5

function SkeletonBar({
  width,
  height = 14,
  className = 'd-block',
  borderRadius,
}: {
  width: string
  height?: number | string
  className?: string
  borderRadius?: number | string
}) {
  return (
    <span
      className={`home-skeleton-bar ${className}`.trim()}
      style={{ width, height, borderRadius }}
      aria-hidden
    />
  )
}

export function MonthlyDashboardKpiStripSkeleton() {
  return (
    <div
      className="monthly-dashboard-kpi-strip home-skeleton"
      aria-busy="true"
      aria-label="Loading monthlies summary"
    >
      {(['process', 'prepare', 'tickets'] as const).map((tone) => (
        <div key={tone} className={`monthly-dashboard-kpi monthly-dashboard-kpi--${tone}`}>
          <div className="monthly-dashboard-kpi__text">
            <SkeletonBar width="4.5rem" height={11} />
            <SkeletonBar width="9.5rem" height={10} className="d-block mt-1" />
          </div>
          <SkeletonBar width="1.75rem" height={22} className="d-block" />
        </div>
      ))}
    </div>
  )
}

export function MonthlyRoutesCalendarSkeleton({
  weekCount = CALENDAR_SKELETON_WEEK_COUNT,
}: {
  weekCount?: number
}) {
  return (
    <div
      className="home-skeleton monthly-routes-overview-calendar monthly-routes-overview-calendar--workweek"
      style={{ gridTemplateRows: `auto repeat(${weekCount}, minmax(5.5rem, auto))` }}
      aria-busy="true"
      aria-label="Loading routes calendar"
    >
      <div className="monthly-routes-overview-calendar__header" aria-hidden>
        {MONTHLY_ROUTE_OVERVIEW_WORKDAY_HEADERS.map((day) => (
          <div key={day} className="monthly-routes-overview-calendar__day-header">
            {day}
          </div>
        ))}
      </div>
      {Array.from({ length: weekCount }, (_, weekIndex) => (
        <div key={weekIndex} className="monthly-routes-overview-calendar__week-row" aria-hidden>
          {MONTHLY_ROUTE_OVERVIEW_WORKDAY_HEADERS.map((day, cellIndex) => (
            <div key={`${weekIndex}-${day}`} className="monthly-routes-overview-calendar__cell">
              <SkeletonBar width="1rem" height={12} className="d-block mb-2" />
              {(weekIndex + cellIndex) % 3 === 0 ? (
                <SkeletonBar width="100%" height={44} borderRadius={8} />
              ) : null}
              {(weekIndex + cellIndex) % 4 === 1 ? (
                <SkeletonBar width="88%" height={44} borderRadius={8} className="d-block mt-2" />
              ) : null}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function MonthlyDashboardLegendSkeleton() {
  return (
    <div
      className="monthly-routes-overview-calendar__legend small d-flex flex-wrap gap-3 mt-3 home-skeleton"
      aria-hidden
    >
      {Array.from({ length: 6 }, (_, index) => (
        <span key={index} className="monthly-routes-overview-calendar__legend-item d-flex align-items-center gap-2">
          <SkeletonBar width="0.75rem" height={12} borderRadius={3} className="d-inline-block" />
          <SkeletonBar width={`${3.5 + (index % 2)}rem`} height={10} className="d-inline-block" />
        </span>
      ))}
    </div>
  )
}

export function MonthlyDashboardTabsSkeleton() {
  return (
    <div className="processing-tabs-shell app-surface-card home-skeleton" aria-busy="true" aria-label="Loading dashboard">
      <div className="processing-tabs-shell__nav nav nav-tabs mb-0 processing-tabs" aria-hidden>
        {TAB_SKELETON_WIDTHS.map((width, index) => (
          <div key={index} className="nav-item px-2 py-2">
            <SkeletonBar width={width} height={14} className="d-inline-block" />
          </div>
        ))}
      </div>
      <div className="processing-tabs-shell__panel tab-content">
        <div className="monthly-dashboard-routes-toolbar mb-3" aria-hidden>
          <div className="monthly-dashboard-routes-toolbar__side" />
          <SkeletonBar width="8rem" height={31} borderRadius={9999} className="mx-auto" />
          <div className="monthly-dashboard-routes-toolbar__side monthly-dashboard-routes-toolbar__side--end">
            <SkeletonBar width="6.5rem" height={31} borderRadius={9999} />
          </div>
        </div>
        <MonthlyRoutesCalendarSkeleton />
        <MonthlyDashboardLegendSkeleton />
      </div>
    </div>
  )
}
