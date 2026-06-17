import { Spinner } from 'react-bootstrap'
import OfficeWorksheetReadOnlyTable from './OfficeWorksheetReadOnlyTable'
import PortalSiteHistoryFieldCards from './PortalSiteHistoryFieldCards'
import { OFFICE_WORKSHEET_BILLING_HISTORY_COLUMNS } from './officeWorksheetTableShared'
import {
  formatFieldSubmissionCapturedAt,
  type SiteFieldSubmissionState,
} from './useSiteFieldSubmission'

type Props = {
  monthIso: string
  submission: SiteFieldSubmissionState
  /** Billing-board modal passes office billing decision; portal omits billing column. */
  billingStatus?: string | null
  showBillingColumn?: boolean
  emptyMessageOverride?: string | null
  loadingMessage?: string
  /** Portal phone layout: stacked field cards instead of the billing table. */
  stackedCardsLayout?: boolean
}

export default function SiteTestHistoryModalBody({
  monthIso,
  submission,
  billingStatus = 'bill',
  showBillingColumn,
  emptyMessageOverride,
  loadingMessage = 'Loading exact history…',
  stackedCardsLayout = false,
}: Props) {
  const { loading, stops, capturedAt, fieldWorkReopened, emptyMessage } = submission
  const resolvedEmpty = emptyMessageOverride ?? emptyMessage
  const showTable = !loading && resolvedEmpty == null && stops.length > 0
  const capturedLabel = capturedAt ? formatFieldSubmissionCapturedAt(capturedAt) : null

  if (loading) {
    return (
      <div className="d-flex align-items-center justify-content-center gap-2 text-muted small py-5">
        <Spinner animation="border" size="sm" aria-hidden />
        {loadingMessage}
      </div>
    )
  }

  if (resolvedEmpty) {
    return <p className="run-details-history-shell__empty mb-0 p-4">{resolvedEmpty}</p>
  }

  if (!showTable) return null

  const historyContent =
    stackedCardsLayout && stops[0] != null ? (
      <PortalSiteHistoryFieldCards stop={stops[0]} monthDate={monthIso} closedRun />
    ) : (
      <OfficeWorksheetReadOnlyTable
        stops={stops}
        monthDate={monthIso}
        layout="embedded"
        neutralStopNumbers
        preserveSubmissionStopOrder
        highlightUpdatedCells={false}
        hideEmptyChangeColumns={false}
        highlightNewComments
        closedRun
        columnVisibility={OFFICE_WORKSHEET_BILLING_HISTORY_COLUMNS}
        showStopColumn={false}
        layoutVariant="billing"
        showBillingColumn={showBillingColumn}
        billingStatus={billingStatus}
      />
    )

  return (
    <div
      className={`run-details-history-section run-details-history-section--billing site-test-history-modal-body${stackedCardsLayout ? ' site-test-history-modal-body--stacked' : ''}`}
    >
      <div className="run-details-history-shell">
        {fieldWorkReopened ? (
          <p className="run-details-history-shell__notice" role="status">
            Field work reopened — this snapshot updates when technicians end the run again.
            {capturedLabel ? ` Last captured ${capturedLabel}.` : null}
          </p>
        ) : null}
        {historyContent}
      </div>
    </div>
  )
}
