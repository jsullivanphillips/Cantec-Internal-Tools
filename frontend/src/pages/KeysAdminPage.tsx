import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Alert, Button, Card, Form, ListGroup, Modal, Spinner } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import {
  createKey,
  deleteKey,
  fetchKeyDeleteBlockers,
  searchKeys,
  updateKey,
  type KeyDeleteBlockers,
  type KeySearchHit,
} from '../features/keys/keysAdminShared'
import KeyDeleteBlockersPanel from '../features/keys/KeyDeleteBlockersPanel'

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

  useEffect(() => {
    const q = query.trim()
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
  }, [query])

  const loadBlockers = useCallback(async (keyId: number) => {
    try {
      setBlockers(await fetchKeyDeleteBlockers(keyId))
    } catch {
      setBlockers(null)
    }
  }, [])

  const openEdit = (hit: KeySearchHit) => {
    setSelected(hit)
    setFormKeycode(hit.keycode)
    setFormBarcode(hit.barcode != null ? String(hit.barcode) : '')
    setFormRoute(hit.route?.trim() || '')
    setFormHome('')
    setFormArea('')
    setFormAddresses(hit.addresses.join('\n'))
    setError(null)
    void loadBlockers(hit.id)
  }

  const openCreate = () => {
    setSelected(null)
    setFormKeycode('')
    setFormBarcode('')
    setFormRoute('')
    setFormHome('')
    setFormArea('')
    setFormAddresses('')
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
    try {
      await deleteKey(selected.id)
      setSelected(null)
      setBlockers(null)
      setHits((prev) => prev.filter((h) => h.id !== selected.id))
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : ''
      if (code === 'monthly_location_linked') {
        setError('Cannot delete — clear monthly location links first (see blockers below).')
        if (selected) void loadBlockers(selected.id)
      } else {
        setError('Delete failed.')
      }
    } finally {
      setSaving(false)
    }
  }

  const editOpen = selected != null && !showCreate

  return (
    <div className="container py-4">
      <Link to="/monthlies" className="text-decoration-none small d-inline-block mb-3">
        ← Monthlies
      </Link>
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <h1 className="h4 mb-0">Keys admin</h1>
        <Button type="button" variant="primary" size="sm" onClick={openCreate}>
          New key
        </Button>
      </div>
      <p className="text-muted small">
        Staff-only key registry. Technicians still use the public{' '}
        <Link to="/keys">keys tool</Link> for sign-out and return.
      </p>

      <Card className="mb-3">
        <Card.Body>
          <Form.Control
            type="search"
            placeholder="Search keys…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {searching ? (
            <div className="d-flex align-items-center gap-2 mt-2 text-muted small">
              <Spinner animation="border" size="sm" />
              Searching…
            </div>
          ) : null}
          <ListGroup className="mt-2">
            {hits.map((hit) => (
              <ListGroup.Item key={hit.id} action onClick={() => openEdit(hit)}>
                <span className="fw-semibold">{hit.keycode}</span>
                {hit.route ? <span className="text-muted ms-2">{hit.route}</span> : null}
                {hit.addresses[0] ? <div className="small text-muted">{hit.addresses[0]}</div> : null}
              </ListGroup.Item>
            ))}
          </ListGroup>
        </Card.Body>
      </Card>

      <Modal show={showCreate || editOpen} onHide={() => { setShowCreate(false); setSelected(null) }} size="lg" centered>
        <Modal.Header closeButton>
          <Modal.Title>{selected ? `Edit ${selected.keycode}` : 'New key'}</Modal.Title>
        </Modal.Header>
        <Form onSubmit={(e) => void onSave(e)}>
          <Modal.Body>
            {error ? <Alert variant="danger" className="py-2 small">{error}</Alert> : null}
            <Form.Group className="mb-2">
              <Form.Label>Keycode</Form.Label>
              <Form.Control value={formKeycode} onChange={(e) => setFormKeycode(e.target.value)} required />
            </Form.Group>
            <Form.Group className="mb-2">
              <Form.Label>Barcode</Form.Label>
              <Form.Control value={formBarcode} onChange={(e) => setFormBarcode(e.target.value)} />
            </Form.Group>
            <Form.Group className="mb-2">
              <Form.Label>Route bag</Form.Label>
              <Form.Control value={formRoute} onChange={(e) => setFormRoute(e.target.value)} placeholder="R7" />
            </Form.Group>
            <Form.Group className="mb-2">
              <Form.Label>Home location</Form.Label>
              <Form.Control value={formHome} onChange={(e) => setFormHome(e.target.value)} />
            </Form.Group>
            <Form.Group className="mb-2">
              <Form.Label>Area</Form.Label>
              <Form.Control value={formArea} onChange={(e) => setFormArea(e.target.value)} />
            </Form.Group>
            <Form.Group className="mb-2">
              <Form.Label>Addresses (one per line)</Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                value={formAddresses}
                onChange={(e) => setFormAddresses(e.target.value)}
              />
            </Form.Group>
            {selected && blockers ? (
              <KeyDeleteBlockersPanel blockers={blockers} />
            ) : null}
          </Modal.Body>
          <Modal.Footer>
            {selected ? (
              <Button type="button" variant="outline-danger" className="me-auto" disabled={saving} onClick={() => void onDelete()}>
                Delete
              </Button>
            ) : null}
            <Button type="button" variant="outline-secondary" disabled={saving} onClick={() => { setShowCreate(false); setSelected(null) }}>
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
