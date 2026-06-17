import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Alert, Button, Card, Form, Modal, Spinner, Table } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import {
  createNonQuoteablePhrase,
  deleteNonQuoteablePhrase,
  fetchNonQuoteablePhrases,
  PhraseAdminApiError,
  reclassifyDeficiencies,
  updateNonQuoteablePhrase,
  type NonQuoteablePhrase,
  type ReclassifySummary,
} from '../features/mondayMeeting/mondayMeetingServiceAdminShared'
import {
  ALL_TIME_QUARTER_KEY,
  defaultServiceQuarterKey,
  listServiceQuarterSelectItems,
} from '../features/mondayMeeting/mondayMeetingServiceDateRange'
import ServiceQuarterAllTimeInfo from '../features/mondayMeeting/ServiceQuarterAllTimeInfo'
import '../features/mondayMeeting/mondayMeeting.css'

export default function MondayMeetingServiceAdminPage() {
  const quarterOptions = useMemo(() => listServiceQuarterSelectItems(), [])
  const [selectedQuarterKey, setSelectedQuarterKey] = useState(defaultServiceQuarterKey())
  const selectedQuarter =
    quarterOptions.find((option) => option.key === selectedQuarterKey) ?? quarterOptions[0]
  const startDate = selectedQuarter?.startDate ?? ''
  const endDate = selectedQuarter?.endDate ?? ''
  const [phrases, setPhrases] = useState<NonQuoteablePhrase[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveNotice, setSaveNotice] = useState<string | null>(null)
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
      const data = await fetchNonQuoteablePhrases(startDate, endDate)
      setPhrases(data.phrases)
    } catch {
      setError('Failed to load phrases.')
    } finally {
      setLoading(false)
    }
  }, [startDate, endDate])

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
    setSaveNotice(null)
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
      setSaveNotice(
        'Phrase saved. Reclassification is running in the background — refresh the Service tab in a minute to see updated exclusions.',
      )
      await load()
    } catch (err) {
      if (err instanceof PhraseAdminApiError && err.status === 409) {
        const existing = (err.body as { phrase?: NonQuoteablePhrase } | null)?.phrase
        setError(
          existing
            ? `Phrase "${existing.phrase}" is already in the list${existing.active ? '' : ' (currently inactive)'}. Edit that row instead of adding a duplicate.`
            : 'That phrase already exists. Check the table below or edit the existing entry.',
        )
        await load()
      } else if (err instanceof PhraseAdminApiError) {
        setError(err.message)
      } else {
        setError('Save failed. Check your connection and try again.')
      }
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

          {saveNotice ? (
            <Alert variant="success" className="py-2 small">
              {saveNotice}
            </Alert>
          ) : null}

          <div className="d-flex flex-wrap align-items-center gap-3 mb-3">
            <span className="text-muted small text-uppercase fw-bold" style={{ letterSpacing: '0.08em' }}>
              Quarter
            </span>
            <div className="monday-meeting-service-quarter-select-wrap">
              <Form.Select
                size="sm"
                className="monday-meeting-service-quarter-control"
                value={selectedQuarterKey}
                aria-label="Reporting quarter"
                onChange={(e) => setSelectedQuarterKey(e.target.value)}
              >
                {quarterOptions.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
              </Form.Select>
              {selectedQuarterKey === ALL_TIME_QUARTER_KEY ? (
                <ServiceQuarterAllTimeInfo startDate={startDate} endDate={endDate} />
              ) : null}
            </div>
            <span className="text-muted small">
              Match counts use deficiencies reported in this quarter (same as Service tab).
            </span>
          </div>

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
                  <th className="text-end">Matches</th>
                  <th>Active</th>
                  <th>Notes</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {phrases.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-muted">
                      No phrases yet.
                    </td>
                  </tr>
                ) : (
                  phrases.map((row) => (
                    <tr key={row.id}>
                      <td>{row.phrase}</td>
                      <td>{row.label ?? '—'}</td>
                      <td className="text-end tabular-nums">{row.matches_in_range ?? 0}</td>
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
