import { useEffect, useState } from 'react'
import { Button, Form, Modal } from 'react-bootstrap'

type Props = {
  show: boolean
  stopNumber: number
  onHide: () => void
  onConfirm: (text: string) => void
}

export default function PortalReplacedPartModal({ show, stopNumber, onHide, onConfirm }: Props) {
  const [text, setText] = useState('')

  useEffect(() => {
    if (!show) return
    setText('')
  }, [show])

  const canSubmit = text.trim().length > 0

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton>
        <Modal.Title>Replaced part — stop #{stopNumber}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Form.Group>
          <Form.Label className="small">What part was replaced?</Form.Label>
          <textarea
            className="form-control"
            rows={3}
            value={text}
            placeholder="Describe the replaced part…"
            onChange={(e) => setText(e.target.value)}
          />
        </Form.Group>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={!canSubmit}
          onClick={() => onConfirm(text.trim())}
        >
          Add to job comments
        </Button>
      </Modal.Footer>
    </Modal>
  )
}
