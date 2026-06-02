import { useEffect, useId, useState } from 'react'
import { Button, Form, Modal } from 'react-bootstrap'
import { createMonitoringCompany } from './monitoringCompaniesShared'
import type { MonitoringCompanySummary } from './monthlyRoutesShared'

type AddMonitoringCompanyModalProps = {
  show: boolean
  onHide: () => void
  onCreated: (company: MonitoringCompanySummary, reusedExisting: boolean) => void
}

export default function AddMonitoringCompanyModal({
  show,
  onHide,
  onCreated,
}: AddMonitoringCompanyModalProps) {
  const nameId = useId()
  const primaryId = useId()
  const secondaryId = useId()
  const [name, setName] = useState('')
  const [primaryPhone, setPrimaryPhone] = useState('')
  const [secondaryPhone, setSecondaryPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!show) return
    setName('')
    setPrimaryPhone('')
    setSecondaryPhone('')
    setError(null)
    setSaving(false)
  }, [show])

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Company name is required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await createMonitoringCompany({
        name: trimmed,
        primary_phone: primaryPhone,
        secondary_phone: secondaryPhone,
      })
      onCreated(res.company, res.reused_existing)
      onHide()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create monitoring company.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton>
        <Modal.Title>Add monitoring company</Modal.Title>
      </Modal.Header>
      <Modal.Body className="d-flex flex-column gap-3">
        {error ? <div className="text-danger small">{error}</div> : null}
        <Form.Group>
          <Form.Label htmlFor={nameId}>Name</Form.Label>
          <Form.Control
            id={nameId}
            value={name}
            autoFocus
            disabled={saving}
            onChange={(e) => setName(e.target.value)}
          />
        </Form.Group>
        <Form.Group>
          <Form.Label htmlFor={primaryId}>Primary phone</Form.Label>
          <Form.Control
            id={primaryId}
            value={primaryPhone}
            disabled={saving}
            onChange={(e) => setPrimaryPhone(e.target.value)}
          />
        </Form.Group>
        <Form.Group>
          <Form.Label htmlFor={secondaryId}>Secondary phone</Form.Label>
          <Form.Control
            id={secondaryId}
            value={secondaryPhone}
            disabled={saving}
            onChange={(e) => setSecondaryPhone(e.target.value)}
          />
        </Form.Group>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={onHide} disabled={saving}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => void submit()} disabled={saving}>
          {saving ? 'Saving…' : 'Save company'}
        </Button>
      </Modal.Footer>
    </Modal>
  )
}
