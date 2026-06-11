import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Form, Spinner } from 'react-bootstrap'
import { useNavigate } from 'react-router-dom'
import { locationPrimaryLabel } from '../features/monthlyRoutes/locationDisplay'
import { libraryRouteDisplay, type LibraryLocation, type LibraryPayload } from '../features/monthlyRoutes/monthlyRoutesShared'
import { apiJson, isAbortError } from '../lib/apiClient'

const MIN_QUERY_LENGTH = 2
const RESULT_LIMIT = 3
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
  if (loc.property_management_company?.trim()) {
    parts.push(loc.property_management_company.trim())
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

export default function MonthlyLocationHeaderSearch() {
  const navigate = useNavigate()
  const listboxId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [results, setResults] = useState<LibraryLocation[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

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
    })

    void apiJson<LibraryPayload>(`/api/monthly_routes/library?${params.toString()}`, {
      signal: controller.signal,
    })
      .then((payload) => {
        setResults((payload.locations ?? []).slice(0, RESULT_LIMIT))
        setActiveIndex(-1)
      })
      .catch((err) => {
        if (isAbortError(err)) return
        setResults([])
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [debouncedQuery])

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [])

  const goToLocation = useCallback(
    (locationId: number) => {
      setOpen(false)
      setQuery('')
      setDebouncedQuery('')
      setResults([])
      navigate(`/monthlies/locations/${locationId}`)
    },
    [navigate],
  )

  const showMenu =
    open && debouncedQuery.length >= MIN_QUERY_LENGTH && (loading || results.length > 0 || !loading)

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setOpen(false)
      return
    }
    if (!showMenu || results.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => (index + 1) % results.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => (index <= 0 ? results.length - 1 : index - 1))
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault()
      goToLocation(results[activeIndex].id)
    }
  }

  return (
    <div ref={rootRef} className="app-topbar-location-search">
      <div className="app-topbar-location-search__field">
        <i className="bi bi-search app-topbar-location-search__icon" aria-hidden />
        <Form.Control
          ref={inputRef}
          type="search"
          size="sm"
          className="app-topbar-location-search__input"
          value={query}
          placeholder="Search monthly locations…"
          role="combobox"
          aria-expanded={showMenu}
          aria-controls={listboxId}
          aria-autocomplete="list"
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
          }}
          onFocus={() => {
            if (query.trim().length >= MIN_QUERY_LENGTH) setOpen(true)
          }}
          onKeyDown={onInputKeyDown}
        />
        {loading ? (
          <Spinner
            animation="border"
            size="sm"
            className="app-topbar-location-search__spinner"
            aria-hidden
          />
        ) : null}
      </div>

      {showMenu ? (
        <ul id={listboxId} className="app-topbar-location-search__menu" role="listbox">
          {loading && results.length === 0 ? (
            <li className="app-topbar-location-search__empty" role="presentation">
              Searching…
            </li>
          ) : null}
          {!loading && results.length === 0 ? (
            <li className="app-topbar-location-search__empty" role="presentation">
              No matches
            </li>
          ) : null}
          {results.map((loc, index) => {
            const meta = locationSearchMetaLine(loc)
            return (
              <li key={loc.id} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={activeIndex === index}
                  className={`app-topbar-location-search__option${activeIndex === index ? ' app-topbar-location-search__option--active' : ''}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => goToLocation(loc.id)}
                >
                  <span className="app-topbar-location-search__option-title">
                    {locationPrimaryLabel(loc, { compact: true })}
                  </span>
                  {meta ? (
                    <span className="app-topbar-location-search__option-meta">{meta}</span>
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
