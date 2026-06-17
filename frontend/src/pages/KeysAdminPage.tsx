import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Alert, Button, Card, Col, Form, Modal, Row, Spinner, Table } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import type { LibraryLocation } from '../features/monthlyRoutes/monthlyRoutesShared'
import KeyMonthlyLocationPicker from '../features/keys/KeyMonthlyLocationPicker'
import {
  createKey,
  deleteKey,
  fetchKeyAdminDetail,
  fetchKeyDeleteBlockers,
  filterAdditionalKeyAddresses,
  linkedMonthlyLocationToLibraryLocation,
  searchKeys,
  updateKey,
  type KeyDeleteBlockers,
  type KeySearchHit,
} from '../features/keys/keysAdminShared'
import KeyDeleteBlockersPanel from '../features/keys/KeyDeleteBlockersPanel'
import { PROCESSING_PAGE_TITLE_COMPACT_CLASS } from '../styles/pageTypography'

export default function KeysAdminPage() {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<KeySearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<KeySearchHit | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [blockers, setBlockers] = useState<KeyDeleteBlockers | null>(null)

  const [formKeycode, setFormKeycode] = useState('')
  const [formBarcode, setFormBarcode] = useState('')
  const [formRoute, setFormRoute] = useState('')
  const [formHome, setFormHome] = useState('')
  const [formArea, setFormArea] = useState('')
  const [formAddresses, setFormAddresses] = useState('')
  const [selectedMonthlyLocations, setSelectedMonthlyLocations] = useState<LibraryLocation[]>([])
  const [loadingDetail, setLoadingDetail] = useState(false)

  const trimmedQuery = query.trim()

  useEffect(() => {
    const q = trimmedQuery
    if (q.length < 2) {
      setHits([])
      return
    }
    const t = window.setTimeout(() => {
      setSearching(true)
      void searchKeys(q)
        .then(setHits)
        .catch(() => setHits([]))
        .finally(() => setSearching(false))
    }, 250)
    return () => window.clearTimeout(t)
  }, [trimmedQuery])

  const resultSummary = useMemo(() => {
    if (trimmedQuery.length < 2) return 'Enter at least 2 characters to search'
    if (searching) return null
    if (hits.length === 0) return 'No keys found'
    return `${hits.length} key${hits.length === 1 ? '' : 's'}`
  }, [hits.length, searching, trimmedQuery.length])

  const loadBlockers = useCallback(async (keyId: number) => {
    try {
      setBlockers(await fetchKeyDeleteBlockers(keyId))
    } catch {
      setBlockers(null)
    }
  }, [])

  const closeModal = () => {
    setShowCreate(false)
    setSelected(null)
    setError(null)
    setBlockers(null)
  }

  const openEdit = (hit: KeySearchHit) => {
    setSelected(hit)
    setFormKeycode(hit.keycode)
    setFormBarcode(hit.barcode != null ? String(hit.barcode) : '')
    setFormRoute(hit.route?.trim() || '')
    setFormHome('')
    setFormArea('')
    setFormAddresses('')
    setSelectedMonthlyLocations([])
    setError(null)
    setBlockers(null)
    setLoadingDetail(true)
    void fetchKeyAdminDetail(hit.id)
      .then((detail) => {
        setFormHome(detail.home_location?.trim() || '')
        setFormArea(detail.area?.trim() || '')
        const linked = detail.linked_monthly_locations ?? []
        setSelectedMonthlyLocations(linked.map(linkedMonthlyLocationToLibraryLocation))
        setFormAddresses(filterAdditionalKeyAddresses(detail.addresses, linked))
      })
      .catch(() => {
        setFormAddresses(hit.addresses.join('\n'))
      })
      .finally(() => setLoadingDetail(false))
  }

  const openCreate = () => {
    setSelected(null)
    setFormKeycode('')
    setFormBarcode('')
    setFormRoute('')
    setFormHome('')
    setFormArea('')
    setFormAddresses('')
    setSelectedMonthlyLocations([])
    setLoadingDetail(false)
    setBlockers(null)
    setError(null)
    setShowCreate(true)
  }

  const onSave = async (e: FormEvent) => {
    e.preventDefault()
    const keycode = formKeycode.trim()
    if (!keycode) {
      setError('Keycode is required')
      return
    }
    const addresses = formAddresses
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    const barcodeRaw = formBarcode.trim()
    const payload = {
      keycode,
      barcode: barcodeRaw ? parseInt(barcodeRaw, 10) : null,
      route: formRoute.trim() || null,
      home_location: formHome.trim() || null,
      area: formArea.trim() || null,
      addresses,
      monthly_location_ids: selectedMonthlyLocations.map((loc) => loc.id),
    }
    setSaving(true)
    setError(null)
    try {
      if (selected) {
        await updateKey(selected.id, payload)
      } else {
        await createKey(payload)
      }
      setShowCreate(false)
      setSelected(null)
      setQuery(keycode)
    } catch {
      setError('Save failed — keycode or barcode may already exist.')
    } finally {
      setSaving(false)
    }
  }

  const onDelete = async () => {
    if (!selected) return
    if (!window.confirm(`Delete key ${selected.keycode}?`)) return
    setSaving(true)
    setError(null)
    setBlockers(null)
    try {
      await deleteKey(selected.id)
      setSelected(null)
      setBlockers(null)
      setHits((prev) => prev.filter((h) => h.id !== selected.id))
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : ''
      if (code === 'monthly_location_linked') {
        setError('Cannot delete — clear monthly location links first (see below).')
        if (selected) void loadBlockers(selected.id)
      } else {
        setError('Delete failed.')
      }
    } finally {
      setSaving(false)
    }
  }

  const editOpen = selected != null && !showCreate
  const modalOpen = showCreate || editOpen

  return (
    <div className="keys-admin-page monthly-page d-flex flex-column gap-3">
      <Card className="app-surface-card monthly-filters-card monthly-hero-card">
        <Card.Body className="monthly-hero-card__body">
          <Link to="/keys" className="keys-admin-page__back text-decoration-none">
            <i className="bi bi-arrow-left" aria-hidden />
            Keys
          </Link>
          <div className="monthly-hero-card__row mt-2">
            <div className="min-w-0">
              <h1 className={`${PROCESSING_PAGE_TITLE_COMPACT_CLASS} m-0`}>Key Management</h1>
              <p className="processing-page-subtitle mb-0 mt-1">
                Staff-only registry. Technicians use the public{' '}
                <Link to="/keys" className="keys-admin-page__inline-link">
                  keys tool
                </Link>{' '}
                for sign-out and return.
              </p>
            </div>
            <div className="monthly-hero-card__controls">
              <Button
                type="button"
                variant="primary"
                size="sm"
                className="fw-semibold text-nowrap rounded-pill px-3"
                onClick={openCreate}
              >
                <i className="bi bi-plus-lg me-1" aria-hidden />
                New key
              </Button>
            </div>
          </div>
        </Card.Body>
      </Card>

      <Card className="app-surface-card monthly-results-card keys-admin-results-card">
        <Card.Body className="monthly-results-body">
          <div className="monthly-table-search py-2">
            <div className="app-topbar-location-search">
              <div className="app-topbar-location-search__field">
                <i className="bi bi-search app-topbar-location-search__icon" aria-hidden />
                <Form.Control
                  type="search"
                  size="sm"
                  className="app-topbar-location-search__input"
                  placeholder="Search by keycode, barcode, or address…"
                  aria-label="Search keys"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="keys-admin-results-bar border-bottom py-2">
            {searching ? (
              <span className="d-inline-flex align-items-center gap-2 small text-muted">
                <Spinner animation="border" size="sm" />
                Searching…
              </span>
            ) : (
              <span className="small text-muted">{resultSummary}</span>
            )}
          </div>

          {trimmedQuery.length >= 2 && !searching && hits.length > 0 ? (
            <Table responsive hover className="mb-0 align-middle keys-admin-table">
              <thead>
                <tr>
                  <th>Keycode</th>
                  <th>Route</th>
                  <th className="d-none d-md-table-cell">Address</th>
                  <th className="keys-admin-table__action-col" aria-hidden />
                </tr>
              </thead>
              <tbody>
                {hits.map((hit) => (
                  <tr
                    key={hit.id}
                    className="keys-admin-table__row"
                    tabIndex={0}
                    role="button"
                    onClick={() => openEdit(hit)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        openEdit(hit)
                      }
                    }}
                  >
                    <td className="keys-admin-table__keycode">{hit.keycode}</td>
                    <td className="text-muted">{hit.route?.trim() || '—'}</td>
                    <td className="text-muted d-none d-md-table-cell">
                      {hit.addresses[0]?.trim() || '—'}
                    </td>
                    <td className="keys-admin-table__action-col text-end">
                      <i className="bi bi-chevron-right text-muted" aria-hidden />
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : null}
        </Card.Body>
      </Card>

      <Modal
        show={modalOpen}
        onHide={closeModal}
        size="lg"
        centered
        className="keys-admin-modal"
        contentClassName="keys-admin-modal__content"
      >
        <Modal.Header closeButton className="keys-admin-modal__header">
          <Modal.Title className="keys-admin-modal__title mb-0">
            {selected ? `Edit ${selected.keycode}` : 'New key'}
          </Modal.Title>
        </Modal.Header>
        <Form onSubmit={(e) => void onSave(e)}>
          <Modal.Body className="keys-admin-modal__body">
            {error ? (
              <Alert variant="danger" className="py-2 small mb-3">
                {error}
              </Alert>
            ) : null}

            <div className="keys-admin-modal__section">
              <div className="keys-admin-modal__section-title">Identity</div>
              <Row className="g-2">
                <Col md={7}>
                  <Form.Group>
                    <Form.Label className="keys-admin-modal__label">Keycode</Form.Label>
                    <Form.Control
                      size="sm"
                      value={formKeycode}
                      onChange={(e) => setFormKeycode(e.target.value)}
                      required
                    />
                  </Form.Group>
                </Col>
                <Col md={5}>
                  <Form.Group>
                    <Form.Label className="keys-admin-modal__label">Barcode</Form.Label>
                    <Form.Control
                      size="sm"
                      value={formBarcode}
                      onChange={(e) => setFormBarcode(e.target.value)}
                    />
                  </Form.Group>
                </Col>
              </Row>
            </div>

            <div className="keys-admin-modal__section">
              <div className="keys-admin-modal__section-title">Assignment</div>
              <Row className="g-2">
                <Col md={4}>
                  <Form.Group>
                    <Form.Label className="keys-admin-modal__label">Route bag</Form.Label>
                    <Form.Control
                      size="sm"
                      value={formRoute}
                      onChange={(e) => setFormRoute(e.target.value)}
                      placeholder="R7"
                    />
                  </Form.Group>
                </Col>
                <Col md={4}>
                  <Form.Group>
                    <Form.Label className="keys-admin-modal__label">Home location</Form.Label>
                    <Form.Control
                      size="sm"
                      value={formHome}
                      onChange={(e) => setFormHome(e.target.value)}
                    />
                  </Form.Group>
                </Col>
                <Col md={4}>
                  <Form.Group>
                    <Form.Label className="keys-admin-modal__label">Area</Form.Label>
                    <Form.Control
                      size="sm"
                      value={formArea}
                      onChange={(e) => setFormArea(e.target.value)}
                    />
                  </Form.Group>
                </Col>
              </Row>
            </div>

            <div className="keys-admin-modal__section">
              <div className="keys-admin-modal__section-title">Monthly locations</div>
              <p className="keys-admin-modal__hint mb-2">
                Link library locations to this key. Their addresses are added automatically.
              </p>
              {loadingDetail ? (
                <div className="d-flex align-items-center gap-2 text-muted small mb-2">
                  <Spinner animation="border" size="sm" />
                  Loading linked locations…
                </div>
              ) : null}
              <KeyMonthlyLocationPicker
                selected={selectedMonthlyLocations}
                onChange={setSelectedMonthlyLocations}
                editingKeyId={selected?.id ?? null}
                disabled={saving || loadingDetail}
              />
            </div>

            <div className="keys-admin-modal__section mb-0">
              <div className="keys-admin-modal__section-title">Additional addresses</div>
              <p className="keys-admin-modal__hint mb-2">
                Optional free-text addresses not in the monthly library (one per line).
              </p>
              <Form.Control
                as="textarea"
                rows={2}
                size="sm"
                value={formAddresses}
                disabled={saving || loadingDetail}
                onChange={(e) => setFormAddresses(e.target.value)}
              />
            </div>

            {blockers ? (
              <div className="mt-3">
                <KeyDeleteBlockersPanel blockers={blockers} />
              </div>
            ) : null}
          </Modal.Body>
          <Modal.Footer className="keys-admin-modal__footer">
            {selected ? (
              <Button
                type="button"
                variant="outline-danger"
                size="sm"
                className="me-auto"
                disabled={saving}
                onClick={() => void onDelete()}
              >
                Delete
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline-secondary"
              size="sm"
              disabled={saving}
              onClick={closeModal}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </div>
  )
}
