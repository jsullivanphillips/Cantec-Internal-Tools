import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiFetch, apiJson, isAbortError } from '../lib/apiClient'
import { Alert, Button, Card, Form, Pagination, Spinner, Table, Toast, ToastContainer } from 'react-bootstrap'

type KeyDetail = {
  id: number
  keycode: string
  barcode?: number | null
  route?: string | null
  home_location?: string | null
  is_key_bag: boolean
  addresses: { id: number; address: string }[]
  current_status: null | {
    status: string
    key_location: string
    air_tag?: string | null
    returned_by?: string | null
    inserted_at?: string | null
  }
  ui: {
    status_text: string
    is_out: boolean
    is_in: boolean
    current_loc: string
    home_loc: string
  }
}

type KeyHistoryEvent = {
  id: number
  status: string
  key_location?: string | null
  returned_by?: string | null
  inserted_at?: string | null
}

const HISTORY_PAGE_SIZE = 5

export default function KeyDetailPage() {
  const { keyId } = useParams<{ keyId: string }>()
  const [data, setData] = useState<KeyDetail | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [signTo, setSignTo] = useState('')
  const [airTag, setAirTag] = useState('')
  const [returnedBy, setReturnedBy] = useState('')
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  const [returningKey, setReturningKey] = useState(false)
  const [history, setHistory] = useState<KeyHistoryEvent[]>([])
  const [historyPage, setHistoryPage] = useState(1)
  const [historyLoading, setHistoryLoading] = useState(false)

  const load = async (signal?: AbortSignal) => {
    if (!keyId) return
    setHistoryLoading(true)
    try {
      const [detail, hist] = await Promise.all([
        apiJson<KeyDetail>(`/api/keys/${keyId}/detail`, { signal }),
        apiJson<{ data: KeyHistoryEvent[] }>(`/api/keys/${keyId}/history?limit=100`, { signal }),
      ])
      if (signal?.aborted) return
      setData(detail)
      setHistory(hist.data || [])
      setHistoryPage(1)
    } catch (error) {
      if (isAbortError(error)) return
      setErr('Failed to load key')
    } finally {
      if (!signal?.aborted) setHistoryLoading(false)
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [keyId])

  const signOut = async (e: FormEvent) => {
    e.preventDefault()
    if (!keyId) return
    setSigningOut(true)
    try {
      const r = await apiFetch(`/api/keys/${keyId}/sign-out`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ signed_out_to: signTo, air_tag: airTag || null }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        setErr((j as { error?: string }).error || 'Sign out failed')
        return
      }
      setSignTo('')
      setAirTag('')
      await load()
      setErr(null)
      setToastMsg('Key signed out successfully.')
    } finally {
      setSigningOut(false)
    }
  }

  const returnKey = async (e: FormEvent) => {
    e.preventDefault()
    if (!keyId) return
    setReturningKey(true)
    try {
      const r = await apiFetch(`/api/keys/${keyId}/return`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ returned_by: returnedBy }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        setErr((j as { error?: string }).error || 'Return failed')
        return
      }
      setReturnedBy('')
      await load()
      setErr(null)
      setToastMsg('Key returned successfully.')
    } finally {
      setReturningKey(false)
    }
  }

  if (!data && !err) {
    return <KeyDetailPageSkeleton />
  }
  if (err && !data) {
    return (
      <div className="key-detail-page py-4">
        <Alert variant="danger">{err}</Alert>
      </div>
    )
  }
  if (!data) return null

  const cs = data.current_status
  const statusLabel = data.ui.is_out ? 'Out' : data.ui.is_in ? 'In' : 'Unknown'
  const statusTone = data.ui.is_out ? 'danger' : data.ui.is_in ? 'success' : 'secondary'
  const statusIcon = data.ui.is_out ? 'bi-box-arrow-up-right' : data.ui.is_in ? 'bi-check-circle' : 'bi-question-circle'
  const totalHistoryPages = Math.max(1, Math.ceil(history.length / HISTORY_PAGE_SIZE))
  const pageStart = (historyPage - 1) * HISTORY_PAGE_SIZE
  const pageRows = history.slice(pageStart, pageStart + HISTORY_PAGE_SIZE)

  return (
    <div className="key-detail-page py-4">
      <ToastContainer position="top-end" className="p-3">
        <Toast
          bg="success"
          onClose={() => setToastMsg(null)}
          show={Boolean(toastMsg)}
          autohide
          delay={2200}
        >
          <Toast.Body className="text-white">{toastMsg}</Toast.Body>
        </Toast>
      </ToastContainer>

      <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
        <Link to="/keys" className="small text-decoration-none">← Back to keys</Link>
        <span className={`badge text-bg-${statusTone}`}>{statusLabel}</span>
      </div>

      {err && <Alert variant="warning" className="mb-3">{err}</Alert>}

      <Card
        className={`app-surface-card key-hero-card mb-3 ${
          data.ui.is_out ? 'key-hero-card--out' : data.ui.is_in ? 'key-hero-card--in' : ''
        }`}
      >
        <Card.Body className="p-4">
          <h1 className="h2 mb-1">{data.keycode}</h1>
          <div className="text-muted mb-3 d-flex flex-wrap gap-3">
            <span><i className="bi bi-upc me-1" aria-hidden />{data.barcode ?? '—'}</span>
            {data.route ? <span><i className="bi bi-signpost me-1" aria-hidden />Route {data.route}</span> : null}
          </div>
          <div className="key-status-line d-flex align-items-center gap-2">
            <i className={`bi ${statusIcon}`} aria-hidden />
            {data.ui.is_out
              ? `Signed out to ${data.ui.current_loc || '—'}`
              : data.ui.is_in
                ? `In ${data.ui.home_loc || 'Home'}`
                : data.ui.status_text}
          </div>
          {cs?.inserted_at && (
            <div className="small text-muted mt-2 d-flex align-items-center gap-1">
              <i className="bi bi-clock-history" aria-hidden />
              <span>Updated {new Date(cs.inserted_at).toLocaleString()}</span>
            </div>
          )}
        </Card.Body>
      </Card>

      <Card className="app-surface-card mb-3">
        <Card.Header className="fw-semibold">Addresses</Card.Header>
        <Card.Body>
          {data.addresses.length === 0 ? (
            <div className="text-muted">None</div>
          ) : (
            <div className="d-flex flex-column gap-2">
              {data.addresses.map((a) => (
                <div key={a.id} className="key-address-pill">{a.address}</div>
              ))}
            </div>
          )}
        </Card.Body>
      </Card>

      <div className="key-actions-grid">
        <Card className="app-surface-card">
          <Card.Header className="fw-semibold">Sign out</Card.Header>
          <Card.Body>
            <Form onSubmit={signOut}>
              <Form.Group className="mb-3">
                <Form.Label>Sign out to</Form.Label>
                <Form.Control
                  value={signTo}
                  onChange={(e) => setSignTo(e.target.value)}
                  placeholder="Technician name"
                  required
                />
              </Form.Group>
              <Form.Group className="mb-3">
                <Form.Label>AirTag (optional)</Form.Label>
                <Form.Control
                  value={airTag}
                  onChange={(e) => setAirTag(e.target.value)}
                  placeholder="AirTag id"
                />
              </Form.Group>
              <Button type="submit" className="w-100 d-inline-flex justify-content-center align-items-center gap-2" disabled={signingOut}>
                {signingOut ? (
                  <>
                    <Spinner animation="border" size="sm" role="status" />
                    <span>Signing out…</span>
                  </>
                ) : (
                  'Sign out key'
                )}
              </Button>
            </Form>
          </Card.Body>
        </Card>

        <Card className="app-surface-card">
          <Card.Header className="fw-semibold">Return</Card.Header>
          <Card.Body>
            <Form onSubmit={returnKey}>
              <Form.Group className="mb-3">
                <Form.Label>Returned by</Form.Label>
                <Form.Control
                  value={returnedBy}
                  onChange={(e) => setReturnedBy(e.target.value)}
                  placeholder="Name"
                  required
                />
              </Form.Group>
              <Button
                type="submit"
                variant="outline-primary"
                className="w-100 d-inline-flex justify-content-center align-items-center gap-2"
                disabled={returningKey}
              >
                {returningKey ? (
                  <>
                    <Spinner animation="border" size="sm" role="status" />
                    <span>Returning…</span>
                  </>
                ) : (
                  'Return key'
                )}
              </Button>
            </Form>
          </Card.Body>
        </Card>
      </div>

      <Card className="app-surface-card mt-3">
        <Card.Header className="fw-semibold">Signout history</Card.Header>
        <Card.Body>
          {historyLoading ? (
            <KeyHistorySkeleton />
          ) : history.length === 0 ? (
            <div className="text-muted">No key status history yet.</div>
          ) : (
            <>
              <div className="table-responsive">
                <Table hover className="align-middle mb-2">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Status</th>
                      <th>Location</th>
                      <th>Returned by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((h) => (
                      <tr key={h.id}>
                        <td>{h.inserted_at ? new Date(h.inserted_at).toLocaleString() : '—'}</td>
                        <td>{h.status || '—'}</td>
                        <td>{h.key_location || '—'}</td>
                        <td>{h.returned_by || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              {totalHistoryPages > 1 && (
                <div className="d-flex justify-content-end">
                  <Pagination className="mb-0">
                    <Pagination.Prev
                      onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                      disabled={historyPage <= 1}
                    />
                    {Array.from({ length: totalHistoryPages }, (_, i) => i + 1).map((p) => (
                      <Pagination.Item
                        key={p}
                        active={p === historyPage}
                        onClick={() => setHistoryPage(p)}
                      >
                        {p}
                      </Pagination.Item>
                    ))}
                    <Pagination.Next
                      onClick={() => setHistoryPage((p) => Math.min(totalHistoryPages, p + 1))}
                      disabled={historyPage >= totalHistoryPages}
                    />
                  </Pagination>
                </div>
              )}
            </>
          )}
        </Card.Body>
      </Card>
    </div>
  )
}

function KeyDetailPageSkeleton() {
  return (
    <div className="key-detail-page py-4 home-skeleton" aria-busy="true" aria-label="Loading key details">
      <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
        <span className="home-skeleton-bar d-block" style={{ width: '7.5rem' }} />
        <span className="home-skeleton-bar d-block" style={{ width: '4rem' }} />
      </div>

      <Card className="app-surface-card key-hero-card mb-3">
        <Card.Body className="p-4">
          <span className="home-skeleton-bar d-block mb-2" style={{ width: '12rem', height: '1.6rem' }} />
          <span className="home-skeleton-bar d-block mb-3" style={{ width: '16rem' }} />
          <span className="home-skeleton-bar d-block" style={{ width: '14rem' }} />
        </Card.Body>
      </Card>

      <Card className="app-surface-card mb-3">
        <Card.Header className="fw-semibold">Addresses</Card.Header>
        <Card.Body className="d-flex flex-column gap-2">
          <span className="home-skeleton-bar d-block" style={{ width: '92%' }} />
          <span className="home-skeleton-bar d-block" style={{ width: '84%' }} />
          <span className="home-skeleton-bar d-block" style={{ width: '76%' }} />
        </Card.Body>
      </Card>

      <div className="key-actions-grid">
        <Card className="app-surface-card">
          <Card.Header className="fw-semibold">Sign out</Card.Header>
          <Card.Body className="d-flex flex-column gap-3">
            <span className="home-skeleton-bar d-block" style={{ width: '6rem' }} />
            <span className="home-skeleton-bar d-block" style={{ width: '100%', height: '2.25rem' }} />
            <span className="home-skeleton-bar d-block" style={{ width: '7rem' }} />
            <span className="home-skeleton-bar d-block" style={{ width: '100%', height: '2.25rem' }} />
            <span className="home-skeleton-bar d-block" style={{ width: '100%', height: '2.3rem' }} />
          </Card.Body>
        </Card>

        <Card className="app-surface-card">
          <Card.Header className="fw-semibold">Return</Card.Header>
          <Card.Body className="d-flex flex-column gap-3">
            <span className="home-skeleton-bar d-block" style={{ width: '6rem' }} />
            <span className="home-skeleton-bar d-block" style={{ width: '100%', height: '2.25rem' }} />
            <span className="home-skeleton-bar d-block" style={{ width: '100%', height: '2.3rem' }} />
          </Card.Body>
        </Card>
      </div>

      <Card className="app-surface-card mt-3">
        <Card.Header className="fw-semibold">Signout history</Card.Header>
        <Card.Body>
          <KeyHistorySkeleton />
        </Card.Body>
      </Card>
    </div>
  )
}

function KeyHistorySkeleton() {
  return (
    <div className="d-flex flex-column gap-2" aria-hidden>
      <span className="home-skeleton-bar d-block" style={{ width: '100%', height: '1.8rem' }} />
      <span className="home-skeleton-bar d-block" style={{ width: '100%', height: '1.8rem' }} />
      <span className="home-skeleton-bar d-block" style={{ width: '100%', height: '1.8rem' }} />
      <span className="home-skeleton-bar d-block" style={{ width: '100%', height: '1.8rem' }} />
      <span className="home-skeleton-bar d-block" style={{ width: '70%', height: '1.8rem' }} />
    </div>
  )
}
