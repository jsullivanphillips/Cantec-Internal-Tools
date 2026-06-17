import { type ReactNode } from 'react'
import { Button, Modal } from 'react-bootstrap'
import SlaJobTimelineRow from './SlaJobTimelineRow'
import SlaMissingScheduleRow from './SlaMissingScheduleRow'
import type { SlaModalView } from './ScheduledWithinSlaGoalTile'
import type { SlaBucketModalState } from './useSlaBucketModals'

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

type Props = {
  modalState: SlaBucketModalState
}

export default function SlaBucketModals({ modalState }: Props) {
  const {
    activeModal,
    closeModal,
    businessDayLimit,
    withinSlaJobs,
    outsideSlaJobs,
    unscheduledUnderSlaJobs,
    awaitingJobUnderSlaJobs,
    unscheduledOverSlaJobs,
    awaitingJobOverSlaJobs,
  } = modalState

  return (
    <>
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
            Jobs with a repair job but no scheduling action yet, approved within the last {businessDayLimit} business
            days.
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
            Jobs with a repair job but no scheduling action yet, approved more than {businessDayLimit} business days
            ago.
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

export type { SlaModalView }
