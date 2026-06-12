import { useCallback, useEffect, useState } from 'react'
import { apiJson } from '../../lib/apiClient'
import { Alert, Badge, Button, Form, Modal, Table } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import LocationTicketDetail from './LocationTicketDetail'
import LocationTicketCreateFromSearchModal from './LocationTicketCreateFromSearchModal'
import {
  fetchDashboardTickets,
  TICKET_STATUS_LABELS,
  ticketStatusBadgeVariant,
  type LocationTicket,
} from './locationTicketsShared'

type Props = {
  sessionUsername?: string | null
  onTicketsChanged?: () => void
}

export default function MonthlyTicketsQueue({ sessionUsername = null, onTicketsChanged }: Props) {
  const [tickets, setTickets] = useState<LocationTicket[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [includeClosed, setIncludeClosed] = useState(false)
  const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
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
      const rows = await fetchDashboardTickets(includeClosed)
      setTickets(rows)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tickets.')
      setTickets([])
    } finally {
      setLoading(false)
    }
  }, [includeClosed])

  useEffect(() => {
    void loadTickets()
  }, [loadTickets])

  const refreshAll = () => {
    void loadTickets()
    onTicketsChanged?.()
  }

  return (
    <section className="monthly-tickets-queue">
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
        <h3 className="h5 mb-0">Open tickets</h3>
        <div className="d-flex flex-wrap align-items-center gap-3">
          <Form.Check
            type="switch"
            id="dashboard-show-closed-tickets"
            label="Show closed"
            checked={includeClosed}
            onChange={(e) => setIncludeClosed(e.target.checked)}
          />
          <Button size="sm" variant="primary" onClick={() => setCreateOpen(true)}>
            Create ticket
          </Button>
        </div>
      </div>
      {error ? (
        <Alert variant="danger" className="py-2 small">
          {error}
        </Alert>
      ) : null}
      {loading ? (
        <div className="text-muted">Loading tickets…</div>
      ) : tickets.length === 0 ? (
        <p className="text-muted mb-0">No tickets in this view.</p>
      ) : (
        <div className="table-responsive">
          <Table size="sm" hover className="mb-0 align-middle">
            <thead>
              <tr>
                <th>#</th>
                <th>Title</th>
                <th>Location</th>
                <th>Route</th>
                <th>Tags</th>
                <th>Status</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((ticket) => (
                <tr key={ticket.id}>
                  <td className="tabular-nums">{ticket.id}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-link p-0 text-start"
                      onClick={() => setSelectedTicketId(ticket.id)}
                    >
                      {ticket.title}
                    </button>
                  </td>
                  <td>
                    {ticket.location_label ? (
                      <Link to={`/monthlies/locations/${ticket.location_id}`}>
                        {ticket.location_label}
                      </Link>
                    ) : (
                      `Location ${ticket.location_id}`
                    )}
                  </td>
                  <td>{ticket.route_label ?? '—'}</td>
                  <td>
                    <div className="d-flex flex-wrap gap-1">
                      {ticket.tags.slice(0, 3).map((tag) => (
                        <Badge key={tag} bg="light" text="dark">
                          {tag}
                        </Badge>
                      ))}
                      {ticket.tags.length > 3 ? (
                        <Badge bg="light" text="dark">
                          +{ticket.tags.length - 3}
                        </Badge>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <Badge bg={ticketStatusBadgeVariant(ticket.status)}>
                      {TICKET_STATUS_LABELS[ticket.status]}
                    </Badge>
                  </td>
                  <td className="small text-muted">
                    {ticket.updated_at ? new Date(ticket.updated_at).toLocaleString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      <Modal
        show={selectedTicketId != null}
        onHide={() => setSelectedTicketId(null)}
        size="lg"
        centered
        className="location-ticket-modal"
        contentClassName="location-ticket-modal__content"
      >
        <Modal.Header closeButton>
          <Modal.Title className="h6 mb-0">Ticket details</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {selectedTicketId != null ? (
            <LocationTicketDetail
              ticketId={selectedTicketId}
              sessionUsername={resolvedUsername}
              onTicketUpdated={refreshAll}
            />
          ) : null}
        </Modal.Body>
      </Modal>

      <LocationTicketCreateFromSearchModal
        show={createOpen}
        onHide={() => setCreateOpen(false)}
        onCreated={refreshAll}
      />
    </section>
  )
}
