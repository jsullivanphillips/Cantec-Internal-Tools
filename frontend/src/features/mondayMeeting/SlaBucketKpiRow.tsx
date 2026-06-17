import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { Button, Card, Modal, OverlayTrigger, Tooltip } from 'react-bootstrap'
import SlaJobTimelineRow from './SlaJobTimelineRow'
import SlaMissingScheduleRow from './SlaMissingScheduleRow'
import {
  sortSlaJobsByApprovalToScheduledDesc,
  type ScheduledWithinSlaGoal,
  type SlaModalView,
} from './ScheduledWithinSlaGoalTile'

function SlaJobListModal({
  show,
  onHide,
  title,
  emptyMessage,
  isEmpty,
  children,
}: {
  show: boolean
  onHide: () => void
  title: string
  emptyMessage: string
  isEmpty: boolean
  children: ReactNode
}) {
  return (
    <Modal
      show={show}
      onHide={onHide}
      size="xl"
      scrollable
      dialogClassName="monday-meeting-sla-jobs-modal-dialog"
    >
      <Modal.Header closeButton>
        <Modal.Title className="h6 mb-0">{title}</Modal.Title>
      </Modal.Header>
      <Modal.Body className="monday-meeting-sla-jobs-modal-body">
        {isEmpty ? <p className="text-muted small mb-0">{emptyMessage}</p> : children}
      </Modal.Body>
      <Modal.Footer>
        <Button type="button" variant="secondary" onClick={onHide}>
          Close
        </Button>
      </Modal.Footer>
    </Modal>
  )
}

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
            <button
              type="button"
              className="monday-meeting-sla-info-btn"
              aria-label={`About ${eyebrow}`}
            >
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
  const [activeModal, setActiveModal] = useState<SlaModalView | null>(null)

  const businessDayLimit = slaGoal?.business_day_limit ?? 10
  const eligibleJobs = slaGoal?.eligible_jobs ?? slaGoal?.within_sla_jobs ?? []
  const withinSlaJobs = eligibleJobs.filter((row) => row.within_sla)
  const outsideSlaJobs = sortSlaJobsByApprovalToScheduledDesc(eligibleJobs.filter((row) => !row.within_sla))
  const unscheduledUnderSlaJobs = slaGoal?.unscheduled_under_sla_jobs ?? []
  const awaitingJobUnderSlaJobs = slaGoal?.awaiting_job_under_sla_jobs ?? []
  const unscheduledOverSlaJobs = slaGoal?.unscheduled_over_sla_jobs ?? []
  const awaitingJobOverSlaJobs = slaGoal?.awaiting_job_over_sla_jobs ?? []

  const closeModal = () => setActiveModal(null)

  if (!slaGoal) return null

  return (
    <>
      <div className="monday-meeting-sla-bucket-kpi-row">
        <SlaBucketSection eyebrow="Scheduled repair quotes">
          <SlaBucketMiniKpi
            label="Met SLA"
            count={withinSlaJobs.length}
            detail={`Within ${businessDayLimit} bd`}
            status="good"
            onClick={() => setActiveModal('met')}
          />
          <SlaBucketMiniKpi
            label="Over SLA"
            count={outsideSlaJobs.length}
            detail={`Over ${businessDayLimit} bd`}
            status="danger"
            onClick={() => setActiveModal('over')}
          />
        </SlaBucketSection>

        <SlaBucketSection eyebrow="Approved quotes" eyebrowTooltip={APPROVED_QUOTES_BUCKET_TOOLTIP}>
          <SlaBucketMiniKpi
            label="Unscheduled under SLA"
            count={unscheduledUnderSlaJobs.length}
            detail="Has job, not yet scheduled"
            status="warn"
            onClick={() => setActiveModal('unscheduledUnderSla')}
          />
          <SlaBucketMiniKpi
            label="Awaiting job under SLA"
            count={awaitingJobUnderSlaJobs.length}
            detail="No job yet, ≤10 bd"
            status="warn"
            onClick={() => setActiveModal('awaitingJobUnderSla')}
          />
          <SlaBucketMiniKpi
            label="Unscheduled over SLA"
            count={unscheduledOverSlaJobs.length}
            detail="Not yet scheduled"
            status="danger"
            onClick={() => setActiveModal('unscheduledOverSla')}
          />
          <SlaBucketMiniKpi
            label="Awaiting job over SLA"
            count={awaitingJobOverSlaJobs.length}
            detail="No job yet"
            status="danger"
            onClick={() => setActiveModal('awaitingJobOverSla')}
          />
        </SlaBucketSection>
      </div>

      <SlaJobListModal
        show={activeModal === 'met'}
        onHide={closeModal}
        title={`Met SLA (${withinSlaJobs.length}) · ${businessDayLimit} business day target`}
        emptyMessage="No jobs met the SLA for this quarter."
        isEmpty={withinSlaJobs.length === 0}
      >
        <div className="sla-job-timeline-list">
          {withinSlaJobs.map((row) => (
            <SlaJobTimelineRow
              key={`${row.quote_id}-${row.job_id}`}
              row={row}
              businessDayLimit={businessDayLimit}
            />
          ))}
        </div>
      </SlaJobListModal>

      <SlaJobListModal
        show={activeModal === 'over'}
        onHide={closeModal}
        title={`Over SLA (${outsideSlaJobs.length}) · ${businessDayLimit} business day target`}
        emptyMessage="No jobs exceeded the SLA for this quarter."
        isEmpty={outsideSlaJobs.length === 0}
      >
        <div className="sla-job-timeline-list">
          {outsideSlaJobs.map((row) => (
            <SlaJobTimelineRow
              key={`${row.quote_id}-${row.job_id}`}
              row={row}
              businessDayLimit={businessDayLimit}
            />
          ))}
        </div>
      </SlaJobListModal>

      <SlaJobListModal
        show={activeModal === 'unscheduledUnderSla'}
        onHide={closeModal}
        title={`Unscheduled under SLA (${unscheduledUnderSlaJobs.length})`}
        emptyMessage="No jobs are within the scheduling SLA without a scheduling action."
        isEmpty={unscheduledUnderSlaJobs.length === 0}
      >
        <>
          <p className="text-muted small sla-job-timeline-modal__section-note mb-3">
            Jobs with a repair job but no scheduling action yet, approved within the last {businessDayLimit} business days.
          </p>
          <div className="sla-job-timeline-list">
            {unscheduledUnderSlaJobs.map((row) => (
              <SlaMissingScheduleRow key={`${row.quote_id}-${row.job_id ?? 'no-job'}`} row={row} underSla />
            ))}
          </div>
        </>
      </SlaJobListModal>

      <SlaJobListModal
        show={activeModal === 'awaitingJobUnderSla'}
        onHide={closeModal}
        title={`Awaiting job under SLA (${awaitingJobUnderSlaJobs.length})`}
        emptyMessage="No recently approved quotes are waiting for a repair job."
        isEmpty={awaitingJobUnderSlaJobs.length === 0}
      >
        <>
          <p className="text-muted small sla-job-timeline-modal__section-note mb-3">
            Approved within the last {businessDayLimit} business days with no repair job created yet.
          </p>
          <div className="sla-job-timeline-list">
            {awaitingJobUnderSlaJobs.map((row) => (
              <SlaMissingScheduleRow
                key={`${row.quote_id}-awaiting-under`}
                row={row}
                awaitingJob
                businessDayLimit={businessDayLimit}
              />
            ))}
          </div>
        </>
      </SlaJobListModal>

      <SlaJobListModal
        show={activeModal === 'unscheduledOverSla'}
        onHide={closeModal}
        title={`Unscheduled over SLA (${unscheduledOverSlaJobs.length})`}
        emptyMessage="No jobs are past the scheduling SLA without a scheduling action."
        isEmpty={unscheduledOverSlaJobs.length === 0}
      >
        <>
          <p className="text-muted small sla-job-timeline-modal__section-note mb-3">
            Jobs with a repair job but no scheduling action yet, approved more than {businessDayLimit} business days ago.
          </p>
          <div className="sla-job-timeline-list">
            {unscheduledOverSlaJobs.map((row) => (
              <SlaMissingScheduleRow
                key={`${row.quote_id}-unscheduled-over`}
                row={row}
                overSla
                businessDayLimit={businessDayLimit}
              />
            ))}
          </div>
        </>
      </SlaJobListModal>

      <SlaJobListModal
        show={activeModal === 'awaitingJobOverSla'}
        onHide={closeModal}
        title={`Awaiting job over SLA (${awaitingJobOverSlaJobs.length})`}
        emptyMessage="No approved quotes are past the scheduling SLA without a job."
        isEmpty={awaitingJobOverSlaJobs.length === 0}
      >
        <>
          <p className="text-muted small sla-job-timeline-modal__section-note mb-3">
            Approved more than {businessDayLimit} business days ago with no repair job created yet.
          </p>
          <div className="sla-job-timeline-list">
            {awaitingJobOverSlaJobs.map((row) => (
              <SlaMissingScheduleRow
                key={`${row.quote_id}-awaiting-over`}
                row={row}
                overSla
                businessDayLimit={businessDayLimit}
              />
            ))}
          </div>
        </>
      </SlaJobListModal>
    </>
  )
}
