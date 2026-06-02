import { useState } from 'react'
import { Button, Form, Modal } from 'react-bootstrap'
import { apiJson } from '../../lib/apiClient'

export default function PortalReplaceItemModal({
  show,
  routeId,
  monthDate,
  testingSiteId,
  onHide,
  onSaved,
}: {
  show: boolean
  routeId: number
  monthDate: string
  testingSiteId: number
  onHide: () => void
  onSaved?: () => void
}) {
  const [description, setDescription] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async () => {
    const desc = description.trim()
    if (!desc) return
    setBusy(true)
    setError(null)
    try {
      const qs = new URLSearchParams({ month: monthDate })
      await apiJson(
        `/api/monthly_routes/routes/${routeId}/worksheet/stops/${testingSiteId}/job_items?${qs}`,
        {
          method: 'POST',
          body: JSON.stringify({ description: desc, quantity: parseFloat(quantity) || 1 }),
        },
      )
      setDescription('')
      setQuantity('1')
      onSaved?.()
      onHide()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to log item.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton>
        <Modal.Title className="h6 mb-0">Replace / add item</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error ? <p className="text-danger small">{error}</p> : null}
        <Form.Group className="mb-2">
          <Form.Label className="small">Description</Form.Label>
          <Form.Control
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Replace 10 lb ABC extinguisher"
          />
        </Form.Group>
        <Form.Group className="mb-0">
          <Form.Label className="small">Quantity</Form.Label>
          <Form.Control
            type="number"
            min={0.01}
            step={0.01}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </Form.Group>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" size="sm" onClick={onHide} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" disabled={busy || !description.trim()} onClick={() => void onSubmit()}>
          {busy ? 'Saving…' : 'Log item'}
        </Button>
      </Modal.Footer>
    </Modal>
  )
}
