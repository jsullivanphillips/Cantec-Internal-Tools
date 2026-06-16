import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Form, Spinner } from 'react-bootstrap'
import { useNavigate } from 'react-router-dom'
import { locationPrimaryLabel } from '../features/monthlyRoutes/locationDisplay'
import {
  buildHeaderSearchResults,
  fetchMonthlyRoutesForHeaderSearch,
  routeHeaderSearchMetaLine,
  routeHeaderSearchTitle,
  type HeaderSearchResult,
} from '../features/monthlyRoutes/monthlyHeaderSearchShared'
import { libraryRouteDisplay, type LibraryLocation, type LibraryPayload, type MonthlyRouteSummary } from '../features/monthlyRoutes/monthlyRoutesShared'
import { apiJson, isAbortError } from '../lib/apiClient'

const MIN_QUERY_LENGTH = 2
const LOCATION_RESULT_LIMIT = 3
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

function resultKey(result: HeaderSearchResult): string {
  return result.kind === 'route' ? `route-${result.route.id}` : `location-${result.location.id}`
}

export default function MonthlyLocationHeaderSearch() {
  const navigate = useNavigate()
  const listboxId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [allRoutes, setAllRoutes] = useState<MonthlyRouteSummary[]>([])
  const [routesLoading, setRoutesLoading] = useState(true)
  const [locationResults, setLocationResults] = useState<LibraryLocation[]>([])
  const [locationsLoading, setLocationsLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  useEffect(() => {
    const controller = new AbortController()
    setRoutesLoading(true)
    void fetchMonthlyRoutesForHeaderSearch()
      .then((routes) => {
        if (!controller.signal.aborted) setAllRoutes(routes)
      })
      .catch(() => {
        if (!controller.signal.aborted) setAllRoutes([])
      })
      .finally(() => {
        if (!controller.signal.aborted) setRoutesLoading(false)
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedQuery(query.trim()), DEBOUNCE_MS)
    return () => window.clearTimeout(handle)
  }, [query])

  useEffect(() => {
    if (debouncedQuery.length < MIN_QUERY_LENGTH) {
      setLocationResults([])
      setLocationsLoading(false)
      return
    }

    const controller = new AbortController()
    setLocationsLoading(true)

    const params = new URLSearchParams({
      q: debouncedQuery,
      page: '1',
      page_size: String(LOCATION_RESULT_LIMIT),
    })

    void apiJson<LibraryPayload>(`/api/monthly_routes/library?${params.toString()}`, {
      signal: controller.signal,
    })
      .then((payload) => {
        setLocationResults((payload.locations ?? []).slice(0, LOCATION_RESULT_LIMIT))
        setActiveIndex(-1)
      })
      .catch((err) => {
        if (isAbortError(err)) return
        setLocationResults([])
      })
      .finally(() => {
        if (!controller.signal.aborted) setLocationsLoading(false)
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

  const menuResults = useMemo(
    () => buildHeaderSearchResults(allRoutes, locationResults, debouncedQuery, LOCATION_RESULT_LIMIT),
    [allRoutes, debouncedQuery, locationResults],
  )

  const loading = routesLoading || locationsLoading

  const goToRoute = useCallback(
    (routeId: number) => {
      setOpen(false)
      setQuery('')
      setDebouncedQuery('')
      setLocationResults([])
      navigate(`/monthlies/routes/${routeId}`)
    },
    [navigate],
  )

  const goToLocation = useCallback(
    (locationId: number) => {
      setOpen(false)
      setQuery('')
      setDebouncedQuery('')
      setLocationResults([])
      navigate(`/monthlies/locations/${locationId}`)
    },
    [navigate],
  )

  const selectResult = useCallback(
    (result: HeaderSearchResult) => {
      if (result.kind === 'route') {
        goToRoute(result.route.id)
      } else {
        goToLocation(result.location.id)
      }
    },
    [goToLocation, goToRoute],
  )

  const showMenu =
    open && debouncedQuery.length >= MIN_QUERY_LENGTH && (loading || menuResults.length > 0 || !loading)

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setOpen(false)
      return
    }
    if (!showMenu || menuResults.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => (index + 1) % menuResults.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => (index <= 0 ? menuResults.length - 1 : index - 1))
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault()
      selectResult(menuResults[activeIndex])
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
          placeholder="Search locations or routes…"
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
        <div
          className={`app-topbar-location-search__spinner-slot${loading ? '' : ' app-topbar-location-search__spinner-slot--hidden'}`}
          aria-hidden={!loading}
        >
          <Spinner
            animation="border"
            size="sm"
            className="app-topbar-location-search__spinner"
            aria-hidden
          />
        </div>
      </div>

      {showMenu ? (
        <ul id={listboxId} className="app-topbar-location-search__menu" role="listbox">
          {loading && menuResults.length === 0 ? (
            <li className="app-topbar-location-search__empty" role="presentation">
              Searching…
            </li>
          ) : null}
          {!loading && menuResults.length === 0 ? (
            <li className="app-topbar-location-search__empty" role="presentation">
              No matches
            </li>
          ) : null}
          {menuResults.map((result, index) => {
            if (result.kind === 'route') {
              const meta = routeHeaderSearchMetaLine(result.route)
              return (
                <li key={resultKey(result)} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={activeIndex === index}
                    className={`app-topbar-location-search__option app-topbar-location-search__option--route${activeIndex === index ? ' app-topbar-location-search__option--active' : ''}`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => selectResult(result)}
                  >
                    <span className="app-topbar-location-search__option-title">
                      <span className="app-topbar-location-search__option-kind">Route</span>
                      {routeHeaderSearchTitle(result.route)}
                    </span>
                    {meta ? (
                      <span className="app-topbar-location-search__option-meta">{meta}</span>
                    ) : null}
                  </button>
                </li>
              )
            }

            const meta = locationSearchMetaLine(result.location)
            return (
              <li key={resultKey(result)} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={activeIndex === index}
                  className={`app-topbar-location-search__option${activeIndex === index ? ' app-topbar-location-search__option--active' : ''}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectResult(result)}
                >
                  <span className="app-topbar-location-search__option-title">
                    {locationPrimaryLabel(result.location, { compact: true })}
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
