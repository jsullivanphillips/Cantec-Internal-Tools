import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiJson, isAbortError } from '../lib/apiClient'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { Button, Card, Form, ListGroup, Modal, Spinner } from 'react-bootstrap'

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

function formatSignedOutAt(value?: string | null): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''

  const timePart = d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
  const datePart = d.toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  })
  return `${timePart}, ${datePart}`
}

function signedOutDaysLabel(value?: string | null): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''

  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const signed = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diffDays = Math.floor((today.getTime() - signed.getTime()) / 86400000)

  if (diffDays <= 0) return 'Today'
  if (diffDays === 1) return '1 day ago'
  return `${diffDays} days ago`
}

export default function KeysHomePage() {
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [loading, setLoading] = useState(false)
  const [signedOut, setSignedOut] = useState<SignedOutKey[]>([])
  const [signedOutLoading, setSignedOutLoading] = useState(true)
  const [signedOutSort, setSignedOutSort] = useState<'newest' | 'oldest'>('newest')
  const [scannerOpen, setScannerOpen] = useState(false)
  const [scannerMessage, setScannerMessage] = useState('Scan a barcode…')
  const [scannerError, setScannerError] = useState<string | null>(null)
  const [scanSupported, setScanSupported] = useState(true)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const codeReaderRef = useRef<BrowserMultiFormatReader | null>(null)
  const hasNavigatedRef = useRef(false)
  /** Trimmed query we last finished a request for (success or error). */
  const [searchedFor, setSearchedFor] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    void (async () => {
      try {
        const d = await apiJson<{ data: SignedOutKey[] }>('/api/keys/signed-out', { signal: controller.signal })
        if (!cancelled) setSignedOut(d.data || [])
      } catch (error) {
        if (isAbortError(error)) return
        if (!cancelled) setSignedOut([])
      } finally {
        if (!cancelled) setSignedOutLoading(false)
      }
    })()
    return () => {
      cancelled = true
      controller.abort()
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

    const controller = new AbortController()
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const d = await apiJson<{ data: Hit[] }>(
          `/api/keys/search?q=${encodeURIComponent(t)}`,
          { signal: controller.signal },
        )
        if (cancelled) return
        setHits(d.data || [])
        setSearchedFor(t)
      } catch (error) {
        if (isAbortError(error)) return
        if (cancelled) return
        setHits([])
        setSearchedFor(t)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [q])

  useEffect(() => {
    setScanSupported(Boolean(globalThis.navigator?.mediaDevices?.enumerateDevices))
  }, [])

  useEffect(() => {
    if (!scannerOpen) return
    const video = videoRef.current
    if (!video) return

    let cancelled = false
    hasNavigatedRef.current = false
    setScannerError(null)
    setScannerMessage('Scan a barcode…')

    const start = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        const videoInputs = devices.filter((d) => d.kind === 'videoinput')
        if (!videoInputs.length) {
          setScannerError('No camera devices detected.')
          return
        }

        const reader = new BrowserMultiFormatReader()
        codeReaderRef.current = reader

        await reader.decodeFromVideoDevice(undefined, video, (result) => {
          if (!result || cancelled || hasNavigatedRef.current) return
          const barcodeText = result.getText().trim()
          if (!barcodeText) return

          hasNavigatedRef.current = true
          setScannerMessage(`Scanned: ${barcodeText}`)
          setScannerOpen(false)
          nav(`/keys/by-barcode/${encodeURIComponent(barcodeText)}`)
        })
      } catch (error) {
        console.error(error)
        setScannerError('Camera initialization error.')
      }
    }

    void start()
    return () => {
      cancelled = true
      stopScanner(codeReaderRef, videoRef)
    }
  }, [scannerOpen, nav])

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
    <div className="container-fluid py-3 px-2 keys-page">
      <Card className="app-surface-card mb-3">
        <Card.Body className="p-3 p-md-4">
          <h1 className="processing-page-title mb-1">Keys</h1>
          <p className="processing-page-subtitle mb-0">
            Search keys, check who has them signed out, and quickly open key details.
          </p>
        </Card.Body>
      </Card>

      <Card className="app-surface-card mb-3">
        <Card.Body>
          <div className="d-flex align-items-center justify-content-between gap-2 mb-3">
            <div>
              <div className="fw-semibold">Find a key</div>
              <div className="small text-muted">Search by keycode or address</div>
            </div>
            <Button
              size="sm"
              className="d-lg-none"
              variant="outline-primary"
              onClick={() => setScannerOpen(true)}
              disabled={!scanSupported}
            >
              Scan barcode
            </Button>
          </div>
          <div className="position-relative mb-3">
            <Form.Control
              type="search"
              placeholder="Type at least 2 characters... "
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-busy={loading}
              autoComplete="off"
              style={{ paddingTop: '0.7rem', paddingBottom: '0.7rem' }}
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
          <ListGroup className="keys-search-results-list">
            {hits.map((h) => (
              <ListGroup.Item
                key={h.id}
                action
                as={Link}
                to={`/keys/${h.id}`}
                className="keys-search-result-item"
              >
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
            <ListGroup className="keys-signedout-list">
              {sortedSignedOut.map((k) => (
                <ListGroup.Item key={k.id} action as={Link} to={`/keys/${k.id}`} className="keys-signedout-item">
                  <div className="keys-signedout-item__row">
                    <div className="keys-signedout-item__left">
                      <div className="fw-semibold">{k.keycode}</div>
                      <div className="small text-muted">
                        {k.route ? `Route ${k.route} · ` : ''}
                        {k.addresses?.join(', ') || '—'}
                      </div>
                      <div className="small text-muted">{k.inserted_at ? formatSignedOutAt(k.inserted_at) : '—'}</div>
                    </div>
                    <div className="keys-signedout-item__right">
                      <div className="fw-semibold">{k.key_location || '—'}</div>
                      <div className="small text-muted">{signedOutDaysLabel(k.inserted_at)}</div>
                    </div>
                  </div>
                </ListGroup.Item>
              ))}
            </ListGroup>
          )}
        </Card.Body>
      </Card>

      <Modal show={scannerOpen} onHide={() => setScannerOpen(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Scan barcode</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {!scanSupported ? (
            <p className="text-muted mb-0">Camera scanner is not available on this device/browser.</p>
          ) : (
            <>
              <video ref={videoRef} className="keys-scanner-video" muted autoPlay playsInline />
              {scannerError ? <p className="text-danger small mt-2 mb-1">{scannerError}</p> : null}
              <p className="small text-muted mt-2 mb-0">{scannerMessage}</p>
            </>
          )}
        </Modal.Body>
      </Modal>
    </div>
  )
}

function stopScanner(
  codeReaderRef: MutableRefObject<BrowserMultiFormatReader | null>,
  videoRef: MutableRefObject<HTMLVideoElement | null>,
) {
  if (codeReaderRef.current) {
    try {
      const reader = codeReaderRef.current as BrowserMultiFormatReader & {
        stopContinuousDecode?: () => void
        stopAsyncDecode?: () => void
        stopStreams?: () => void
        reset?: () => void
      }
      reader.stopContinuousDecode?.()
      reader.stopAsyncDecode?.()
      reader.stopStreams?.()
      reader.reset?.()
    } catch {
      // no-op
    }
    codeReaderRef.current = null
  }
  const video = videoRef.current
  if (video?.srcObject) {
    try {
      const tracks = (video.srcObject as MediaStream).getTracks?.() || []
      tracks.forEach((t) => t.stop())
    } catch {
      // no-op
    }
    video.srcObject = null
  }
}
