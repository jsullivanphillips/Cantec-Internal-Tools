import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Alert, Button, Form, ListGroup, Modal } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import type { LibraryLocation } from '../monthlyRoutes/monthlyRoutesShared'
import { apiJson } from '../../lib/apiClient'
import { createKey, searchKeys, type KeySearchHit } from './keysAdminShared'

type LocationPatchResponse = { location: LibraryLocation }

export default function MonthlyLocationKeyLinkPanel({
  location,
  onLocationUpdated,
}: {
  location: LibraryLocation
  onLocationUpdated: (loc: LibraryLocation) => void
}) {
  const [showLink, setShowLink] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<KeySearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [createKeycode, setCreateKeycode] = useState(location.keys?.trim() || '')
  const [createBarcode, setCreateBarcode] = useState(location.barcode?.trim() || '')
  const [createRoute, setCreateRoute] = useState(
    location.monthly_route?.route_number != null ? `R${location.monthly_route.route_number}` : '',
  )
  const [createAddress, setCreateAddress] = useState(
    location.label?.trim() || location.address?.trim() || '',
  )

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

  const patchKeyId = useCallback(
    async (keyId: number | null) => {
      setSaving(true)
      setError(null)
      try {
        const res = await apiJson<LocationPatchResponse>(
          `/api/monthly_routes/library/${location.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key_id: keyId }),
          },
        )
        onLocationUpdated(res.location)
        setShowLink(false)
      } catch (err) {
        setError(typeof err === 'object' && err && 'error' in err ? String((err as { error: unknown }).error) : 'Save failed')
      } finally {
        setSaving(false)
      }
    },
    [location.id, onLocationUpdated],
  )

  const onCreateSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const keycode = createKeycode.trim()
    if (!keycode) {
      setError('Keycode is required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const barcodeRaw = createBarcode.trim()
      const key = await createKey({
        keycode,
        barcode: barcodeRaw ? parseInt(barcodeRaw, 10) : null,
        route: createRoute.trim() || null,
        addresses: createAddress.trim() ? [createAddress.trim()] : [],
      })
      await patchKeyId(key.id)
      setShowCreate(false)
    } catch (err) {
      setError('Could not create key')
    } finally {
      setSaving(false)
    }
  }

  const linked = location.key

  return (
    <section className="monthly-location-detail-surface p-3 mb-3" aria-label="Key link">
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
        <h2 className="h6 mb-0">Physical key</h2>
        <div className="d-flex gap-2">
          <Button type="button" size="sm" variant="outline-primary" onClick={() => setShowLink(true)}>
            {linked ? 'Change link' : 'Link key'}
          </Button>
          <Button type="button" size="sm" variant="outline-secondary" onClick={() => setShowCreate(true)}>
            Create key
          </Button>
        </div>
      </div>
      {linked ? (
        <p className="small mb-0">
          Linked to{' '}
          <Link to={`/keys/${linked.id}`} className="fw-semibold">
            {linked.keycode}
          </Link>
          {location.keys?.trim() && location.keys.trim() !== linked.keycode ? (
            <span className="text-muted"> · sheet: {location.keys.trim()}</span>
          ) : null}
        </p>
      ) : (
        <p className="small text-muted mb-0">
          {location.keys?.trim()
            ? `Sheet KEYS: ${location.keys.trim()} — not linked to keys table.`
            : 'No key linked.'}
        </p>
      )}

      <Modal show={showLink} onHide={() => setShowLink(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Link key</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {error ? <Alert variant="danger" className="py-2 small">{error}</Alert> : null}
          <Form.Control
            type="search"
            placeholder="Search keycode, barcode, address…"
            value={query}
            disabled={saving}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {searching ? <p className="small text-muted mt-2 mb-0">Searching…</p> : null}
          <ListGroup className="mt-2">
            {hits.map((hit) => (
              <ListGroup.Item
                key={hit.id}
                action
                disabled={saving}
                onClick={() => void patchKeyId(hit.id)}
              >
                <span className="fw-semibold">{hit.keycode}</span>
                {hit.route ? <span className="text-muted ms-2">{hit.route}</span> : null}
                {hit.addresses[0] ? <div className="small text-muted">{hit.addresses[0]}</div> : null}
              </ListGroup.Item>
            ))}
          </ListGroup>
          {linked ? (
            <Button
              type="button"
              variant="outline-danger"
              size="sm"
              className="mt-3"
              disabled={saving}
              onClick={() => void patchKeyId(null)}
            >
              Clear link
            </Button>
          ) : null}
        </Modal.Body>
      </Modal>

      <Modal show={showCreate} onHide={() => setShowCreate(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Create key</Modal.Title>
        </Modal.Header>
        <Form onSubmit={(e) => void onCreateSubmit(e)}>
          <Modal.Body>
            {error ? <Alert variant="danger" className="py-2 small">{error}</Alert> : null}
            <Form.Group className="mb-2">
              <Form.Label>Keycode</Form.Label>
              <Form.Control value={createKeycode} onChange={(e) => setCreateKeycode(e.target.value)} required />
            </Form.Group>
            <Form.Group className="mb-2">
              <Form.Label>Barcode</Form.Label>
              <Form.Control value={createBarcode} onChange={(e) => setCreateBarcode(e.target.value)} />
            </Form.Group>
            <Form.Group className="mb-2">
              <Form.Label>Route bag (e.g. R7)</Form.Label>
              <Form.Control value={createRoute} onChange={(e) => setCreateRoute(e.target.value)} />
            </Form.Group>
            <Form.Group className="mb-2">
              <Form.Label>Address on key</Form.Label>
              <Form.Control value={createAddress} onChange={(e) => setCreateAddress(e.target.value)} />
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="outline-secondary" onClick={() => setShowCreate(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? 'Saving…' : 'Create & link'}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </section>
  )
}
