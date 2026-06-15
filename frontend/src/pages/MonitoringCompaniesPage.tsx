import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Form, Modal, Table } from 'react-bootstrap'
import HeroFilterPill from '../components/HeroFilterPill'
import { apiJson, isAbortError } from '../lib/apiClient'
import {
  fetchMonitoringCompanies,
  invalidateMonitoringCompaniesCache,
} from '../features/monthlyRoutes/monitoringCompaniesShared'
import type { MonitoringCompanySummary } from '../features/monthlyRoutes/monthlyRoutesShared'
import { PROCESSING_PAGE_TITLE_COMPACT_CLASS } from '../styles/pageTypography'

type EditForm = {
  name: string
  primary_phone: string
  secondary_phone: string
  active: boolean
}

function emptyForm(): EditForm {
  return { name: '', primary_phone: '', secondary_phone: '', active: true }
}

function MonitoringCompanyStatus({ active }: { active: boolean }) {
  return (
    <span
      className={`monitoring-companies-status${
        active ? ' monitoring-companies-status--active' : ' monitoring-companies-status--inactive'
      }`}
    >
      {active ? 'Active' : 'Inactive'}
    </span>
  )
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

  const resultSummary = useMemo(() => {
    if (loading) return null
    if (filtered.length === 0) return 'No companies'
    return `${filtered.length} compan${filtered.length === 1 ? 'y' : 'ies'}`
  }, [filtered.length, loading])

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
      <Card className="app-surface-card monthly-filters-card monthly-hero-card">
        <Card.Body className="monthly-hero-card__body">
          <div className="monthly-hero-card__row">
            <h1 className={`${PROCESSING_PAGE_TITLE_COMPACT_CLASS} m-0`}>Monitoring companies</h1>
            <div className="monthly-hero-card__controls">
              <Button
                size="sm"
                variant="primary"
                className="fw-semibold text-nowrap rounded-pill px-3"
                onClick={openCreate}
              >
                <i className="bi bi-plus-lg me-1" aria-hidden />
                Add company
              </Button>
            </div>
          </div>
          <div
            className="run-review-filter monthly-hero-card__filter-pills mt-2"
            role="group"
            aria-label="Monitoring company filters"
          >
            <HeroFilterPill
              id="monitoring-companies-show-inactive"
              icon="bi-eye"
              label="Show inactive"
              checked={showInactive}
              onChange={setShowInactive}
            />
          </div>
        </Card.Body>
      </Card>

      <Card className="app-surface-card monthly-results-card monitoring-companies-results-card">
        <Card.Body className="monthly-results-body">
          <div className="monthly-table-search py-2">
            <div className="app-topbar-location-search">
              <div className="app-topbar-location-search__field">
                <i className="bi bi-search app-topbar-location-search__icon" aria-hidden />
                <Form.Control
                  type="search"
                  size="sm"
                  className="app-topbar-location-search__input"
                  value={query}
                  placeholder="Search by name…"
                  aria-label="Search monitoring companies"
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="monitoring-companies-results-bar border-bottom py-2">
            {loading ? (
              <span
                className="home-skeleton-bar d-inline-block"
                style={{ width: '7rem', height: '0.85rem' }}
                aria-hidden
              />
            ) : (
              <span className="small text-muted">{resultSummary}</span>
            )}
          </div>

          {error ? (
            <p className="text-danger small mb-0 pt-3" role="alert">
              {error}
            </p>
          ) : loading ? (
            <p className="text-muted small mb-0 pt-3">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="text-muted small mb-0 pt-3">No monitoring companies match your filters.</p>
          ) : (
            <Table responsive striped hover className="mb-0 align-middle monitoring-companies-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Primary phone</th>
                  <th>Secondary phone</th>
                  <th className="text-center">Status</th>
                  <th className="text-end monitoring-companies-table__actions-col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const isActive = row.active !== false
                  return (
                    <tr key={row.id}>
                      <td className="fw-semibold">{row.name?.trim() || '—'}</td>
                      <td className="tabular-nums text-muted">
                        {row.primary_phone?.trim() || '—'}
                      </td>
                      <td className="tabular-nums text-muted">
                        {row.secondary_phone?.trim() || '—'}
                      </td>
                      <td className="text-center">
                        <MonitoringCompanyStatus active={isActive} />
                      </td>
                      <td className="text-end">
                        <Button
                          variant="outline-secondary"
                          size="sm"
                          className="monitoring-companies-table__edit-btn"
                          onClick={() => openEdit(row)}
                        >
                          <i className="bi bi-pencil" aria-hidden />
                          Edit
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>

      <Modal
        show={modalOpen}
        onHide={() => setModalOpen(false)}
        centered
        className="monitoring-companies-modal"
      >
        <Modal.Header closeButton className="monitoring-companies-modal__header">
          <Modal.Title className="monitoring-companies-modal__title">
            {editing ? 'Edit monitoring company' : 'Add monitoring company'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body className="monitoring-companies-modal__body d-flex flex-column gap-3">
          {saveError ? <div className="text-danger small">{saveError}</div> : null}
          <Form.Group>
            <Form.Label className="monitoring-companies-modal__label">Name</Form.Label>
            <Form.Control
              size="sm"
              value={form.name}
              disabled={saving}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            />
          </Form.Group>
          <Form.Group>
            <Form.Label className="monitoring-companies-modal__label">Primary phone</Form.Label>
            <Form.Control
              size="sm"
              value={form.primary_phone}
              disabled={saving}
              onChange={(e) => setForm((prev) => ({ ...prev, primary_phone: e.target.value }))}
            />
          </Form.Group>
          <Form.Group>
            <Form.Label className="monitoring-companies-modal__label">Secondary phone</Form.Label>
            <Form.Control
              size="sm"
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
        <Modal.Footer className="monitoring-companies-modal__footer">
          <Button variant="outline-secondary" size="sm" onClick={() => setModalOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  )
}
