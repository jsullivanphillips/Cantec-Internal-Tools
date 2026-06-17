import { useCallback, useEffect, useState, type KeyboardEvent } from 'react'
import { Form, Spinner } from 'react-bootstrap'
import { useNavigate } from 'react-router-dom'
import { apiJson, isAbortError } from '../lib/apiClient'

type PortalLocationSuggest = {
  id: number
  label: string
  address: string
  route_label: string | null
  monthly_route_id: number | null
}

type LocationsSuggestResponse = {
  locations: PortalLocationSuggest[]
}

type SessionTechnicianResponse = {
  technician: { id: string; name: string } | null
}

const MIN_QUERY_LENGTH = 2

export default function TechnicianPortalHubPage() {
  const nav = useNavigate()
  const [techName, setTechName] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<PortalLocationSuggest[]>([])
  const [suggestHighlight, setSuggestHighlight] = useState(0)
  const [inputFocused, setInputFocused] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searchLoading, setSearchLoading] = useState(false)

  const dropdownVisible = inputFocused && suggestions.length > 0

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const session = await apiJson<SessionTechnicianResponse>('/api/technician_portal/session/technician')
        if (cancelled) return
        if (!session.technician) {
          nav('/tech/technician', { replace: true })
          return
        }
        setTechName(session.technician.name)
      } catch {
        if (!cancelled) nav('/tech/technician', { replace: true })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [nav])

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setSuggestions([])
      setSuggestHighlight(0)
      setSearchError(null)
      setSearchLoading(false)
      return
    }

    const ac = new AbortController()
    const timer = window.setTimeout(async () => {
      setSearchLoading(true)
      try {
        const res = await apiJson<LocationsSuggestResponse>(
          `/api/technician_portal/locations_suggest?q=${encodeURIComponent(trimmed)}`,
          { signal: ac.signal },
        )
        if (ac.signal.aborted) return
        setSuggestions(res.locations ?? [])
        setSuggestHighlight(0)
        setSearchError(null)
      } catch (err) {
        if (isAbortError(err)) return
        const maybe = err as { code?: string }
        if (maybe?.code === 'portal_locked') {
          nav('/tech', { replace: true })
          return
        }
        setSuggestions([])
        setSearchError('Could not search locations. Try again.')
      } finally {
        if (!ac.signal.aborted) setSearchLoading(false)
      }
    }, 250)

    return () => {
      clearTimeout(timer)
      ac.abort()
    }
  }, [nav, query])

  const openLocation = useCallback(
    (locationId: number) => {
      setInputFocused(false)
      setSuggestions([])
      nav(`/tech/location/${locationId}`)
    },
    [nav],
  )

  const onSearchKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (!dropdownVisible || suggestions.length === 0) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSuggestHighlight((i) => Math.min(i + 1, suggestions.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSuggestHighlight((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        openLocation(suggestions[suggestHighlight].id)
      } else if (e.key === 'Escape') {
        setInputFocused(false)
      }
    },
    [dropdownVisible, openLocation, suggestHighlight, suggestions],
  )

  return (
    <div className="portal-start-scene">
      <div className="portal-start-scene__mesh" aria-hidden="true" />

      <div className="portal-start-page">
        <header className="portal-picker-header">
          <h1 className="portal-picker-header__title">
            {techName ? `Welcome, ${techName}` : 'Welcome'}
          </h1>
          <p className="portal-picker-header__subtitle">Choose what you need to do next.</p>
        </header>

        <section className="portal-picker-glass portal-hub-card" aria-label="Monthly bell testing">
          <button type="button" className="portal-lock-submit btn w-100" onClick={() => nav('/tech/start')}>
            Monthly bell testing
          </button>
        </section>

        <section className="portal-picker-glass portal-hub-card" aria-label="Monthly location lookup">
          <h2 className="portal-start-section-title">Look up a monthly location</h2>
          <p className="portal-hub-card__hint">Search the monthly library for site reference details.</p>

          <div className={`portal-start-lookup-field${searchLoading ? ' portal-start-lookup-field--loading' : ''}`}>
            <Form.Control
              type="search"
              className="portal-glass-input portal-start-lookup-input"
              placeholder="Search by name or address…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKeyDown}
              onFocus={() => setInputFocused(true)}
              onBlur={() => {
                window.setTimeout(() => setInputFocused(false), 200)
              }}
              aria-label="Search monthly locations"
              aria-autocomplete="list"
              aria-expanded={dropdownVisible}
              aria-controls="portal-location-suggest-list"
              aria-busy={searchLoading}
            />
            <div
              className={`portal-start-lookup-spinner-slot${searchLoading ? '' : ' portal-start-lookup-spinner-slot--hidden'}`}
              aria-hidden={!searchLoading}
            >
              <Spinner animation="border" size="sm" className="portal-start-lookup-spinner" aria-hidden />
            </div>
            {dropdownVisible ? (
              <div id="portal-location-suggest-list" className="portal-route-suggest portal-route-suggest--locations" role="listbox">
                {suggestions.map((loc, i) => (
                  <button
                    key={loc.id}
                    type="button"
                    role="option"
                    aria-selected={i === suggestHighlight}
                    className={`portal-route-suggest__item${i === suggestHighlight ? ' portal-route-suggest__item--active' : ''}`}
                    onMouseDown={(ev) => ev.preventDefault()}
                    onMouseEnter={() => setSuggestHighlight(i)}
                    onClick={() => openLocation(loc.id)}
                  >
                    <span className="portal-route-suggest__label">{loc.label}</span>
                    {loc.route_label ? (
                      <span className="portal-route-suggest__number">{loc.route_label}</span>
                    ) : null}
                    <span className="portal-route-suggest__meta">{loc.address}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {searchError ? (
            <div className="portal-start-inline-error" role="alert">
              {searchError}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  )
}
