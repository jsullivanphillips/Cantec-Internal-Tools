import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge, Button, Card, Form, Modal, Table } from 'react-bootstrap'
import { apiJson, isAbortError } from '../lib/apiClient'
import {
  fetchMonitoringCompanies,
  invalidateMonitoringCompaniesCache,
} from '../features/monthlyRoutes/monitoringCompaniesShared'
import type { MonitoringCompanySummary } from '../features/monthlyRoutes/monthlyRoutesShared'

type EditForm = {
  name: string
  primary_phone: string
  secondary_phone: string
  active: boolean
}

function emptyForm(): EditForm {
  return { name: '', primary_phone: '', secondary_phone: '', active: true }
}

export default function MonitoringCompaniesPage() {
  const [companies, setCompanies] = useState<MonitoringCompanySummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<MonitoringCompanySummary | null>(null)
  const [form, setForm] = useState<EditForm>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      invalidateMonitoringCompaniesCache()
      const rows = await fetchMonitoringCompanies(false)
      setCompanies(rows)
    } catch (err) {
      if (!isAbortError(err)) {
        setError(err instanceof Error ? err.message : 'Unable to load monitoring companies.')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return companies.filter((row) => {
      if (!showInactive && row.active === false) return false
      if (!q) return true
      return (row.name ?? '').toLowerCase().includes(q)
    })
  }, [companies, query, showInactive])

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm())
    setSaveError(null)
    setModalOpen(true)
  }

  const openEdit = (row: MonitoringCompanySummary) => {
    setEditing(row)
    setForm({
      name: row.name ?? '',
      primary_phone: row.primary_phone ?? '',
      secondary_phone: row.secondary_phone ?? '',
      active: row.active !== false,
    })
    setSaveError(null)
    setModalOpen(true)
  }

  const save = async () => {
    const name = form.name.trim()
    if (!name) {
      setSaveError('Name is required.')
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      if (editing) {
        await apiJson(`/api/monitoring_companies/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name,
            primary_phone: form.primary_phone.trim() || null,
            secondary_phone: form.secondary_phone.trim() || null,
            active: form.active,
          }),
        })
      } else {
        await apiJson('/api/monitoring_companies', {
          method: 'POST',
          body: JSON.stringify({
            name,
            primary_phone: form.primary_phone.trim() || null,
            secondary_phone: form.secondary_phone.trim() || null,
          }),
        })
      }
      setModalOpen(false)
      await load()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Unable to save monitoring company.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="monthly-page d-flex flex-column gap-3">
      <Card className="app-surface-card monthly-filters-card">
        <Card.Body className="p-3 p-md-4">
          <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-1">
            <h1 className="processing-page-title mb-0">Monitoring companies</h1>
            <Button size="sm" onClick={openCreate}>
              Add company
            </Button>
          </div>
          <p className="text-muted small mb-3">
            Directory used on monthly worksheets for monitoring vendor name and phone numbers.
          </p>
          <div className="d-flex flex-wrap align-items-end gap-3">
            <Form.Control
              placeholder="Search by name"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ maxWidth: 360 }}
            />
            <Form.Check
              type="switch"
              id="monitoring-companies-show-inactive"
              label="Show inactive"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
          </div>
        </Card.Body>
      </Card>

      <Card className="app-surface-card monthly-results-card">
        <Card.Body className="p-0">
          {error ? (
            <p className="text-danger small p-3 mb-0" role="alert">
              {error}
            </p>
          ) : loading ? (
            <p className="text-muted small p-3 mb-0">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="text-muted small p-3 mb-0">No monitoring companies match your filters.</p>
          ) : (
            <Table responsive hover className="mb-0 align-middle">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Primary phone</th>
                  <th>Secondary phone</th>
                  <th>Status</th>
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id}>
                    <td>{row.name?.trim() || '—'}</td>
                    <td>{row.primary_phone?.trim() || '—'}</td>
                    <td>{row.secondary_phone?.trim() || '—'}</td>
                    <td>
                      {row.active === false ? (
                        <Badge bg="secondary">Inactive</Badge>
                      ) : (
                        <Badge bg="success">Active</Badge>
                      )}
                    </td>
                    <td className="text-end">
                      <Button variant="outline-primary" size="sm" onClick={() => openEdit(row)}>
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>

      <Modal show={modalOpen} onHide={() => setModalOpen(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>{editing ? 'Edit monitoring company' : 'Add monitoring company'}</Modal.Title>
        </Modal.Header>
        <Modal.Body className="d-flex flex-column gap-3">
          {saveError ? <div className="text-danger small">{saveError}</div> : null}
          <Form.Group>
            <Form.Label>Name</Form.Label>
            <Form.Control
              value={form.name}
              disabled={saving}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            />
          </Form.Group>
          <Form.Group>
            <Form.Label>Primary phone</Form.Label>
            <Form.Control
              value={form.primary_phone}
              disabled={saving}
              onChange={(e) => setForm((prev) => ({ ...prev, primary_phone: e.target.value }))}
            />
          </Form.Group>
          <Form.Group>
            <Form.Label>Secondary phone</Form.Label>
            <Form.Control
              value={form.secondary_phone}
              disabled={saving}
              onChange={(e) => setForm((prev) => ({ ...prev, secondary_phone: e.target.value }))}
            />
          </Form.Group>
          {editing ? (
            <Form.Check
              type="switch"
              id="monitoring-company-active"
              label="Active"
              checked={form.active}
              disabled={saving}
              onChange={(e) => setForm((prev) => ({ ...prev, active: e.target.checked }))}
            />
          ) : null}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => setModalOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  )
}
