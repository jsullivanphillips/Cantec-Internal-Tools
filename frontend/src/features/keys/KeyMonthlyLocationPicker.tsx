import { useEffect, useState } from 'react'
import { Badge, Button, Form, ListGroup, Spinner } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import { locationPrimaryLabel } from '../monthlyRoutes/locationDisplay'
import { libraryRouteDisplay, type LibraryLocation, type LibraryPayload } from '../monthlyRoutes/monthlyRoutesShared'
import { apiJson, isAbortError } from '../../lib/apiClient'

const MIN_QUERY_LENGTH = 2
const RESULT_LIMIT = 8
const DEBOUNCE_MS = 250

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

function reassignmentWarning(loc: LibraryLocation, editingKeyId: number | null | undefined): string | null {
  if (!loc.key_id || loc.key_id === editingKeyId) return null
  const keycode = loc.key?.keycode?.trim()
  if (keycode) return `Linked to ${keycode} — will reassign on save`
  return 'Linked to another key — will reassign on save'
}

type Props = {
  selected: LibraryLocation[]
  onChange: (locations: LibraryLocation[]) => void
  editingKeyId?: number | null
  disabled?: boolean
}

export default function KeyMonthlyLocationPicker({
  selected,
  onChange,
  editingKeyId = null,
  disabled = false,
}: Props) {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [results, setResults] = useState<LibraryLocation[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedQuery(query.trim()), DEBOUNCE_MS)
    return () => window.clearTimeout(handle)
  }, [query])

  useEffect(() => {
    if (debouncedQuery.length < MIN_QUERY_LENGTH) {
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
      include_history: 'false',
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
  }, [debouncedQuery])

  const selectedIds = new Set(selected.map((loc) => loc.id))

  const addLocation = (loc: LibraryLocation) => {
    if (selectedIds.has(loc.id)) return
    onChange([...selected, loc])
    setQuery('')
    setDebouncedQuery('')
    setResults([])
  }

  const removeLocation = (locationId: number) => {
    onChange(selected.filter((loc) => loc.id !== locationId))
  }

  const visibleResults = results.filter((loc) => !selectedIds.has(loc.id))

  return (
    <div>
      {selected.length > 0 ? (
        <div className="d-flex flex-wrap gap-2 mb-2">
          {selected.map((loc) => {
            const warning = reassignmentWarning(loc, editingKeyId)
            return (
              <div
                key={loc.id}
                className="border rounded px-2 py-1 small d-flex align-items-start gap-2"
              >
                <div>
                  <div className="fw-semibold">
                    <Link to={`/monthlies/locations/${loc.id}`} className="text-decoration-none">
                      {locationPrimaryLabel(loc)}
                    </Link>
                  </div>
                  {locationSearchMetaLine(loc) ? (
                    <div className="text-muted">{locationSearchMetaLine(loc)}</div>
                  ) : null}
                  {warning ? (
                    <Badge bg="warning" text="dark" className="mt-1">
                      {warning}
                    </Badge>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="p-0 text-muted"
                  disabled={disabled}
                  aria-label={`Remove ${locationPrimaryLabel(loc)}`}
                  onClick={() => removeLocation(loc.id)}
                >
                  ×
                </Button>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="text-muted small mb-2">No monthly locations selected.</p>
      )}

      <Form.Label className="small mb-1">Search monthly locations</Form.Label>
      <Form.Control
        type="search"
        size="sm"
        value={query}
        disabled={disabled}
        placeholder="Address, label, or route"
        onChange={(e) => setQuery(e.target.value)}
      />
      {loading ? (
        <div className="d-flex align-items-center gap-2 mt-2 text-muted small">
          <Spinner animation="border" size="sm" />
          Searching…
        </div>
      ) : null}
      {!loading && debouncedQuery.length >= MIN_QUERY_LENGTH && visibleResults.length === 0 ? (
        <p className="text-muted small mt-2 mb-0">No locations found.</p>
      ) : null}
      {visibleResults.length > 0 ? (
        <ListGroup className="mt-2">
          {visibleResults.map((loc) => {
            const warning = reassignmentWarning(loc, editingKeyId)
            return (
              <ListGroup.Item
                key={loc.id}
                action
                disabled={disabled}
                onClick={() => addLocation(loc)}
              >
                <div className="fw-semibold">{locationPrimaryLabel(loc)}</div>
                {locationSearchMetaLine(loc) ? (
                  <div className="small text-muted">{locationSearchMetaLine(loc)}</div>
                ) : null}
                {warning ? (
                  <Badge bg="warning" text="dark" className="mt-1">
                    {warning}
                  </Badge>
                ) : null}
              </ListGroup.Item>
            )
          })}
        </ListGroup>
      ) : null}
    </div>
  )
}
