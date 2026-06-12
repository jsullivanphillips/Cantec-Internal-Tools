import { useCallback, useEffect, useState } from 'react'
import { Alert, Badge, Button, Form, Modal, Spinner } from 'react-bootstrap'
import {
  addTicketComment,
  deleteTicketComment,
  fetchTicketDetail,
  patchLocationTicket,
  patchTicketComment,
  TICKET_CLOSE_REASON_LABELS,
  TICKET_STATUS_LABELS,
  ticketAuthorsMatch,
  ticketStatusBadgeVariant,
  type LocationTicket,
  type LocationTicketCloseReason,
  type LocationTicketComment,
} from './locationTicketsShared'

type Props = {
  ticketId: number
  sessionUsername: string | null
  onTicketUpdated?: (ticket: LocationTicket) => void
  onClose?: () => void
}

export default function LocationTicketDetail({
  ticketId,
  sessionUsername,
  onTicketUpdated,
  onClose,
}: Props) {
  const [ticket, setTicket] = useState<LocationTicket | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [commentDraft, setCommentDraft] = useState('')
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null)
  const [editingCommentBody, setEditingCommentBody] = useState('')
  const [showCloseModal, setShowCloseModal] = useState(false)
  const [closeReason, setCloseReason] = useState<LocationTicketCloseReason>('completed')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const detail = await fetchTicketDetail(ticketId)
      setTicket(detail)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load ticket.')
      setTicket(null)
    } finally {
      setLoading(false)
    }
  }, [ticketId])

  useEffect(() => {
    void load()
  }, [load])

  const applyTicket = (next: LocationTicket) => {
    setTicket(next)
    onTicketUpdated?.(next)
  }

  const changeStatus = async (status: LocationTicket['status'], reason?: LocationTicketCloseReason) => {
    if (!ticket) return
    setBusy(true)
    setError(null)
    try {
      const updated = await patchLocationTicket(ticket.id, {
        status,
        close_reason: reason,
      })
      applyTicket({ ...ticket, ...updated })
      if (status === 'closed') setShowCloseModal(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update ticket.')
    } finally {
      setBusy(false)
    }
  }

  const submitComment = async () => {
    if (!ticket) return
    const body = commentDraft.trim()
    if (!body) return
    setBusy(true)
    setError(null)
    try {
      await addTicketComment(ticket.id, body)
      setCommentDraft('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add comment.')
    } finally {
      setBusy(false)
    }
  }

  const saveCommentEdit = async (comment: LocationTicketComment) => {
    if (!ticket) return
    const body = editingCommentBody.trim()
    if (!body) return
    setBusy(true)
    setError(null)
    try {
      await patchTicketComment(ticket.id, comment.id, body)
      setEditingCommentId(null)
      setEditingCommentBody('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update comment.')
    } finally {
      setBusy(false)
    }
  }

  const removeComment = async (comment: LocationTicketComment) => {
    if (!ticket) return
    setBusy(true)
    setError(null)
    try {
      await deleteTicketComment(ticket.id, comment.id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete comment.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="text-center py-3">
        <Spinner animation="border" size="sm" aria-hidden />
      </div>
    )
  }

  if (!ticket) {
    return <p className="text-muted small mb-0">{error ?? 'Ticket not found.'}</p>
  }

  const isClosed = ticket.status === 'closed'
  const comments = ticket.comments ?? []

  return (
    <div className="location-ticket-detail">
      {error ? (
        <Alert variant="danger" className="py-2 small">
          {error}
        </Alert>
      ) : null}
      <div className="d-flex align-items-start justify-content-between gap-2 mb-2">
        <div>
          <div className="small text-muted mb-1">Ticket #{ticket.id}</div>
          <h3 className="h6 mb-1">{ticket.title}</h3>
          {ticket.location_label ? (
            <div className="small text-muted">{ticket.location_label}</div>
          ) : null}
          {ticket.route_label ? (
            <div className="small text-muted">{ticket.route_label}</div>
          ) : null}
        </div>
        <Badge bg={ticketStatusBadgeVariant(ticket.status)}>
          {TICKET_STATUS_LABELS[ticket.status]}
        </Badge>
      </div>
      {ticket.tags.length > 0 ? (
        <div className="d-flex flex-wrap gap-1 mb-2">
          {ticket.tags.map((tag) => (
            <Badge key={tag} bg="light" text="dark">
              {tag}
            </Badge>
          ))}
        </div>
      ) : null}
      {ticket.description ? <p className="small mb-3">{ticket.description}</p> : null}
      {ticket.close_reason ? (
        <p className="small text-muted mb-3">
          Closed as {TICKET_CLOSE_REASON_LABELS[ticket.close_reason]}
          {ticket.closed_at ? ` · ${new Date(ticket.closed_at).toLocaleString()}` : ''}
        </p>
      ) : null}

      {!isClosed ? (
        <div className="d-flex flex-wrap gap-2 mb-3">
          {ticket.status === 'open' ? (
            <Button
              size="sm"
              variant="outline-primary"
              disabled={busy}
              onClick={() => void changeStatus('in_progress')}
            >
              Mark in progress
            </Button>
          ) : null}
          {ticket.status === 'in_progress' ? (
            <Button
              size="sm"
              variant="outline-secondary"
              disabled={busy}
              onClick={() => void changeStatus('open')}
            >
              Return to open
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline-success"
            disabled={busy}
            onClick={() => setShowCloseModal(true)}
          >
            Close ticket
          </Button>
        </div>
      ) : null}

      <h4 className="h6">Comments</h4>
      {comments.length === 0 ? (
        <p className="text-muted small">No comments yet.</p>
      ) : (
        <ul className="list-unstyled mb-3">
          {comments.map((comment) => {
            const canModify = ticketAuthorsMatch(sessionUsername, comment.created_by)
            const editing = editingCommentId === comment.id
            return (
              <li key={comment.id} className="border rounded p-2 mb-2">
                <div className="d-flex justify-content-between gap-2 small text-muted mb-1">
                  <span>{comment.created_by ?? 'Unknown'}</span>
                  <span>
                    {comment.updated_at && comment.updated_at !== comment.created_at
                      ? `Edited ${new Date(comment.updated_at).toLocaleString()}`
                      : new Date(comment.created_at ?? '').toLocaleString()}
                  </span>
                </div>
                {editing ? (
                  <>
                    <Form.Control
                      as="textarea"
                      rows={2}
                      size="sm"
                      value={editingCommentBody}
                      onChange={(e) => setEditingCommentBody(e.target.value)}
                      className="mb-2"
                    />
                    <div className="d-flex gap-2">
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={busy}
                        onClick={() => void saveCommentEdit(comment)}
                      >
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setEditingCommentId(null)
                          setEditingCommentBody('')
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="small mb-2">{comment.body}</p>
                    {canModify && !isClosed ? (
                      <div className="d-flex gap-2">
                        <Button
                          size="sm"
                          variant="link"
                          className="p-0"
                          onClick={() => {
                            setEditingCommentId(comment.id)
                            setEditingCommentBody(comment.body)
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="link"
                          className="p-0 text-danger"
                          disabled={busy}
                          onClick={() => void removeComment(comment)}
                        >
                          Delete
                        </Button>
                      </div>
                    ) : null}
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {!isClosed ? (
        <>
          <Form.Control
            as="textarea"
            rows={2}
            size="sm"
            value={commentDraft}
            onChange={(e) => setCommentDraft(e.target.value)}
            placeholder="Add a comment"
            className="mb-2"
          />
          <Button
            size="sm"
            variant="outline-primary"
            disabled={busy || !commentDraft.trim()}
            onClick={() => void submitComment()}
          >
            Add comment
          </Button>
        </>
      ) : null}

      {onClose ? (
        <div className="mt-3">
          <Button size="sm" variant="secondary" onClick={onClose}>
            Back
          </Button>
        </div>
      ) : null}

      <Modal show={showCloseModal} onHide={() => setShowCloseModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title className="h6 mb-0">Close ticket</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="small text-muted mb-3">
            Tickets cannot be deleted. Choose how this follow-up was resolved.
          </p>
          <Form.Check
            type="radio"
            id="ticket-close-completed"
            name="ticket-close-reason"
            label="Completed — work was done"
            checked={closeReason === 'completed'}
            onChange={() => setCloseReason('completed')}
          />
          <Form.Check
            type="radio"
            id="ticket-close-invalid"
            name="ticket-close-reason"
            label="Invalid — created by mistake"
            checked={closeReason === 'invalid'}
            onChange={() => setCloseReason('invalid')}
            className="mt-2"
          />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" size="sm" onClick={() => setShowCloseModal(false)}>
            Cancel
          </Button>
          <Button
            variant="success"
            size="sm"
            disabled={busy}
            onClick={() => void changeStatus('closed', closeReason)}
          >
            {busy ? 'Closing…' : 'Close ticket'}
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  )
}
