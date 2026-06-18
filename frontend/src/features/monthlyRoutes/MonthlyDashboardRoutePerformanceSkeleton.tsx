const SKELETON_ROW_COUNT = 10

function SkeletonBar({
  width,
  height = 14,
  className = '',
}: {
  width: string
  height?: number
  className?: string
}) {
  return (
    <span
      className={`home-skeleton-bar d-block ${className}`.trim()}
      style={{ width, height }}
      aria-hidden
    />
  )
}

const ROW_CELL_WIDTHS = [
  ['72%', '48%'],
  ['55%'],
  ['50%'],
  ['55%'],
  ['52%'],
  ['45%'],
  ['40%'],
  ['55%'],
  ['65%'],
  ['65%'],
] as const

function TableSkeleton() {
  return (
    <div className="monthly-dashboard-breakdown__card">
      <div className="monthly-dashboard-breakdown-skeleton__table monthly-dashboard-breakdown-skeleton__table--health" aria-hidden>
        <div className="monthly-dashboard-breakdown-skeleton__head">
          {Array.from({ length: 10 }, (_, i) => (
            <SkeletonBar key={i} width={`${58 + (i % 3) * 8}%`} height={11} />
          ))}
        </div>
        {Array.from({ length: SKELETON_ROW_COUNT }, (_, rowIndex) => (
          <div key={rowIndex} className="monthly-dashboard-breakdown-skeleton__row">
            {ROW_CELL_WIDTHS.map((widths, colIndex) => (
              <div
                key={colIndex}
                className={
                  colIndex === 0
                    ? 'monthly-dashboard-breakdown-skeleton__route-cell'
                    : colIndex >= 8
                      ? 'monthly-dashboard-breakdown-skeleton__money-cell'
                      : undefined
                }
              >
                {widths.map((w, i) => (
                  <SkeletonBar
                    key={i}
                    width={w}
                    height={colIndex === 0 && i === 0 ? 14 : 12}
                    className={i > 0 ? 'mt-1' : undefined}
                  />
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function MonthlyDashboardRoutePerformanceSkeleton({
  embedded = false,
}: {
  embedded?: boolean
}) {
  const content = <TableSkeleton />

  if (embedded) {
    return (
      <div className="home-skeleton" aria-busy="true" aria-label="Loading route health scorecard">
        {content}
      </div>
    )
  }

  return (
    <section
      className="monthly-dashboard-breakdown monthly-route-health home-skeleton"
      aria-busy="true"
      aria-label="Loading route health"
    >
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
        <div className="d-flex align-items-center gap-2">
          <SkeletonBar width="14rem" height={20} />
          <SkeletonBar width="1.125rem" height={18} className="rounded-circle" />
        </div>
        <SkeletonBar width="5.75rem" height={31} className="rounded" />
      </div>
      {content}
    </section>
  )
}
