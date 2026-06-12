import { useEffect, useMemo, useState } from 'react'
import { Badge, Modal, Spinner } from 'react-bootstrap'
import { apiJson, isAbortError } from '../../lib/apiClient'
import OfficeWorksheetReadOnlyTable from './OfficeWorksheetReadOnlyTable'
import {
  billingStatusLabel,
  billingStatusVariant,
  formatMonthHeader,
} from './monthlyBillingBoard'
import {
  getCachedFieldSubmission,
  setCachedFieldSubmission,
} from './paperworkRouteCache'
import type { TechnicianWorksheetLocation } from './monthlyRoutesShared'

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

function formatCapturedAt(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  )
}

export default function BillingBoardPaperworkModal({ show, context, onHide }: Props) {
  const [loading, setLoading] = useState(false)
  const [stops, setStops] = useState<TechnicianWorksheetLocation[]>([])
  const [capturedAt, setCapturedAt] = useState<string | null>(null)
  const [fieldWorkReopened, setFieldWorkReopened] = useState(false)
  const [emptyMessage, setEmptyMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!show || context == null) {
      setLoading(false)
      setStops([])
      setCapturedAt(null)
      setFieldWorkReopened(false)
      setEmptyMessage(null)
      return
    }

    const { routeId, monthIso, locationId } = context
    const cached = getCachedFieldSubmission(routeId, monthIso)
    if (cached) {
      const filtered = cached.stops.filter((stop) => stop.location_id === locationId)
      setStops(filtered)
      setCapturedAt(cached.capturedAt)
      setFieldWorkReopened(cached.fieldWorkReopened)
      setEmptyMessage(
        filtered.length === 0 ? 'No paperwork row for this site on this run.' : null,
      )
      setLoading(false)
    } else {
      setStops([])
      setCapturedAt(null)
      setFieldWorkReopened(false)
      setEmptyMessage(null)
      setLoading(true)
    }

    const ac = new AbortController()
    const qs = new URLSearchParams({ month: monthIso })

    void (async () => {
      try {
        const data = await apiJson<{
          stops: TechnicianWorksheetLocation[]
          captured_at: string | null
          field_work_reopened: boolean
        }>(
          `/api/monthly_routes/routes/${routeId}/run_details/field_submission?${qs.toString()}`,
          { signal: ac.signal },
        )
        if (ac.signal.aborted) return
        const entry = {
          stops: data.stops ?? [],
          capturedAt: data.captured_at,
          fieldWorkReopened: Boolean(data.field_work_reopened),
        }
        setCachedFieldSubmission(routeId, monthIso, entry)
        const filtered = entry.stops.filter((stop) => stop.location_id === locationId)
        setStops(filtered)
        setCapturedAt(entry.capturedAt)
        setFieldWorkReopened(entry.fieldWorkReopened)
        setEmptyMessage(
          filtered.length === 0 ? 'No paperwork row for this site on this run.' : null,
        )
      } catch (e) {
        if (isAbortError(e)) return
        if (!ac.signal.aborted) {
          setStops([])
          setCapturedAt(null)
          setFieldWorkReopened(false)
          setEmptyMessage('No field submission captured for this run.')
        }
      } finally {
        if (!ac.signal.aborted) setLoading(false)
      }
    })()

    return () => ac.abort()
  }, [show, context])

  const monthLabel = context ? formatMonthHeader(context.monthIso) : ''
  const billingLabel = context ? billingStatusLabel(context.billingStatus) : ''
  const billingVariant = context ? billingStatusVariant(context.billingStatus) : 'secondary'
  const waiveReason = context?.waiveReason?.trim() || null
  const capturedLabel = capturedAt ? formatCapturedAt(capturedAt) : null
  const showTable = !loading && emptyMessage == null && stops.length > 0

  const modalTitle = useMemo(() => {
    if (!context) return 'Paperwork'
    const site = context.locationLabel.trim() || `Location ${context.locationId}`
    return `${site} — ${monthLabel}`
  }, [context, monthLabel])

  if (!show) return null

  return (
    <Modal
      show={show}
      onHide={onHide}
      centered
      size="xl"
      className="billing-board-paperwork-modal"
      dialogClassName="billing-board-paperwork-modal__dialog"
      contentClassName="billing-board-paperwork-modal__content"
    >
      <Modal.Header closeButton className="billing-board-paperwork-modal__header">
        <div className="billing-board-paperwork-modal__title-block">
          <Modal.Title className="billing-board-paperwork-modal__title h6 mb-1">
            {modalTitle}
          </Modal.Title>
          {context ? (
            <div className="billing-board-paperwork-modal__subtitle d-flex flex-wrap align-items-center gap-2 small">
              <Badge bg={billingVariant}>{billingLabel}</Badge>
              {context.billingStatus === 'do_not_bill' && waiveReason ? (
                <span className="text-muted">{waiveReason}</span>
              ) : null}
              {capturedLabel ? (
                <span className="text-muted">Frozen {capturedLabel}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      </Modal.Header>
      <Modal.Body className="billing-board-paperwork-modal__body p-0 monthly-run-detail-page">
        {loading ? (
          <div className="d-flex align-items-center justify-content-center gap-2 text-muted small py-5">
            <Spinner animation="border" size="sm" aria-hidden />
            Loading exact history…
          </div>
        ) : emptyMessage ? (
          <p className="run-details-history-shell__empty mb-0 p-4">{emptyMessage}</p>
        ) : showTable ? (
          <div className="run-details-history-section">
            <div className="run-details-history-shell">
              {fieldWorkReopened ? (
                <p className="run-details-history-shell__notice" role="status">
                  Field work reopened — this snapshot updates when technicians end the run again.
                  {capturedLabel ? ` Last captured ${capturedLabel}.` : null}
                </p>
              ) : null}
              <OfficeWorksheetReadOnlyTable
                stops={stops}
                monthDate={context!.monthIso}
                layout="embedded"
                neutralStopNumbers
                preserveSubmissionStopOrder
                highlightUpdatedCells={false}
                hideEmptyChangeColumns={false}
                highlightNewComments
                closedRun
              />
            </div>
          </div>
        ) : null}
      </Modal.Body>
    </Modal>
  )
}
