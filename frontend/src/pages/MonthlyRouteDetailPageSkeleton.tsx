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

function SkeletonAccordionSection({ titleWidth }: { titleWidth: string }) {
  return (
    <section className="monthly-location-testing-history-card monthly-route-detail-section monthly-location-detail-surface">
      <div className="monthly-location-testing-history-card-header px-3 py-3">
        <div className="monthly-route-section-header" aria-hidden>
          <span className="monthly-route-section-icon">
            <SkeletonBar width="0.85rem" height={14} className="mx-auto" />
          </span>
          <span className="monthly-route-section-copy d-flex flex-column gap-1">
            <SkeletonBar width={titleWidth} height={14} />
            <SkeletonBar width="min(16rem, 88%)" height={11} />
          </span>
          <SkeletonBar width="2.75rem" height={14} />
        </div>
      </div>
    </section>
  )
}

/** Skeleton layout matching the monthly route detail page (hero, metrics, accordion sections). */
export default function MonthlyRouteDetailPageSkeleton({
  label = 'Loading route details',
}: {
  label?: string
}) {
  return (
    <div
      className="monthly-route-detail-page home-skeleton"
      aria-busy="true"
      aria-label={label}
    >
      <div className="monthly-route-detail-container">
        <SkeletonBar width="5.5rem" height={14} />

        <section className="monthly-route-detail-hero monthly-location-detail-hero monthly-location-detail-surface">
          <div className="monthly-location-detail-hero-main">
            <div className="monthly-location-hero-topline d-flex align-items-center gap-2 mb-2">
              <SkeletonBar width="6.5rem" height={11} />
              <SkeletonBar width="2.25rem" height={11} />
            </div>
            <SkeletonBar width="min(22rem, 92%)" height={28} className="mb-3" />
            <div className="d-flex flex-wrap gap-2">
              <SkeletonBar width="6.5rem" height={22} className="rounded-pill" />
              <SkeletonBar width="5.75rem" height={22} className="rounded-pill" />
              <SkeletonBar width="5.25rem" height={22} className="rounded-pill" />
            </div>
          </div>
          <div className="monthly-location-hero-actions d-flex flex-wrap gap-2">
            <SkeletonBar width="6.75rem" height={31} className="rounded" />
            <SkeletonBar width="6.5rem" height={31} className="rounded" />
            <SkeletonBar width="7.25rem" height={31} className="rounded" />
          </div>
        </section>

        <div className="monthly-route-metric-grid" aria-hidden>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="monthly-route-metric-card">
              <SkeletonBar width="4.5rem" height={10} />
              <SkeletonBar width="3.25rem" height={18} className="mt-2" />
            </div>
          ))}
        </div>

        <div className="monthly-route-detail-accordion d-flex flex-column gap-3" aria-hidden>
          <SkeletonAccordionSection titleWidth="5.5rem" />
          <SkeletonAccordionSection titleWidth="8.5rem" />
          <SkeletonAccordionSection titleWidth="3.25rem" />
          <SkeletonAccordionSection titleWidth="6.5rem" />
          <SkeletonAccordionSection titleWidth="5.75rem" />
        </div>

        <p className="visually-hidden">{label}</p>
      </div>
    </div>
  )
}
