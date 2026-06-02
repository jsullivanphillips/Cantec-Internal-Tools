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

/** Skeleton layout matching run details (hero, KPIs, notable worksheet accordion). */
export default function MonthlyRunDetailPageSkeleton({
  label = 'Loading run details',
}: {
  label?: string
}) {
  return (
    <div
      className="monthly-route-detail-page monthly-run-detail-page home-skeleton"
      aria-busy="true"
      aria-label={label}
    >
      <div className="monthly-route-detail-container">
        <nav className="monthly-run-detail-breadcrumb" aria-hidden>
          <SkeletonBar width="7.5rem" height={14} />
          <span className="monthly-run-detail-breadcrumb__sep">/</span>
          <SkeletonBar width="5rem" height={14} />
        </nav>

        <p className="monthly-run-detail-loading-label text-muted small mb-0">{label}</p>

        <section className="monthly-route-detail-hero monthly-location-detail-surface monthly-run-detail-hero">
          <div className="monthly-route-detail-hero__copy">
            <SkeletonBar width="5.5rem" height={11} className="mb-2" />
            <SkeletonBar width="min(18rem, 85%)" height={28} className="mb-3" />
            <div className="d-flex flex-wrap gap-2">
              <SkeletonBar width="4.5rem" height={22} className="rounded-pill" />
              <SkeletonBar width="5.5rem" height={22} className="rounded-pill" />
            </div>
          </div>
          <div className="monthly-route-detail-hero__right">
            <div className="monthly-route-detail-actions d-flex flex-wrap gap-2">
              <SkeletonBar width="6.5rem" height={31} className="rounded" />
              <SkeletonBar width="9.5rem" height={31} className="rounded" />
            </div>
          </div>
        </section>

        <div className="monthly-run-detail-kpis" aria-hidden>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="monthly-run-detail-kpi monthly-location-detail-surface">
              <SkeletonBar width="2.5rem" height={26} className="mx-auto" />
              <SkeletonBar width="4rem" height={11} className="mx-auto mt-2" />
            </div>
          ))}
        </div>

        <section className="monthly-location-detail-surface monthly-run-detail-notable-accordion-skeleton p-3">
          <SkeletonBar width="9rem" height={16} className="mb-3" />
          <SkeletonBar width="100%" height={88} className="rounded mb-2" />
          <SkeletonBar width="100%" height={88} className="rounded" />
        </section>
      </div>
    </div>
  )
}
