import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Alert, Button, Card, Form, Modal, Spinner, Table } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import {
  createNonQuoteablePhrase,
  deleteNonQuoteablePhrase,
  fetchNonQuoteablePhrases,
  reclassifyDeficiencies,
  updateNonQuoteablePhrase,
  type NonQuoteablePhrase,
  type ReclassifySummary,
} from '../features/mondayMeeting/mondayMeetingServiceAdminShared'

export default function MondayMeetingServiceAdminPage() {
  const [phrases, setPhrases] = useState<NonQuoteablePhrase[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [reclassifying, setReclassifying] = useState(false)
  const [lastSummary, setLastSummary] = useState<ReclassifySummary | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<NonQuoteablePhrase | null>(null)
  const [formPhrase, setFormPhrase] = useState('')
  const [formLabel, setFormLabel] = useState('')
  const [formNotes, setFormNotes] = useState('')
  const [formActive, setFormActive] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setPhrases(await fetchNonQuoteablePhrases())
    } catch {
      setError('Failed to load phrases.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const openCreate = () => {
    setEditing(null)
    setFormPhrase('')
    setFormLabel('')
    setFormNotes('')
    setFormActive(true)
    setShowModal(true)
  }

  const openEdit = (row: NonQuoteablePhrase) => {
    setEditing(row)
    setFormPhrase(row.phrase)
    setFormLabel(row.label ?? '')
    setFormNotes(row.notes ?? '')
    setFormActive(row.active)
    setShowModal(true)
  }

  const onSave = async (e: FormEvent) => {
    e.preventDefault()
    const phrase = formPhrase.trim()
    if (!phrase) {
      setError('Phrase is required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (editing) {
        await updateNonQuoteablePhrase(editing.id, {
          phrase,
          label: formLabel.trim() || null,
          notes: formNotes.trim() || null,
          active: formActive,
        })
      } else {
        await createNonQuoteablePhrase({
          phrase,
          label: formLabel.trim() || undefined,
          notes: formNotes.trim() || undefined,
          active: formActive,
        })
      }
      setShowModal(false)
      await load()
    } catch {
      setError('Save failed — phrase may already exist.')
    } finally {
      setSaving(false)
    }
  }

  const onDelete = async (row: NonQuoteablePhrase) => {
    if (!window.confirm(`Delete phrase "${row.phrase}"?`)) return
    setError(null)
    try {
      await deleteNonQuoteablePhrase(row.id)
      await load()
    } catch {
      setError('Delete failed.')
    }
  }

  const onReclassify = async () => {
    setReclassifying(true)
    setError(null)
    try {
      const summary = await reclassifyDeficiencies()
      setLastSummary(summary)
    } catch {
      setError('Reclassification failed.')
    } finally {
      setReclassifying(false)
    }
  }

  return (
    <div className="container-fluid py-3 px-2 d-flex flex-column gap-3">
      <Card className="app-surface-card">
        <Card.Body className="p-3 p-md-4">
          <div className="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
            <div>
              <h1 className="processing-page-title mb-1">Service deficiency filters</h1>
              <p className="processing-page-subtitle mb-0">
                Manage keyword phrases that exclude record-only deficiencies from Monday Meeting service KPIs.
              </p>
            </div>
            <Link to="/monday_meeting?tab=service" className="btn btn-outline-secondary btn-sm">
              Back to Service tab
            </Link>
          </div>

          <Alert variant="light" className="small mb-3">
            <strong>Similar unquoted cluster rule:</strong> after 90 business days without a quote, deficiencies
            with similar descriptions are grouped automatically. Clusters of 2 or more where no member was ever
            quoted are excluded from service metrics.
          </Alert>

          {error ? (
            <Alert variant="warning" className="py-2 small">
              {error}
            </Alert>
          ) : null}

          <div className="d-flex flex-wrap gap-2 mb-3">
            <Button type="button" variant="primary" size="sm" onClick={openCreate}>
              Add phrase
            </Button>
            <Button
              type="button"
              variant="outline-primary"
              size="sm"
              onClick={() => void onReclassify()}
              disabled={reclassifying}
            >
              {reclassifying ? 'Reclassifying…' : 'Reclassify all deficiencies'}
            </Button>
          </div>

          {lastSummary ? (
            <Alert variant="success" className="py-2 small">
              Last run: {lastSummary.eligible} eligible, {lastSummary.excluded_keyword} keyword,{' '}
              {lastSummary.excluded_stale_cluster} stale cluster ({lastSummary.classified_at})
            </Alert>
          ) : null}

          {loading ? (
            <div className="text-center py-4">
              <Spinner />
            </div>
          ) : (
            <Table responsive striped bordered hover size="sm" className="mb-0">
              <thead>
                <tr>
                  <th>Phrase</th>
                  <th>Label</th>
                  <th>Active</th>
                  <th>Notes</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {phrases.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-muted">
                      No phrases yet.
                    </td>
                  </tr>
                ) : (
                  phrases.map((row) => (
                    <tr key={row.id}>
                      <td>{row.phrase}</td>
                      <td>{row.label ?? '—'}</td>
                      <td>{row.active ? 'Yes' : 'No'}</td>
                      <td className="text-muted small">{row.notes ?? '—'}</td>
                      <td className="text-nowrap">
                        <Button type="button" size="sm" variant="link" onClick={() => openEdit(row)}>
                          Edit
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="link"
                          className="text-danger"
                          onClick={() => void onDelete(row)}
                        >
                          Delete
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>

      <Modal show={showModal} onHide={() => setShowModal(false)} centered>
        <Form onSubmit={(e) => void onSave(e)}>
          <Modal.Header closeButton>
            <Modal.Title>{editing ? 'Edit phrase' : 'Add phrase'}</Modal.Title>
          </Modal.Header>
          <Modal.Body className="d-flex flex-column gap-3">
            <Form.Group>
              <Form.Label>Phrase</Form.Label>
              <Form.Control
                value={formPhrase}
                onChange={(e) => setFormPhrase(e.target.value)}
                placeholder="e.g. fire safety plan"
                required
              />
            </Form.Group>
            <Form.Group>
              <Form.Label>Label</Form.Label>
              <Form.Control
                value={formLabel}
                onChange={(e) => setFormLabel(e.target.value)}
                placeholder="Display name (optional)"
              />
            </Form.Group>
            <Form.Group>
              <Form.Label>Notes</Form.Label>
              <Form.Control
                as="textarea"
                rows={2}
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
              />
            </Form.Group>
            <Form.Check
              type="switch"
              id="phrase-active"
              label="Active"
              checked={formActive}
              onChange={(e) => setFormActive(e.target.checked)}
            />
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShowModal(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </div>
  )
}
