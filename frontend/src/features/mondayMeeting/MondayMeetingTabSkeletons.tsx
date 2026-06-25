import { Card, Col, Row } from 'react-bootstrap'

const MONDAY_MEETING_TAB_SKELETON_WIDTHS = ['5.5rem', '5.25rem', '4.25rem', '8.5rem'] as const

function SkeletonBar({
  width = '100%',
  height = 14,
  className = 'd-block',
  borderRadius,
}: {
  width?: string
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

function ProcessingKpiTileSkeleton({ hero = false }: { hero?: boolean }) {
  return (
    <Card className={`app-kpi-nested processing-tile h-100 ${hero ? 'processing-tile--hero' : ''}`}>
      <Card.Body className="processing-kpi-card-body p-3">
        <div className="processing-kpi-grid">
          <SkeletonBar width={hero ? 'min(52%, 14rem)' : '70%'} />
          <SkeletonBar
            width={hero ? 'min(28%, 8rem)' : '45%'}
            height={hero ? '2.75rem' : '1.5rem'}
            className="d-block mt-1"
            borderRadius="0.5rem"
          />
          <div className="processing-kpi-skeleton-dual pt-1">
            <SkeletonBar width="100%" height="2.5rem" borderRadius="0.35rem" />
            <SkeletonBar width="100%" height="2.5rem" borderRadius="0.35rem" className="d-block mt-1" />
          </div>
          <SkeletonBar width="82%" className="d-block mt-1" />
        </div>
      </Card.Body>
    </Card>
  )
}

export function MondayMeetingProcessingTabSkeleton() {
  return (
    <div className="home-skeleton d-flex flex-column" aria-busy="true" aria-label="Loading processing backlog">
      <Card className="app-surface-card processing-status-card">
        <Card.Body className="p-3">
          <Row className="g-3">
            <Col lg={12}>
              <ProcessingKpiTileSkeleton hero />
            </Col>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Col md={4} key={i}>
                <ProcessingKpiTileSkeleton />
              </Col>
            ))}
          </Row>
        </Card.Body>
      </Card>
      <Card className="app-surface-card mb-3 mt-4">
        <Card.Header className="border-0 pb-0 pt-3 px-3">
          <SkeletonBar width="18rem" height="1rem" />
        </Card.Header>
        <Card.Body className="pt-3 pb-3">
          <div className="processing-job-type-bar-wrap" style={{ height: 280 }}>
            {Array.from({ length: 7 }, (_, r) => (
              <div key={r} className="d-flex align-items-center gap-3 mb-3">
                <SkeletonBar width="7.5rem" height={11} className="flex-shrink-0" />
                <SkeletonBar height={16} borderRadius={6} className="flex-grow-1" />
              </div>
            ))}
          </div>
        </Card.Body>
      </Card>
    </div>
  )
}

function ProcessingHistoryChartSkeleton({ minHeight = 220 }: { minHeight?: number }) {
  return (
    <div aria-hidden>
      <SkeletonBar width="34%" className="d-block mb-2" />
      <SkeletonBar width="100%" height={`${minHeight}px`} borderRadius="0.5rem" />
    </div>
  )
}

function ProcessingHistoryKpiRowSkeleton() {
  return (
    <Row className="g-3 mb-3" aria-hidden>
      {[0, 1].map((i) => (
        <Col md={6} lg={6} key={i}>
          <Card className="h-100">
            <Card.Body>
              <SkeletonBar width="62%" />
              <SkeletonBar width="36%" height="2rem" borderRadius="0.5rem" className="d-block mt-2" />
              <SkeletonBar width="58%" className="d-block mt-2" />
              <SkeletonBar width="72%" className="d-block mt-2" />
            </Card.Body>
          </Card>
        </Col>
      ))}
    </Row>
  )
}

export function MondayMeetingProcessingHistoryTabSkeleton() {
  return (
    <div className="home-skeleton d-flex flex-column gap-3" aria-busy="true" aria-label="Loading processing history">
      <Card className="app-surface-card mb-0">
        <Card.Header className="border-0 pb-0 pt-3 px-3">
          <SkeletonBar width="18rem" height="1rem" />
        </Card.Header>
        <Card.Body className="p-3">
          <ProcessingHistoryChartSkeleton minHeight={220} />
        </Card.Body>
      </Card>
      <Card className="app-surface-card mb-0">
        <Card.Body>
          <SkeletonBar width="6rem" className="d-block mb-2" />
          <SkeletonBar width="min(100%, 22.5rem)" height={38} borderRadius="0.375rem" className="d-block" />
        </Card.Body>
      </Card>
      <ProcessingHistoryKpiRowSkeleton />
      {[0, 1].map((i) => (
        <Card key={i} className="mb-0">
          <Card.Header>
            <SkeletonBar width={i === 0 ? '14rem' : '16rem'} height="1rem" />
          </Card.Header>
          <Card.Body className="p-3">
            <ProcessingHistoryChartSkeleton minHeight={220} />
          </Card.Body>
        </Card>
      ))}
    </div>
  )
}

export function MondayMeetingSchedulingTabSkeleton() {
  return (
    <div className="home-skeleton d-flex flex-column gap-3" aria-busy="true" aria-label="Loading scheduling metrics">
      <Row className="g-3">
        {Array.from({ length: 4 }).map((_, idx) => (
          <Col lg={3} md={6} key={`sched-kpi-skel-${idx}`}>
            <Card className="app-kpi-nested processing-tile h-100 scheduling-kpi-tile">
              <Card.Body className="scheduling-kpi-tile__body">
                <SkeletonBar width="72%" />
                <div className="scheduling-kpi-main">
                  <SkeletonBar width="48%" height={28} className="home-skeleton-bar--value d-block" />
                </div>
                <SkeletonBar width="82%" />
              </Card.Body>
            </Card>
          </Col>
        ))}
      </Row>

      <div className="scheduling-jobs-left-strip-wrap scheduling-jobs-left-strip-wrap--skeleton" aria-hidden>
        <div className="scheduling-jobs-left-strip">
          <div className="scheduling-jobs-left-strip__track">
            {Array.from({ length: 2 }).map((_, idx) => (
              <div key={`jobs-left-skel-${idx}`} className="scheduling-jobs-left-strip__slide">
                <Card className="app-kpi-nested processing-tile h-100 scheduling-kpi-tile">
                  <Card.Body className="scheduling-kpi-tile__body">
                    <SkeletonBar width="72%" />
                    <div className="scheduling-kpi-main">
                      <SkeletonBar width="48%" height={28} className="home-skeleton-bar--value d-block" />
                    </div>
                    <SkeletonBar width="42%" />
                  </Card.Body>
                </Card>
              </div>
            ))}
          </div>
        </div>
      </div>

      {[0, 1].map((i) => (
        <Card key={i} className="app-surface-card scheduling-chart-card">
          <Card.Body>
            <div className="scheduling-chart-card__header">
              <SkeletonBar width={i === 0 ? '12rem' : '14rem'} height="1.1rem" />
              <SkeletonBar width="7rem" height="0.9rem" />
            </div>
            <div className={i === 0 ? 'scheduling-chart-card__canvas' : 'scheduling-chart-card__canvas scheduling-chart-card__canvas--tall'}>
              <div className="scheduling-chart-skeleton">
                <div className="scheduling-chart-skeleton__grid">
                  <SkeletonBar />
                  <SkeletonBar />
                  <SkeletonBar />
                  <SkeletonBar />
                </div>
                {i === 0 ? (
                  <div className="scheduling-chart-skeleton__series">
                    <SkeletonBar width="14%" />
                    <SkeletonBar width="22%" />
                    <SkeletonBar width="18%" />
                    <SkeletonBar width="26%" />
                    <SkeletonBar width="16%" />
                  </div>
                ) : (
                  <div className="scheduling-chart-skeleton__line-wrap">
                    <SkeletonBar className="scheduling-chart-skeleton__line d-block" />
                  </div>
                )}
                <SkeletonBar className="scheduling-chart-skeleton__xaxis d-block" />
              </div>
            </div>
          </Card.Body>
        </Card>
      ))}
    </div>
  )
}

function ServiceMetricTileSkeleton() {
  return (
    <Card className="app-kpi-nested processing-tile monday-meeting-service-tile h-100">
      <Card.Body className="monday-meeting-service-tile__body">
        <SkeletonBar width="62%" />
        <SkeletonBar width="36%" height="2rem" borderRadius="0.5rem" className="d-block mt-2" />
        <SkeletonBar width="78%" className="d-block mt-2" />
        <SkeletonBar width="64%" className="d-block mt-1" />
      </Card.Body>
    </Card>
  )
}

function SlaBucketSectionSkeleton({ cardCount }: { cardCount: number }) {
  return (
    <section className="monday-meeting-sla-bucket-section" aria-hidden>
      <SkeletonBar width="10rem" height={12} className="d-block mb-2" />
      <div className="monday-meeting-sla-bucket-section__cards">
        {Array.from({ length: cardCount }, (_, i) => (
          <Card key={i} className="app-kpi-nested processing-tile monday-meeting-service-tile monday-meeting-sla-bucket-kpi h-100">
            <Card.Body className="monday-meeting-sla-bucket-kpi__body">
              <SkeletonBar width="58%" height={11} />
              <SkeletonBar width="32%" height="1.75rem" borderRadius="0.35rem" className="d-block mt-2" />
              <SkeletonBar width="72%" height={10} className="d-block mt-2" />
            </Card.Body>
          </Card>
        ))}
      </div>
    </section>
  )
}

export function MondayMeetingServiceTabSkeleton({ includeToolbar = true }: { includeToolbar?: boolean }) {
  return (
    <div className="monday-meeting-service-tab home-skeleton" aria-busy="true" aria-label="Loading service metrics">
      {includeToolbar ? (
        <div className="monday-meeting-service-toolbar" aria-hidden>
          <div className="monday-meeting-service-toolbar__group">
            <SkeletonBar width="3.5rem" height={12} />
            <SkeletonBar width="9rem" height={31} borderRadius="0.375rem" />
            <SkeletonBar width="7.5rem" height={31} borderRadius="9999px" />
          </div>
          <SkeletonBar width="6.5rem" height={31} borderRadius="0.375rem" />
        </div>
      ) : null}

      <section className="monday-meeting-service-panel">
        <SkeletonBar width="3.5rem" height={14} className="d-block mb-3" />
        <div className="monday-meeting-service-kpi-grid monday-meeting-service-kpi-grid--cols-2">
          <ServiceMetricTileSkeleton />
          <ServiceMetricTileSkeleton />
        </div>
      </section>

      <section className="monday-meeting-service-panel">
        <div className="monday-meeting-sla-bucket-kpi-row">
          <SlaBucketSectionSkeleton cardCount={2} />
          <SlaBucketSectionSkeleton cardCount={4} />
        </div>
      </section>

      <section className="monday-meeting-service-panel">
        <SkeletonBar width="8rem" height={14} className="d-block mb-3" />
        <div className="monday-meeting-service-kpi-grid monday-meeting-service-kpi-grid--cols-3">
          <ServiceMetricTileSkeleton />
          <ServiceMetricTileSkeleton />
          <ServiceMetricTileSkeleton />
        </div>
      </section>

      <section className="monday-meeting-service-panel">
        <SkeletonBar width="6.5rem" height={14} className="d-block mb-3" />
        <div className="monday-meeting-service-kpi-grid monday-meeting-service-kpi-grid--cols-3">
          <ServiceMetricTileSkeleton />
        </div>
      </section>
    </div>
  )
}

export function MondayMeetingTabsNavSkeleton() {
  return (
    <div className="processing-tabs-shell__nav nav nav-tabs mb-0 processing-tabs" aria-hidden>
      {MONDAY_MEETING_TAB_SKELETON_WIDTHS.map((width, index) => (
        <div key={index} className="nav-item px-2 py-2">
          <SkeletonBar width={width} height={14} className="d-inline-block" />
        </div>
      ))}
    </div>
  )
}

export function MondayMeetingPageSuspenseFallback() {
  return (
    <div
      className="monday-meeting-page container-fluid py-3 px-2 d-flex flex-column gap-3"
      aria-busy="true"
      aria-label="Loading Monday Meeting"
    >
      <Card className="app-surface-card">
        <Card.Body className="p-3 p-md-4">
          <h1 className="processing-page-title mb-1">Monday Meeting</h1>
          <p className="processing-page-subtitle mb-0">
            Processing backlog, scheduling health, and service pipeline metrics in one view.
          </p>
        </Card.Body>
      </Card>

      <div className="processing-tabs-shell app-surface-card home-skeleton">
        <MondayMeetingTabsNavSkeleton />
        <div className="processing-tabs-shell__panel tab-content">
          <MondayMeetingProcessingTabSkeleton />
        </div>
      </div>
    </div>
  )
}
