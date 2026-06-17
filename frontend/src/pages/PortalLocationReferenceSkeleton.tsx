/** Skeleton layout matching the technician portal location reference page. */

function SkeletonBar({
  width,
  height = 14,
  className = '',
  borderRadius = 4,
}: {
  width: string
  height?: number
  className?: string
  borderRadius?: number | string
}) {
  return (
    <span
      className={`home-skeleton-bar d-block ${className}`.trim()}
      style={{ width, height, borderRadius }}
      aria-hidden
    />
  )
}

function SectionSkeleton({ rows }: { rows: string[] }) {
  return (
    <section className="portal-location-ref-section" aria-hidden>
      <SkeletonBar width="5.5rem" height={11} className="mb-3" />
      {rows.map((valueWidth, index) => (
        <div key={index} className="portal-location-ref-skeleton-row">
          <SkeletonBar width="4.25rem" height={10} />
          <SkeletonBar width={valueWidth} height={14} />
        </div>
      ))}
    </section>
  )
}

export default function PortalLocationReferenceSkeleton() {
  return (
    <div
      className="portal-worksheet-mockup portal-location-ref-page home-skeleton"
      aria-busy="true"
      aria-label="Loading location"
    >
      <header className="pw-mock-chrome">
        <div className="pw-mock-chrome-top">
          <div className="pw-mock-chrome-start">
            <SkeletonBar width="1.35rem" height={22} className="rounded-circle flex-shrink-0" />
            <div className="pw-mock-chrome-titles">
              <SkeletonBar width="min(14rem, 72%)" height={18} />
            </div>
          </div>
        </div>
      </header>

      <div className="portal-location-ref-scroll">
        <div className="portal-location-ref-panel">
          <section className="portal-location-ref-hero" aria-hidden>
            <div className="portal-location-ref-hero__header">
              <SkeletonBar width="5.5rem" height={12} />
              <SkeletonBar width="3.75rem" height={18} borderRadius={999} />
            </div>
            <SkeletonBar width="88%" height={20} />
            <SkeletonBar width="62%" height={20} className="mt-2" />
            <SkeletonBar width="100%" height={50} borderRadius={10} className="mt-3" />
          </section>

          <div className="portal-location-ref-annual" aria-hidden>
            <SkeletonBar width="9rem" height={14} />
          </div>

          <SectionSkeleton rows={['72%', '48%']} />
          <SectionSkeleton rows={['64%', '56%']} />
          <SectionSkeleton rows={['78%', '52%', '44%']} />

          <section className="portal-location-ref-section" aria-hidden>
            <SkeletonBar width="8.5rem" height={11} className="mb-3" />
            <SkeletonBar width="100%" height={12} />
            <SkeletonBar width="96%" height={12} className="mt-2" />
            <SkeletonBar width="88%" height={12} className="mt-2" />
            <SkeletonBar width="72%" height={12} className="mt-2" />
          </section>

          <section className="portal-location-ref-servicetrade-card" aria-hidden>
            <SkeletonBar width="100%" height={50} borderRadius={10} />
          </section>
        </div>
      </div>
    </div>
  )
}
