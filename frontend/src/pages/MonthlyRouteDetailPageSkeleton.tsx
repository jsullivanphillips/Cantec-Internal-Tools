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

function RouteDetailAccordionSkeleton() {
  return (
    <div
      className="monthly-route-detail-accordion home-skeleton d-flex flex-column gap-3"
      aria-busy="true"
      aria-label="Loading route sections"
    >
      <SkeletonAccordionSection titleWidth="5.5rem" />
      <SkeletonAccordionSection titleWidth="8.5rem" />
      <SkeletonAccordionSection titleWidth="3.25rem" />
      <SkeletonAccordionSection titleWidth="6.5rem" />
      <SkeletonAccordionSection titleWidth="5.75rem" />
    </div>
  )
}

/** Skeleton layout matching the monthly route detail page (hero, accordion sections). */
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
          <div className="monthly-location-detail-hero-title-row">
            <SkeletonBar width="min(22rem, 92%)" height={28} />
            <div className="monthly-location-detail-hero-actions d-flex flex-wrap gap-2">
              <SkeletonBar width="6.5rem" height={31} className="rounded" />
              <SkeletonBar width="5.75rem" height={31} className="rounded" />
            </div>
          </div>
          <div className="monthly-route-detail-hero-columns">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="monthly-location-detail-hero-column">
                <SkeletonBar width="5.5rem" height={10} className="mb-2" />
                <SkeletonBar width="min(12rem, 100%)" height={12} className="mb-2" />
                <SkeletonBar width="min(10rem, 88%)" height={12} className="mb-2" />
                <SkeletonBar width="min(11rem, 92%)" height={12} />
              </div>
            ))}
          </div>
        </section>

        <RouteDetailAccordionSkeleton />

        <p className="visually-hidden">{label}</p>
      </div>
    </div>
  )
}

export { RouteDetailAccordionSkeleton }
