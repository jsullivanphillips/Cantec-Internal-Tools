/** Skeleton layout matching the portal worksheet chrome, sidenav, and detail pane. */

type PortalWorksheetSkeletonProps = {
  /** When true, only the detail column is skeletonized (cached chrome + nav stay visible). */
  detailOnly?: boolean
}

function SkeletonBar({ width, height = 14 }: { width: string; height?: number }) {
  return (
    <span
      className="home-skeleton-bar d-block"
      style={{ width, height, borderRadius: 4 }}
      aria-hidden
    />
  )
}

function NavPillSkeletons({ count = 10 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className="home-skeleton-bar pw-skeleton-nav-pill"
          aria-hidden
        />
      ))}
    </>
  )
}

function DetailSkeleton() {
  return (
    <div className="pw-skeleton-detail home-skeleton" aria-hidden>
      <div className="pw-skeleton-header-band">
        <SkeletonBar width="5rem" height={12} />
        <SkeletonBar width="72%" height={22} />
        <SkeletonBar width="45%" height={14} />
      </div>
      <div className="pw-skeleton-fields">
        {['Access', 'Panel', 'Monitoring', 'Test sheet'].map((title) => (
          <div key={title} className="pw-skeleton-field-group">
            <SkeletonBar width="4.5rem" height={11} />
            <SkeletonBar width="100%" height={14} />
            <SkeletonBar width="85%" height={14} />
            <SkeletonBar width="60%" height={14} />
          </div>
        ))}
      </div>
      <div className="pw-skeleton-dock">
        {Array.from({ length: 5 }, (_, i) => (
          <span key={i} className="home-skeleton-bar pw-skeleton-dock-btn" aria-hidden />
        ))}
      </div>
    </div>
  )
}

export default function PortalWorksheetSkeleton({ detailOnly = false }: PortalWorksheetSkeletonProps) {
  if (detailOnly) {
    return (
      <div className="pw-mock-shell pw-skeleton-shell--detail-only home-skeleton">
        <DetailSkeleton />
      </div>
    )
  }

  return (
    <div
      className="portal-worksheet-mockup home-skeleton"
      aria-busy="true"
      aria-label="Loading worksheet"
    >
      <header className="pw-mock-chrome">
        <div className="pw-mock-chrome-top">
          <SkeletonBar width="1.5rem" height={24} />
          <div className="pw-mock-chrome-titles flex-grow-1">
            <SkeletonBar width="min(12rem, 55%)" height={18} />
            <SkeletonBar width="min(10rem, 40%)" height={12} />
          </div>
          <SkeletonBar width="4rem" height={22} />
        </div>
        <div className="pw-mock-chrome-meta">
          <SkeletonBar width="min(14rem, 70%)" height={12} />
          <SkeletonBar width="5.5rem" height={28} />
        </div>
      </header>

      <div className="pw-mock-body">
        <aside className="pw-mock-sidenav pw-mock-sidenav--collapsed">
          <div className="pw-mock-sidenav-list">
            <NavPillSkeletons count={12} />
          </div>
          <span className="home-skeleton-bar pw-skeleton-sidenav-toggle" aria-hidden />
        </aside>
        <div className="pw-mock-shell">
          <DetailSkeleton />
        </div>
      </div>
    </div>
  )
}
