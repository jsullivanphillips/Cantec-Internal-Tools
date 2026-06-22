import { useEffect, useState } from 'react'
import { Alert, Button, Form, Modal, Spinner } from 'react-bootstrap'
import { parseYearMonth } from './monthlyRoutesShared'
import { SKIP_CATEGORIES, type PortalSkipCategory } from './portalWorkflowShared'

function formatMonthHeading(monthFirstIso: string): string {
  const ym = parseYearMonth(monthFirstIso)
  if (!ym) return monthFirstIso
  return new Intl.DateTimeFormat('en-CA', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(ym.year, ym.month - 1, 1)))
}

export type OfficeSkipSitePayload = {
  skip_category: PortalSkipCategory
  skip_note: string
}

type Props = {
  show: boolean
  monthIso: string | null
  locationLabel: string
  submitting: boolean
  error: string | null
  onClose: () => void
  onConfirm: (payload: OfficeSkipSitePayload) => void
}

const OFFICE_SKIP_CATEGORIES = SKIP_CATEGORIES.filter((c) => c.value !== 'annual')

export default function OfficeSkipSiteModal({
  show,
  monthIso,
  locationLabel,
  submitting,
  error,
  onClose,
  onConfirm,
}: Props) {
  const [category, setCategory] = useState<PortalSkipCategory | ''>('')
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!show) return
    setCategory('')
    setNote('')
  }, [show])

  const monthLabel = monthIso ? formatMonthHeading(monthIso) : null
  const canSubmit = category !== '' && note.trim().length > 0

  return (
    <Modal show={show} onHide={onClose} backdrop={submitting ? 'static' : true}>
      <Modal.Header closeButton={!submitting}>
        <Modal.Title>Skip site</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {monthLabel ? (
          <p className="mb-3">
            Mark <strong>{locationLabel}</strong> as skipped for <strong>{monthLabel}</strong>?
            Technicians will see this stop pre-filled as skipped. Billing stays unset until run
            review.
          </p>
        ) : null}
        <Form.Group className="mb-3">
          <Form.Label>Category</Form.Label>
          <Form.Select
            value={category}
            onChange={(e) => setCategory(e.target.value as PortalSkipCategory)}
            disabled={submitting}
            required
          >
            <option value="">Select a category…</option>
            {OFFICE_SKIP_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Form.Select>
        </Form.Group>
        <Form.Group className="mb-0">
          <Form.Label>Office job comment</Form.Label>
          <Form.Control
            as="textarea"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={submitting}
            placeholder="Why should technicians skip this site this month?"
            required
          />
          <Form.Text muted>
            Saved as the office job comment and the skip reason technicians see on the portal.
          </Form.Text>
        </Form.Group>
        {error ? <Alert variant="danger" className="mt-3 mb-0">{error}</Alert> : null}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          variant="warning"
          disabled={submitting || !monthIso || !canSubmit}
          onClick={() => {
            if (!canSubmit) return
            onConfirm({ skip_category: category as PortalSkipCategory, skip_note: note.trim() })
          }}
        >
          {submitting ? (
            <>
              <Spinner size="sm" animation="border" role="status" className="me-2" />
              Skipping…
            </>
          ) : (
            'Skip site'
          )}
        </Button>
      </Modal.Footer>
    </Modal>
  )
}
