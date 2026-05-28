import { useEffect, useState } from 'react'
import { Button, Form, Modal } from 'react-bootstrap'
import {
  DEFICIENCY_SEVERITIES,
  DEFICIENCY_STATUSES,
  type PortalDeficiencySummary,
} from './portalWorkflowShared'

export type DeficiencyFormValues = {
  title: string
  severity: string
  status: string
  description: string
}

type Props = {
  show: boolean
  mode: 'add' | 'edit'
  deficiency?: PortalDeficiencySummary | null
  onHide: () => void
  onSave: (values: DeficiencyFormValues) => void
}

export default function PortalDeficiencyModal({
  show,
  mode,
  deficiency,
  onHide,
  onSave,
}: Props) {
  const [title, setTitle] = useState('')
  const [severity, setSeverity] = useState('deficient')
  const [status, setStatus] = useState('new')
  const [description, setDescription] = useState('')

  useEffect(() => {
    if (!show) return
    if (mode === 'edit' && deficiency) {
      setTitle(deficiency.title)
      setSeverity(deficiency.severity)
      setStatus(deficiency.status)
      setDescription(deficiency.description ?? '')
    } else {
      setTitle('')
      setSeverity('deficient')
      setStatus('new')
      setDescription('')
    }
  }, [show, mode, deficiency])

  const canSave = title.trim().length > 0

  return (
    <Modal show={show} onHide={onHide} centered size="lg">
      <Modal.Header closeButton>
        <Modal.Title>{mode === 'add' ? 'Add deficiency' : 'Edit deficiency'}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Form.Group className="mb-3">
          <Form.Label className="small">Title</Form.Label>
          <Form.Control value={title} onChange={(e) => setTitle(e.target.value)} />
        </Form.Group>
        <div className="row g-2 mb-3">
          <div className="col-6">
            <Form.Label className="small">Severity</Form.Label>
            <Form.Select value={severity} onChange={(e) => setSeverity(e.target.value)}>
              {DEFICIENCY_SEVERITIES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Form.Select>
          </div>
          <div className="col-6">
            <Form.Label className="small">Status</Form.Label>
            <Form.Select value={status} onChange={(e) => setStatus(e.target.value)}>
              {DEFICIENCY_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Form.Select>
          </div>
        </div>
        <Form.Group>
          <Form.Label className="small">Description</Form.Label>
          <textarea
            className="form-control"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Form.Group>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={!canSave}
          onClick={() =>
            onSave({
              title: title.trim(),
              severity,
              status,
              description: description.trim(),
            })
          }
        >
          Save
        </Button>
      </Modal.Footer>
    </Modal>
  )
}
