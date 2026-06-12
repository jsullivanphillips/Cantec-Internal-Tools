import { useEffect, useState } from 'react'
import { Button, Form, Modal } from 'react-bootstrap'
import { SKIP_CATEGORIES, type PortalSkipCategory } from './portalWorkflowShared'

type Props = {
  show: boolean
  stopNumber: number
  onHide: () => void
  onConfirm: (category: PortalSkipCategory, note: string) => void
}

export default function PortalSkipModal({ show, stopNumber, onHide, onConfirm }: Props) {
  const [category, setCategory] = useState<PortalSkipCategory | ''>('')
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!show) return
    setCategory('')
    setNote('')
  }, [show])

  const canSubmit = category !== ''

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton>
        <Modal.Title>Skip stop #{stopNumber}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Form.Group className="mb-3">
          <Form.Label className="small">Category</Form.Label>
          <Form.Select
            value={category}
            onChange={(e) => setCategory(e.target.value as PortalSkipCategory)}
            required
          >
            <option value="">Select a reason…</option>
            {SKIP_CATEGORIES.filter((c) => c.value !== 'annual').map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Form.Select>
        </Form.Group>
        <Form.Group>
          <Form.Label className="small">Note (optional)</Form.Label>
          <textarea
            className="form-control"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Form.Group>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>
          Cancel
        </Button>
        <Button
          variant="warning"
          disabled={!canSubmit}
          onClick={() => onConfirm(category as PortalSkipCategory, note.trim())}
        >
          Confirm skip
        </Button>
      </Modal.Footer>
    </Modal>
  )
}
