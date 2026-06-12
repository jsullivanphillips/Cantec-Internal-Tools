import { useCallback, useEffect, useState } from 'react'
import { Alert, Badge, Button, Form, Modal, Spinner } from 'react-bootstrap'
import { apiJson } from '../../lib/apiClient'

export type LocationTicket = {
  id: number
  location_id: number
  run_id: number | null
  month_date: string | null
  title: string
  body: string | null
  status: 'open' | 'email_sent' | 'resolved'
  created_by: string | null
  resolved_at: string | null
  created_at: string | null
  updated_at: string | null
}

const STATUS_LABELS: Record<LocationTicket['status'], string> = {
  open: 'Open',
  email_sent: 'Email sent',
  resolved: 'Resolved',
}

const NEXT_STATUS: Partial<Record<LocationTicket['status'], LocationTicket['status']>> = {
  open: 'email_sent',
  email_sent: 'resolved',
}

export default function LocationTicketsModal({
  show,
  routeId,
  locationId,
  locationLabel,
  monthDate,
  onHide,
  onTicketsChanged,
  embedded = false,
}: {
  show: boolean
  routeId: number
  locationId: number
  locationLabel: string
  monthDate: string
  onHide: () => void
  onTicketsChanged?: () => void
  /** Render as a side panel (no Bootstrap Modal shell). */
  embedded?: boolean
}) {
  const [tickets, setTickets] = useState<LocationTicket[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [creating, setCreating] = useState(false)
  const [advancingId, setAdvancingId] = useState<number | null>(null)

  const loadTickets = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiJson<{ tickets: LocationTicket[] }>(
        `/api/monthly_routes/routes/${routeId}/locations/${locationId}/tickets`,
      )
      setTickets(data.tickets ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tickets.')
      setTickets([])
    } finally {
      setLoading(false)
    }
  }, [routeId, locationId])

  useEffect(() => {
    if (show) void loadTickets()
  }, [show, loadTickets])

  const onCreate = async () => {
    const trimmed = title.trim()
    if (!trimmed) return
    setCreating(true)
    setError(null)
    try {
      await apiJson(`/api/monthly_routes/routes/${routeId}/locations/${locationId}/tickets`, {
        method: 'POST',
        body: JSON.stringify({ title: trimmed, body: body.trim() || null, month_date: monthDate }),
      })
      setTitle('')
      setBody('')
      await loadTickets()
      onTicketsChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create ticket.')
    } finally {
      setCreating(false)
    }
  }

  const advanceStatus = async (ticket: LocationTicket) => {
    const next = NEXT_STATUS[ticket.status]
    if (!next) return
    setAdvancingId(ticket.id)
    setError(null)
    try {
      await apiJson(`/api/monthly_routes/tickets/${ticket.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: next }),
      })
      await loadTickets()
      onTicketsChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update ticket.')
    } finally {
      setAdvancingId(null)
    }
  }

  if (!show) return null

  const header = (
    <div className="modal-header run-details-tickets-site-pair__panel-header">
      <div className="modal-title h6 mb-0">Tickets — {locationLabel}</div>
      <button type="button" className="btn-close" aria-label="Close" onClick={onHide} />
    </div>
  )

  const bodyContent = (
    <>
      {error ? (
        <Alert variant="danger" className="py-2 small">
          {error}
        </Alert>
      ) : null}
      {loading ? (
        <div className="text-center py-3">
          <Spinner animation="border" size="sm" aria-hidden />
        </div>
      ) : (
        <>
          {tickets.length === 0 ? (
            <p className="text-muted small mb-3">No tickets for this location yet.</p>
          ) : (
            <ul className="list-unstyled mb-3">
              {tickets.map((ticket) => (
                <li key={ticket.id} className="border rounded p-2 mb-2">
                  <div className="d-flex align-items-start justify-content-between gap-2">
                    <div>
                      <strong>{ticket.title}</strong>
                      <Badge bg="secondary" className="ms-2">
                        {STATUS_LABELS[ticket.status]}
                      </Badge>
                      {ticket.body ? <p className="small mb-0 mt-1">{ticket.body}</p> : null}
                    </div>
                    {NEXT_STATUS[ticket.status] ? (
                      <Button
                        size="sm"
                        variant="outline-primary"
                        disabled={advancingId === ticket.id}
                        onClick={() => void advanceStatus(ticket)}
                      >
                        {advancingId === ticket.id
                          ? 'Saving…'
                          : `Mark ${STATUS_LABELS[NEXT_STATUS[ticket.status]!]}`}
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <hr />
          <h3 className="h6">New ticket</h3>
          <Form.Group className="mb-2">
            <Form.Label className="small">Title</Form.Label>
            <Form.Control
              size="sm"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Send monitoring test email"
            />
          </Form.Group>
          <Form.Group className="mb-0">
            <Form.Label className="small">Notes</Form.Label>
            <Form.Control
              as="textarea"
              rows={2}
              size="sm"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </Form.Group>
        </>
      )}
    </>
  )

  const footer = (
    <div className="modal-footer run-details-tickets-site-pair__panel-footer">
      <Button variant="secondary" size="sm" onClick={onHide}>
        Close
      </Button>
      <Button variant="primary" size="sm" disabled={creating || !title.trim()} onClick={() => void onCreate()}>
        {creating ? 'Creating…' : 'Create ticket'}
      </Button>
    </div>
  )

  if (embedded) {
    return (
      <div className="run-details-tickets-site-pair__panel run-details-tickets-site-pair__panel--tickets modal-content">
        {header}
        <div className="modal-body run-details-tickets-site-pair__panel-body">{bodyContent}</div>
        {footer}
      </div>
    )
  }

  return (
    <Modal show={show} onHide={onHide} size="lg" centered>
      <Modal.Header closeButton>
        <Modal.Title className="h6 mb-0">Tickets — {locationLabel}</Modal.Title>
      </Modal.Header>
      <Modal.Body>{bodyContent}</Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" size="sm" onClick={onHide}>
          Close
        </Button>
        <Button variant="primary" size="sm" disabled={creating || !title.trim()} onClick={() => void onCreate()}>
          {creating ? 'Creating…' : 'Create ticket'}
        </Button>
      </Modal.Footer>
    </Modal>
  )
}
