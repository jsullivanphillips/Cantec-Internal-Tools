import OfficeWorksheetReadOnlyTable from './OfficeWorksheetReadOnlyTable'
import type { TechnicianWorksheetStop } from './monthlyRoutesShared'

function formatCapturedAt(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  )
}

export default function RunDetailsHistoryTable({
  stops,
  monthDate,
  capturedAt,
  fieldWorkReopened,
  runCompleted,
}: {
  stops: TechnicianWorksheetStop[]
  monthDate: string
  capturedAt: string | null
  fieldWorkReopened: boolean
  runCompleted: boolean
}) {
  const capturedLabel = capturedAt ? formatCapturedAt(capturedAt) : null
  const stopCount = stops.length

  return (
    <div className="run-details-history-section">
      <div className="run-details-history-shell">
        <header className="run-details-history-shell__header">
          <div className="run-details-history-shell__title-block">
            <p className="run-details-history-shell__eyebrow">Paperwork</p>
            <h2 className="run-details-history-shell__title">Exact history</h2>
          </div>
          <div className="run-details-history-shell__meta" aria-label="Snapshot details">
            <span className="run-details-history-shell__badge">
              <strong className="tabular-nums">{stopCount}</strong>{' '}
              {stopCount === 1 ? 'stop' : 'stops'}
            </span>
            {capturedLabel ? (
              <span className="run-details-history-shell__meta-item">
                Frozen <strong>{capturedLabel}</strong>
              </span>
            ) : null}
            {fieldWorkReopened ? (
              <span className="run-details-history-shell__badge run-details-history-shell__badge--warn">
                Field reopened
              </span>
            ) : null}
          </div>
        </header>

        {fieldWorkReopened ? (
          <p className="run-details-history-shell__notice" role="status">
            Field work reopened — this snapshot updates when technicians end the run again.
            {capturedLabel ? ` Last captured ${capturedLabel}.` : null}
          </p>
        ) : null}

        <OfficeWorksheetReadOnlyTable
          stops={stops}
          monthDate={monthDate}
          layout="embedded"
          neutralStopNumbers
          preserveSubmissionStopOrder
          highlightUpdatedCells={false}
          hideEmptyChangeColumns={false}
          highlightNewComments
          closedRun={runCompleted}
        />
      </div>
    </div>
  )
}
