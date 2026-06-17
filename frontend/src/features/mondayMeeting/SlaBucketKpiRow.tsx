import { type KeyboardEvent, type ReactNode } from 'react'
import { Card, OverlayTrigger, Tooltip } from 'react-bootstrap'
import SlaBucketModals from './SlaBucketModals'
import type { ScheduledWithinSlaGoal } from './ScheduledWithinSlaGoalTile'
import { useSlaBucketModals } from './useSlaBucketModals'

type BucketStatus = 'good' | 'warn' | 'danger'

function SlaBucketMiniKpi({
  label,
  count,
  detail,
  status,
  onClick,
}: {
  label: string
  count: number
  detail?: string
  status: BucketStatus
  onClick: () => void
}) {
  const disabled = count === 0

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onClick()
    }
  }

  return (
    <Card
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label={`${label}, ${count}${disabled ? '' : ', view details'}`}
      className={`app-kpi-nested processing-tile monday-meeting-service-tile monday-meeting-sla-bucket-kpi monday-meeting-sla-bucket-kpi--${status} h-100${
        disabled ? ' monday-meeting-sla-bucket-kpi--disabled' : ' monday-meeting-sla-bucket-kpi--clickable'
      }`}
      onClick={disabled ? undefined : onClick}
      onKeyDown={onKeyDown}
    >
      <Card.Body className="monday-meeting-sla-bucket-kpi__body">
        <div className="monday-meeting-sla-bucket-kpi__label">{label}</div>
        <div className="monday-meeting-sla-bucket-kpi__value">{count}</div>
        {detail ? <div className="monday-meeting-sla-bucket-kpi__detail">{detail}</div> : null}
      </Card.Body>
    </Card>
  )
}

const APPROVED_QUOTES_BUCKET_TOOLTIP =
  'Approved repair quotes from the selected quarter that do not yet have a scheduled repair job, grouped by SLA status.'

function SlaBucketSection({
  eyebrow,
  eyebrowTooltip,
  children,
}: {
  eyebrow: string
  eyebrowTooltip?: string
  children: ReactNode
}) {
  return (
    <section className="monday-meeting-sla-bucket-section">
      <div className="monday-meeting-sla-bucket-section__eyebrow-row">
        <h3 className="monday-meeting-sla-bucket-section__eyebrow">{eyebrow}</h3>
        {eyebrowTooltip ? (
          <OverlayTrigger
            placement="top"
            trigger={['hover', 'focus']}
            overlay={
              <Tooltip id={`sla-bucket-${eyebrow}`} className="monday-meeting-sla-info-tooltip">
                {eyebrowTooltip}
              </Tooltip>
            }
          >
            <button type="button" className="monday-meeting-sla-info-btn" aria-label={`About ${eyebrow}`}>
              <i className="bi bi-info-circle" aria-hidden />
            </button>
          </OverlayTrigger>
        ) : null}
      </div>
      <div className="monday-meeting-sla-bucket-section__cards">{children}</div>
    </section>
  )
}

export default function SlaBucketKpiRow({ slaGoal }: { slaGoal: ScheduledWithinSlaGoal | undefined }) {
  const modalState = useSlaBucketModals(slaGoal)
  const { openModal, businessDayLimit } = modalState

  if (!slaGoal) return null

  return (
    <>
      <div className="monday-meeting-sla-bucket-kpi-row">
        <SlaBucketSection eyebrow="Scheduled repair quotes">
          <SlaBucketMiniKpi
            label="Met SLA"
            count={modalState.withinSlaJobs.length}
            detail={`Within ${businessDayLimit} bd`}
            status="good"
            onClick={() => openModal('met')}
          />
          <SlaBucketMiniKpi
            label="Over SLA"
            count={modalState.outsideSlaJobs.length}
            detail={`Over ${businessDayLimit} bd`}
            status="danger"
            onClick={() => openModal('over')}
          />
        </SlaBucketSection>

        <SlaBucketSection eyebrow="Approved quotes" eyebrowTooltip={APPROVED_QUOTES_BUCKET_TOOLTIP}>
          <SlaBucketMiniKpi
            label="Unscheduled under SLA"
            count={modalState.unscheduledUnderSlaJobs.length}
            detail="Has job, not yet scheduled"
            status="warn"
            onClick={() => openModal('unscheduledUnderSla')}
          />
          <SlaBucketMiniKpi
            label="Awaiting job under SLA"
            count={modalState.awaitingJobUnderSlaJobs.length}
            detail="No job yet, ≤10 bd"
            status="warn"
            onClick={() => openModal('awaitingJobUnderSla')}
          />
          <SlaBucketMiniKpi
            label="Unscheduled over SLA"
            count={modalState.unscheduledOverSlaJobs.length}
            detail="Not yet scheduled"
            status="danger"
            onClick={() => openModal('unscheduledOverSla')}
          />
          <SlaBucketMiniKpi
            label="Awaiting job over SLA"
            count={modalState.awaitingJobOverSlaJobs.length}
            detail="No job yet"
            status="danger"
            onClick={() => openModal('awaitingJobOverSla')}
          />
        </SlaBucketSection>
      </div>

      <SlaBucketModals modalState={modalState} />
    </>
  )
}

export { useSlaBucketModals }
