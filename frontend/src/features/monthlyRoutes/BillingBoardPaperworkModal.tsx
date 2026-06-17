import { useMemo } from 'react'
import { Modal } from 'react-bootstrap'
import SiteTestHistoryModalBody from './SiteTestHistoryModalBody'
import { formatMonthHeader } from './monthlyBillingBoard'
import { useSiteFieldSubmission } from './useSiteFieldSubmission'

export type BillingBoardPaperworkModalContext = {
  locationId: number
  locationLabel: string
  monthIso: string
  routeId: number
  billingStatus: string
  waiveReason?: string | null
}

type Props = {
  show: boolean
  context: BillingBoardPaperworkModalContext | null
  onHide: () => void
}

export default function BillingBoardPaperworkModal({ show, context, onHide }: Props) {
  const submission = useSiteFieldSubmission({
    routeId: show && context != null ? context.routeId : null,
    monthIso: context?.monthIso ?? '',
    locationId: context?.locationId ?? 0,
    enabled: show && context != null,
  })

  const monthLabel = context ? formatMonthHeader(context.monthIso) : ''

  const modalTitle = useMemo(() => {
    if (!context) return 'Paperwork'
    const site = context.locationLabel.trim() || `Location ${context.locationId}`
    return `${site} — ${monthLabel}`
  }, [context, monthLabel])

  if (!show) return null

  const isWaiveModal = context?.billingStatus === 'do_not_bill'

  return (
    <Modal
      show={show}
      onHide={onHide}
      centered
      size="xl"
      className={`billing-board-paperwork-modal${isWaiveModal ? ' billing-board-paperwork-modal--waive' : ''}`}
      dialogClassName="billing-board-paperwork-modal__dialog"
      contentClassName="billing-board-paperwork-modal__content"
    >
      <Modal.Header closeButton className="billing-board-paperwork-modal__header">
        <Modal.Title className="billing-board-paperwork-modal__title h6 mb-0">
          {modalTitle}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="billing-board-paperwork-modal__body monthly-run-detail-page">
        <SiteTestHistoryModalBody
          monthIso={context!.monthIso}
          submission={submission}
          billingStatus={context!.billingStatus}
        />
      </Modal.Body>
    </Modal>
  )
}
