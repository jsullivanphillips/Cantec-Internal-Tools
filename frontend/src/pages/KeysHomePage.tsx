import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiJson } from '../lib/apiClient'
import { Card, Form, ListGroup, Spinner } from 'react-bootstrap'

type Hit = {
  id: number
  keycode: string
  barcode?: number | null
  route?: string | null
  addresses: string[]
}

type SignedOutKey = {
  id: number
  keycode: string
  barcode?: number | null
  route?: string | null
  addresses: string[]
  key_location?: string | null
  status?: string | null
  inserted_at?: string | null
  is_key_bag?: boolean
}

export default function KeysHomePage() {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [loading, setLoading] = useState(false)
  const [signedOut, setSignedOut] = useState<SignedOutKey[]>([])
  const [signedOutLoading, setSignedOutLoading] = useState(true)
  const [signedOutSort, setSignedOutSort] = useState<'newest' | 'oldest'>('newest')
  /** Trimmed query we last finished a request for (success or error). */
  const [searchedFor, setSearchedFor] = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const d = await apiJson<{ data: SignedOutKey[] }>('/api/keys/signed-out')
        if (!cancelled) setSignedOut(d.data || [])
      } catch {
        if (!cancelled) setSignedOut([])
      } finally {
        if (!cancelled) setSignedOutLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const t = q.trim()
    if (t.length < 2) {
      setHits([])
      setSearchedFor('')
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const d = await apiJson<{ data: Hit[] }>(
          `/api/keys/search?q=${encodeURIComponent(t)}`
        )
        if (cancelled) return
        setHits(d.data || [])
        setSearchedFor(t)
      } catch {
        if (cancelled) return
        setHits([])
        setSearchedFor(t)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [q])

  const trimmed = q.trim()
  const showNoResults =
    !loading &&
    hits.length === 0 &&
    searchedFor.length >= 2 &&
    searchedFor === trimmed

  const sortedSignedOut = useMemo(() => {
    const v = [...signedOut]
    v.sort((a, b) => {
      const ta = a.inserted_at ? new Date(a.inserted_at).getTime() : 0
      const tb = b.inserted_at ? new Date(b.inserted_at).getTime() : 0
      return signedOutSort === 'newest' ? tb - ta : ta - tb
    })
    return v
  }, [signedOut, signedOutSort])

  return (
    <div className="container py-4">
      <Card className="app-surface-card mb-4">
        <Card.Header as="h1" className="h4 mb-0">
          Keys
        </Card.Header>
        <Card.Body>
          <div className="position-relative mb-3">
            <Form.Control
              type="search"
              placeholder="Type to search (results update as you type, min 2 characters)"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-busy={loading}
              autoComplete="off"
            />
            {loading && (
              <Spinner
                animation="border"
                size="sm"
                role="status"
                className="position-absolute"
                style={{ top: '0.55rem', right: '0.75rem' }}
              />
            )}
          </div>
          <ListGroup>
            {hits.map((h) => (
              <ListGroup.Item key={h.id} action as={Link} to={`/keys/${h.id}`}>
                <div className="fw-semibold">{h.keycode}</div>
                <div className="small text-muted">
                  {h.route ? `Route ${h.route} · ` : ''}
                  {h.addresses?.join(', ') || '—'}
                </div>
              </ListGroup.Item>
            ))}
          </ListGroup>
          {showNoResults && <p className="text-muted mt-3 mb-0">No results.</p>}
        </Card.Body>
      </Card>

      <Card className="app-surface-card">
        <Card.Header className="d-flex justify-content-between align-items-center gap-2 flex-wrap">
          <span className="fw-semibold">Currently Signed Out</span>
          <Form.Select
            style={{ maxWidth: 170 }}
            value={signedOutSort}
            onChange={(e) => setSignedOutSort(e.target.value as 'newest' | 'oldest')}
            aria-label="Sort currently signed out keys"
          >
            <option value="newest">Sort: Newest</option>
            <option value="oldest">Sort: Oldest</option>
          </Form.Select>
        </Card.Header>
        <Card.Body>
          {signedOutLoading ? (
            <div className="py-2 text-muted d-flex align-items-center gap-2">
              <Spinner animation="border" size="sm" /> Loading signed-out keys...
            </div>
          ) : sortedSignedOut.length === 0 ? (
            <p className="text-muted mb-0">No keys are currently signed out.</p>
          ) : (
            <ListGroup>
              {sortedSignedOut.map((k) => (
                <ListGroup.Item key={k.id} action as={Link} to={`/keys/${k.id}`}>
                  <div className="d-flex justify-content-between align-items-start gap-2">
                    <div>
                      <div className="fw-semibold">{k.keycode}</div>
                      <div className="small text-muted">
                        {k.route ? `Route ${k.route} · ` : ''}
                        {k.addresses?.join(', ') || '—'}
                      </div>
                    </div>
                    <div className="small text-muted text-end">
                      {k.key_location ? <div>{k.key_location}</div> : null}
                      {k.inserted_at ? <div>{new Date(k.inserted_at).toLocaleString()}</div> : null}
                    </div>
                  </div>
                </ListGroup.Item>
              ))}
            </ListGroup>
          )}
        </Card.Body>
      </Card>
    </div>
  )
}
