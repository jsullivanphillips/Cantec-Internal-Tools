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

function SkeletonHeroColumn({ lineWidths }: { lineWidths: string[] }) {
  return (
    <div className="monthly-location-detail-hero-column">
      <SkeletonBar width="4.75rem" height={10} className="mb-2" />
      {lineWidths.map((width, index) => (
        <SkeletonBar
          key={index}
          width={width}
          height={12}
          className={index > 0 ? 'mt-2' : undefined}
        />
      ))}
    </div>
  )
}

function SkeletonAccordionSection({ titleWidth }: { titleWidth: string }) {
  return (
    <section className="monthly-location-detail-section monthly-location-detail-surface">
      <div className="monthly-location-detail-section-header px-3 py-3">
        <SkeletonBar width={titleWidth} height={14} />
      </div>
    </section>
  )
}

/** Skeleton layout matching the monthly location detail page. */
export default function MonthlyLocationDetailPageSkeleton({
  label = 'Loading location',
}: {
  label?: string
}) {
  return (
    <div
      className="monthly-location-detail-page home-skeleton"
      aria-busy="true"
      aria-label={label}
    >
      <div className="monthly-location-detail-container">
        <SkeletonBar width="8.5rem" height={14} />

        <section className="monthly-location-detail-hero monthly-location-detail-surface">
          <div className="monthly-location-detail-hero-title-row">
            <div className="monthly-location-detail-hero-title-group d-flex flex-wrap align-items-center gap-2">
              <SkeletonBar width="min(22rem, 92%)" height={28} />
              <SkeletonBar width="4.75rem" height={22} className="rounded-pill" />
              <SkeletonBar width="5.75rem" height={22} className="rounded-pill" />
              <SkeletonBar width="5.25rem" height={22} className="rounded-pill" />
            </div>
            <SkeletonBar width="5.75rem" height={31} className="rounded" />
          </div>

          <div className="monthly-location-detail-hero-columns">
            <SkeletonHeroColumn lineWidths={['88%', '76%', '64%']} />
            <SkeletonHeroColumn lineWidths={['72%', '58%']} />
            <SkeletonHeroColumn lineWidths={['54%', '68%', '62%']} />
            <SkeletonHeroColumn lineWidths={['48%', '52%']} />
          </div>

          <div className="monthly-location-detail-hero-tags">
            <div className="d-flex flex-wrap align-items-center gap-2">
              <SkeletonBar width="3.5rem" height={22} className="rounded-pill" />
              <SkeletonBar width="4.25rem" height={22} className="rounded-pill" />
            </div>
          </div>
        </section>

        <section className="monthly-location-detail-surface monthly-location-st-link-panel p-3">
          <SkeletonBar width="5.5rem" height={10} className="mb-2" />
          <SkeletonBar width="10rem" height={14} className="mb-3" />
          <SkeletonBar width="min(18rem, 100%)" height={12} />
        </section>

        <div className="monthly-location-detail-body">
          <div className="monthly-location-detail-accordion d-flex flex-column gap-3" aria-hidden>
            <SkeletonAccordionSection titleWidth="7.5rem" />
            <SkeletonAccordionSection titleWidth="3.75rem" />
            <SkeletonAccordionSection titleWidth="7rem" />
            <SkeletonAccordionSection titleWidth="5.5rem" />
          </div>
        </div>

        <p className="visually-hidden">{label}</p>
      </div>
    </div>
  )
}
