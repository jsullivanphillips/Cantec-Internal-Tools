import { Button, Modal } from 'react-bootstrap'
import type { PortalMapsProvider } from './portalMapsLinks'

type Props = {
  show: boolean
  onHide: () => void
  onSelect: (provider: PortalMapsProvider) => void
}

export default function PortalMapsChoiceModal({ show, onHide, onSelect }: Props) {
  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton>
        <Modal.Title>Open in maps</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="mb-0">
          Choose your default maps app. We&apos;ll remember this for future stops.
        </p>
      </Modal.Body>
      <Modal.Footer className="d-flex flex-column flex-sm-row gap-2">
        <Button
          variant="outline-primary"
          className="flex-fill"
          onClick={() => onSelect('apple')}
        >
          Apple Maps
        </Button>
        <Button
          variant="outline-primary"
          className="flex-fill"
          onClick={() => onSelect('google')}
        >
          Google Maps
        </Button>
      </Modal.Footer>
    </Modal>
  )
}
