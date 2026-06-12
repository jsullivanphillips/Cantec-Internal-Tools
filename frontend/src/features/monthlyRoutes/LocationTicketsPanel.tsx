import { useCallback, useEffect, useState } from 'react'
import { apiJson } from '../../lib/apiClient'
import { Alert, Badge, Button, Form, Modal, Spinner } from 'react-bootstrap'
import LocationTicketDetail from './LocationTicketDetail'
import LocationTicketForm from './LocationTicketForm'
import {
  createLocationTicket,
  fetchLocationTickets,
  TICKET_STATUS_LABELS,
  ticketStatusBadgeVariant,
  type LocationTicket,
} from './locationTicketsShared'

type Props = {
  routeId: number
  locationId: number
  locationLabel: string
  monthDate?: string | null
  sessionUsername?: string | null
  onTicketsChanged?: () => void
  showCreateByDefault?: boolean
}

export default function LocationTicketsPanel({
  routeId,
  locationId,
  locationLabel,
  monthDate = null,
  sessionUsername = null,
  onTicketsChanged,
  showCreateByDefault = false,
}: Props) {
  const [tickets, setTickets] = useState<LocationTicket[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [includeClosed, setIncludeClosed] = useState(false)
  const [creating, setCreating] = useState(showCreateByDefault)
  const [createBusy, setCreateBusy] = useState(false)
  const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null)
  const [resolvedUsername, setResolvedUsername] = useState<string | null>(sessionUsername ?? null)

  useEffect(() => {
    if (sessionUsername != null) {
      setResolvedUsername(sessionUsername)
      return
    }
    let active = true
    apiJson<{ username?: string | null }>('/api/auth/me')
      .then((d) => {
        if (active) setResolvedUsername(typeof d.username === 'string' ? d.username : null)
      })
      .catch(() => {
        if (active) setResolvedUsername(null)
      })
    return () => {
      active = false
    }
  }, [sessionUsername])

  const loadTickets = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await fetchLocationTickets(routeId, locationId, includeClosed)
      setTickets(rows)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tickets.')
      setTickets([])
    } finally {
      setLoading(false)
    }
  }, [routeId, locationId, includeClosed])

  useEffect(() => {
    void loadTickets()
  }, [loadTickets])

  const onCreate = async (input: { title: string; description?: string | null; tags?: string[] }) => {
    setCreateBusy(true)
    setError(null)
    try {
      await createLocationTicket(routeId, locationId, {
        ...input,
        monthDate,
      })
      setCreating(false)
      await loadTickets()
      onTicketsChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create ticket.')
    } finally {
      setCreateBusy(false)
    }
  }

  if (selectedTicketId != null) {
    return (
      <LocationTicketDetail
        ticketId={selectedTicketId}
        sessionUsername={resolvedUsername}
        onTicketUpdated={() => {
          void loadTickets()
          onTicketsChanged?.()
        }}
        onClose={() => {
          setSelectedTicketId(null)
          void loadTickets()
          onTicketsChanged?.()
        }}
      />
    )
  }

  return (
    <div className="location-tickets-panel">
      {error ? (
        <Alert variant="danger" className="py-2 small">
          {error}
        </Alert>
      ) : null}
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
        <Form.Check
          type="switch"
          id={`show-closed-tickets-${locationId}`}
          label="Show closed"
          checked={includeClosed}
          onChange={(e) => setIncludeClosed(e.target.checked)}
        />
        <Button size="sm" variant="outline-primary" onClick={() => setCreating((v) => !v)}>
          {creating ? 'Cancel create' : 'Create ticket'}
        </Button>
      </div>
      {creating ? (
        <div className="border rounded p-3 mb-3">
          <h3 className="h6 mb-3">New ticket — {locationLabel}</h3>
          <LocationTicketForm
            busy={createBusy}
            onCancel={() => setCreating(false)}
            onSubmit={onCreate}
          />
        </div>
      ) : null}
      {loading ? (
        <div className="text-center py-3">
          <Spinner animation="border" size="sm" aria-hidden />
        </div>
      ) : tickets.length === 0 ? (
        <p className="text-muted small mb-0">No tickets for this location yet.</p>
      ) : (
        <ul className="list-unstyled mb-0">
          {tickets.map((ticket) => (
            <li key={ticket.id} className="border rounded p-2 mb-2">
              <button
                type="button"
                className="btn btn-link p-0 text-start w-100 text-decoration-none"
                onClick={() => setSelectedTicketId(ticket.id)}
              >
                <div className="d-flex align-items-start justify-content-between gap-2">
                  <div>
                    <div className="small text-muted">#{ticket.id}</div>
                    <strong>{ticket.title}</strong>
                    {ticket.tags.length > 0 ? (
                      <div className="d-flex flex-wrap gap-1 mt-1">
                        {ticket.tags.map((tag) => (
                          <Badge key={tag} bg="light" text="dark">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                    {ticket.description ? (
                      <p className="small text-muted mb-0 mt-1">{ticket.description}</p>
                    ) : null}
                  </div>
                  <Badge bg={ticketStatusBadgeVariant(ticket.status)}>
                    {TICKET_STATUS_LABELS[ticket.status]}
                  </Badge>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

type ModalProps = Props & {
  show: boolean
  onHide: () => void
}

export function LocationTicketsPanelModal({
  show,
  onHide,
  locationLabel,
  ...panelProps
}: ModalProps) {
  return (
    <Modal
      show={show}
      onHide={onHide}
      size="lg"
      centered
      className="location-ticket-modal"
      contentClassName="location-ticket-modal__content"
    >
      <Modal.Header closeButton>
        <Modal.Title className="h6 mb-0">Tickets — {locationLabel}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <LocationTicketsPanel {...panelProps} locationLabel={locationLabel} />
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" size="sm" onClick={onHide}>
          Close
        </Button>
      </Modal.Footer>
    </Modal>
  )
}
