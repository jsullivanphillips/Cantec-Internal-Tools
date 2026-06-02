import { Spinner } from 'react-bootstrap'

type PortalBlockingOverlayProps = {
  show: boolean
  message: string
}

export default function PortalBlockingOverlay({ show, message }: PortalBlockingOverlayProps) {
  if (!show) return null
  return (
    <div
      className="portal-blocking-overlay"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={message}
    >
      <div className="portal-blocking-overlay-card">
        <Spinner animation="border" variant="primary" />
        <div className="portal-blocking-overlay-message">{message}</div>
      </div>
    </div>
  )
}
