import { useEffect, useId, useRef, useState } from 'react'
import { Alert, Button, Form, Modal, Spinner } from 'react-bootstrap'
import { locationPrimaryLabel } from './locationDisplay'
import LocationTicketForm from './LocationTicketForm'
import { createLocationTicket, type CreateLocationTicketInput } from './locationTicketsShared'
import { libraryRouteDisplay, type LibraryLocation, type LibraryPayload } from './monthlyRoutesShared'
import { apiJson, isAbortError } from '../../lib/apiClient'

const MIN_QUERY_LENGTH = 2
const RESULT_LIMIT = 8
const DEBOUNCE_MS = 250

type Props = {
  show: boolean
  onHide: () => void
  onCreated?: () => void
}

function locationSearchMetaLine(loc: LibraryLocation): string | null {
  const parts: string[] = []
  const route = libraryRouteDisplay(loc)
  if (route) parts.push(route)
  const address = (loc.address || loc.display_address || '').trim()
  const label = (loc.label || '').trim()
  if (address && address.toLowerCase() !== label.toLowerCase()) {
    parts.push(address)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

export default function LocationTicketCreateFromSearchModal({ show, onHide, onCreated }: Props) {
  const listboxId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [step, setStep] = useState<'search' | 'form'>('search')
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [results, setResults] = useState<LibraryLocation[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<LibraryLocation | null>(null)
  const [createBusy, setCreateBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!show) {
      setStep('search')
      setQuery('')
      setDebouncedQuery('')
      setResults([])
      setSelected(null)
      setError(null)
    }
  }, [show])

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedQuery(query.trim()), DEBOUNCE_MS)
    return () => window.clearTimeout(handle)
  }, [query])

  useEffect(() => {
    if (!show || step !== 'search' || debouncedQuery.length < MIN_QUERY_LENGTH) {
      setResults([])
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    const params = new URLSearchParams({
      q: debouncedQuery,
      page: '1',
      page_size: String(RESULT_LIMIT),
    })
    void apiJson<LibraryPayload>(`/api/monthly_routes/library?${params.toString()}`, {
      signal: controller.signal,
    })
      .then((payload) => setResults((payload.locations ?? []).slice(0, RESULT_LIMIT)))
      .catch((err) => {
        if (isAbortError(err)) return
        setResults([])
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [debouncedQuery, show, step])

  const onSelectLocation = (loc: LibraryLocation) => {
    setSelected(loc)
    setStep('form')
    setError(null)
  }

  const onCreate = async (input: CreateLocationTicketInput) => {
    if (!selected?.monthly_route_id) {
      setError('This location is not on a route yet.')
      return
    }
    setCreateBusy(true)
    setError(null)
    try {
      await createLocationTicket(selected.monthly_route_id, selected.id, input)
      onCreated?.()
      onHide()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create ticket.')
    } finally {
      setCreateBusy(false)
    }
  }

  return (
    <Modal
      show={show}
      onHide={onHide}
      size="lg"
      centered
      className="location-ticket-modal"
      contentClassName="location-ticket-modal__content"
    >
      <Modal.Header closeButton>
        <Modal.Title className="h6 mb-0">
          {step === 'search' ? 'Create ticket — choose location' : 'Create ticket'}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error ? (
          <Alert variant="danger" className="py-2 small">
            {error}
          </Alert>
        ) : null}
        {step === 'search' ? (
          <div ref={rootRef}>
            <Form.Label className="small">Search monthly locations</Form.Label>
            <Form.Control
              size="sm"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Address, label, or route"
              autoFocus
            />
            {loading ? (
              <div className="text-center py-3">
                <Spinner animation="border" size="sm" aria-hidden />
              </div>
            ) : null}
            {!loading && debouncedQuery.length >= MIN_QUERY_LENGTH && results.length === 0 ? (
              <p className="text-muted small mt-2 mb-0">No locations found.</p>
            ) : null}
            {results.length > 0 ? (
              <ul className="list-unstyled mt-2 mb-0" id={listboxId} role="listbox">
                {results.map((loc) => (
                  <li key={loc.id}>
                    <button
                      type="button"
                      className="btn btn-link text-start w-100 text-decoration-none px-0 py-2"
                      onClick={() => onSelectLocation(loc)}
                    >
                      <div className="fw-semibold">{locationPrimaryLabel(loc)}</div>
                      {locationSearchMetaLine(loc) ? (
                        <div className="small text-muted">{locationSearchMetaLine(loc)}</div>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : selected ? (
          <>
            <p className="small text-muted mb-3">
              {locationPrimaryLabel(selected)}
              {libraryRouteDisplay(selected) ? ` · ${libraryRouteDisplay(selected)}` : ''}
            </p>
            <LocationTicketForm busy={createBusy} submitLabel="Create ticket" onSubmit={onCreate} />
          </>
        ) : null}
      </Modal.Body>
      <Modal.Footer>
        {step === 'form' ? (
          <Button
            variant="link"
            size="sm"
            className="me-auto"
            onClick={() => {
              setStep('search')
              setSelected(null)
            }}
          >
            Back to search
          </Button>
        ) : null}
        <Button variant="secondary" size="sm" onClick={onHide}>
          Cancel
        </Button>
      </Modal.Footer>
    </Modal>
  )
}
