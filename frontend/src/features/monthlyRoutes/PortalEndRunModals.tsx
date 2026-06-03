import { Button, Modal } from 'react-bootstrap'
import type { TechnicianWorksheetStop } from './monthlyRoutesShared'
import type { PortalEndRunModalState } from './portalEndRunPreflight'

type Props = {
  modal: PortalEndRunModalState | null
  onDismiss: () => void
  onGoToClockedInStop: (testingSiteId: number) => void
  onConfirmSkipUntestedAndEnd: () => void
  endRunBusy: boolean
}

function stopSummaryLine(stop: TechnicianWorksheetStop): string {
  const num = stop.stop_number ?? '?'
  const addr = (stop.display_address || stop.label || '').trim()
  return addr ? `Stop #${num} — ${addr}` : `Stop #${num}`
}

export default function PortalEndRunModals({
  modal,
  onDismiss,
  onGoToClockedInStop,
  onConfirmSkipUntestedAndEnd,
  endRunBusy,
}: Props) {
  if (!modal) return null

  if (modal.kind === 'open_clock') {
    const primary = modal.stops[0]
    const multi = modal.stops.length > 1
    return (
      <Modal show centered onHide={endRunBusy ? undefined : onDismiss}>
        <Modal.Header closeButton={!endRunBusy}>
          <Modal.Title>Clock out first</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {multi ? (
            <>
              <p className="mb-2">
                {modal.stops.length} stops are still clocked in. Clock out before ending the field run.
              </p>
              <ul className="small mb-0">
                {modal.stops.map((s) => (
                  <li key={s.testing_site_id}>{stopSummaryLine(s)}</li>
                ))}
              </ul>
            </>
          ) : primary ? (
            <p className="mb-0">
              {stopSummaryLine(primary)} is still clocked in. Clock out before ending the field run.
            </p>
          ) : (
            <p className="mb-0">A stop is still clocked in. Clock out before ending the field run.</p>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" disabled={endRunBusy} onClick={onDismiss}>
            Cancel
          </Button>
          {primary ? (
            <Button
              variant="primary"
              disabled={endRunBusy}
              onClick={() => onGoToClockedInStop(primary.testing_site_id)}
            >
              Go to clocked-in stop
            </Button>
          ) : null}
        </Modal.Footer>
      </Modal>
    )
  }

  const count = modal.stops.length
  return (
    <Modal show centered onHide={endRunBusy ? undefined : onDismiss}>
      <Modal.Header closeButton={!endRunBusy}>
        <Modal.Title>Stops without test results</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="mb-2">
          {count === 1
            ? '1 stop does not have a test result yet.'
            : `${count} stops do not have a test result yet.`}{' '}
          Go back to finish testing, or skip the remaining stops as Lack of time and end the field run.
        </p>
        <ul className="small mb-0">
          {modal.stops.map((s) => (
            <li key={s.testing_site_id}>{stopSummaryLine(s)}</li>
          ))}
        </ul>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" disabled={endRunBusy} onClick={onDismiss}>
          Cancel
        </Button>
        <Button variant="warning" disabled={endRunBusy} onClick={onConfirmSkipUntestedAndEnd}>
          {endRunBusy ? 'Working…' : 'Skip remaining & end run'}
        </Button>
      </Modal.Footer>
    </Modal>
  )
}
