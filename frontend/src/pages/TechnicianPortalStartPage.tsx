import { useCallback, useEffect, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Alert, Button, Card, Form, ListGroup, Spinner } from 'react-bootstrap'
import { useNavigate } from 'react-router-dom'
import { apiJson, isAbortError } from '../lib/apiClient'
import { monthFirstIsoPacificToday } from '../features/monthlyRoutes/monthlyRoutesShared'
import {
  DEFAULT_TECHNICIAN_DEMO_ROUTE_NUMBER,
  useTechnicianDemoRouteInfo,
} from '../features/monthlyRoutes/technicianDemoRoute'

type PortalRoute = {
  id: number
  route_number: number
  display_name: string | null
  weekday_iso: number
  week_occurrence: number
  label: string
  location_count: number
}

type RoutesTodayResponse = {
  date: string
  weekday_iso: number
  week_occurrence: number
  routes: PortalRoute[]
}

type RouteLookupResponse = {
  route: PortalRoute
}

type RoutesSuggestResponse = {
  routes: PortalRoute[]
}

function formatTodayHeading(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1))
  return new Intl.DateTimeFormat('en-CA', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(dt)
}

/** Digits after optional ``R`` prefix (leading zeros collapsed). */
function normalizePortalRouteQuery(raw: string): string | null {
  let s = raw.trim()
  if (!s) return null
  if (s[0].toUpperCase() === 'R') {
    s = s.slice(1).trim()
  }
  if (!s || !/^\d+$/.test(s)) return null
  const collapsed = s.replace(/^0+/, '')
  return collapsed.length > 0 ? collapsed : '0'
}

export default function TechnicianPortalStartPage() {
  const nav = useNavigate()
  const [data, setData] = useState<RoutesTodayResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [manual, setManual] = useState('')
  const [manualError, setManualError] = useState<string | null>(null)
  const [lookingUp, setLookingUp] = useState(false)
  const [suggestions, setSuggestions] = useState<PortalRoute[]>([])
  const [suggestHighlight, setSuggestHighlight] = useState(0)
  const [inputFocused, setInputFocused] = useState(false)
  const { info: demoInfo, loading: demoLoading } = useTechnicianDemoRouteInfo()

  const dropdownVisible = inputFocused && suggestions.length > 0 && !lookingUp

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const payload = await apiJson<RoutesTodayResponse>('/api/technician_portal/routes_today')
        if (cancelled) return
        setData(payload)
      } catch (e) {
        if (cancelled) return
        const maybe = e as { code?: string }
        if (maybe?.code === 'portal_locked') {
          nav('/tech', { replace: true })
          return
        }
        setError('Unable to load today’s routes. Try again in a moment.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [nav])

  useEffect(() => {
    const trimmed = manual.trim()
    if (!trimmed) {
      setSuggestions([])
      setSuggestHighlight(0)
      return
    }

    const ac = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        const res = await apiJson<RoutesSuggestResponse>(
          `/api/technician_portal/routes_suggest?q=${encodeURIComponent(trimmed)}`,
          { signal: ac.signal }
        )
        setSuggestions(res.routes ?? [])
        setSuggestHighlight(0)
      } catch (err) {
        if (isAbortError(err)) return
        const maybe = err as { code?: string }
        if (maybe?.code === 'portal_locked') {
          nav('/tech', { replace: true })
          return
        }
        setSuggestions([])
      }
    }, 200)

    return () => {
      clearTimeout(timer)
      ac.abort()
    }
  }, [manual, nav])

  const openRoute = useCallback(
    (routeId: number) => {
      nav(`/tech/route/${routeId}`)
    },
    [nav],
  )

  const openDemoWorksheet = useCallback(() => {
    if (!demoInfo?.seeded || !demoInfo.route?.id) return
    const month = demoInfo.current_month_first || monthFirstIsoPacificToday()
    nav(`/tech/route/${demoInfo.route.id}/worksheet/${month}`)
  }, [demoInfo, nav])

  const demoRouteNumber = demoInfo?.route_number ?? DEFAULT_TECHNICIAN_DEMO_ROUTE_NUMBER
  const demoStopCount = demoInfo?.route?.location_count ?? 5
  const demoSeeded = demoInfo?.seeded === true

  const pickSuggestion = useCallback(
    (route: PortalRoute) => {
      setInputFocused(false)
      setSuggestions([])
      openRoute(route.id)
    },
    [openRoute],
  )

  const onManualSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      setManualError(null)
      const token = normalizePortalRouteQuery(manual)
      if (!token) {
        setManualError('Enter a route number, e.g. R7 or 7.')
        return
      }
      const rn = parseInt(token, 10)
      const fromToday = data?.routes.find((r) => r.route_number === rn)
      if (fromToday) {
        openRoute(fromToday.id)
        return
      }
      setLookingUp(true)
      try {
        const res = await apiJson<RouteLookupResponse>(
          `/api/technician_portal/routes_lookup?route_number=${encodeURIComponent(token)}`
        )
        if (res?.route?.id != null) {
          openRoute(res.route.id)
          return
        }
        setManualError(`No route #${token} was found.`)
      } catch (err) {
        const maybe = err as { code?: string; error?: string }
        if (maybe?.code === 'portal_locked') {
          nav('/tech', { replace: true })
          return
        }
        if (maybe?.code === 'not_found') {
          setManualError(`No route #${token} was found.`)
          return
        }
        setManualError('Could not look up that route. Try again.')
      } finally {
        setLookingUp(false)
      }
    },
    [data, manual, nav, openRoute],
  )

  const onManualKeyDown = useCallback(
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
        pickSuggestion(suggestions[suggestHighlight])
      } else if (e.key === 'Escape') {
        setInputFocused(false)
      }
    },
    [dropdownVisible, pickSuggestion, suggestHighlight, suggestions],
  )

  const heading = data?.date ? formatTodayHeading(data.date) : ''

  return (
    <div className="container py-4" style={{ maxWidth: '40rem' }}>
      <div className="mb-4">
        <h1 className="h4 mb-1">Pick a run to start</h1>
        {heading ? <div className="text-muted small">{heading}</div> : null}
      </div>

      {error ? <Alert variant="danger">{error}</Alert> : null}

      <Card className="shadow-sm mb-4">
        <Card.Body>
          <div className="fw-semibold mb-1">Look up by route number</div>
          <div className="small text-muted mb-2">
            Type <strong>R18</strong> or <strong>18</strong>; choose from suggestions or press Open.
          </div>
          <Form onSubmit={onManualSubmit} className="d-flex flex-column flex-sm-row gap-2 align-items-stretch">
            <div className="flex-grow-1 position-relative min-w-0">
              <Form.Control
                type="text"
                autoComplete="off"
                placeholder="e.g. R18 or 18"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                onKeyDown={onManualKeyDown}
                onFocus={() => setInputFocused(true)}
                onBlur={() => {
                  window.setTimeout(() => setInputFocused(false), 200)
                }}
                disabled={lookingUp}
                aria-label="Route number"
                aria-autocomplete="list"
                aria-expanded={dropdownVisible}
                aria-controls="portal-route-suggest-list"
                id="portal-route-lookup-input"
              />
              {dropdownVisible ? (
                <ListGroup
                  id="portal-route-suggest-list"
                  variant="flush"
                  className="position-absolute top-100 start-0 end-0 mt-1 shadow-sm border rounded overflow-hidden bg-white"
                  style={{ zIndex: 25 }}
                >
                  {suggestions.map((r, i) => (
                    <ListGroup.Item
                      key={r.id}
                      as="button"
                      type="button"
                      action
                      aria-selected={i === suggestHighlight}
                      className={`text-start py-2 px-3${i === suggestHighlight ? ' bg-primary-subtle' : ''}`}
                      onMouseDown={(ev) => ev.preventDefault()}
                      onMouseEnter={() => setSuggestHighlight(i)}
                      onClick={() => pickSuggestion(r)}
                    >
                      <span className="fw-semibold">R{r.route_number}</span>
                      <span className="text-muted small ms-2">{r.label}</span>
                      <span className="d-block small text-muted">
                        {r.location_count} {r.location_count === 1 ? 'stop' : 'stops'}
                        {r.display_name ? ` · ${r.display_name}` : ''}
                      </span>
                    </ListGroup.Item>
                  ))}
                </ListGroup>
              ) : null}
            </div>
            <Button
              type="submit"
              variant="outline-primary"
              className="flex-shrink-0 align-self-sm-start"
              disabled={lookingUp || !manual.trim()}
            >
              {lookingUp ? <Spinner size="sm" animation="border" /> : 'Open'}
            </Button>
          </Form>
          {manualError ? <div className="small text-danger mt-2">{manualError}</div> : null}
        </Card.Body>
      </Card>

      <div className="fw-semibold mb-2">Today’s runs</div>

      {demoSeeded ? (
        <Card
          as="button"
          type="button"
          className="text-start shadow-sm border border-info border-2 mb-3 tw-portal-route-card"
          onClick={openDemoWorksheet}
        >
          <Card.Body className="d-flex align-items-center justify-content-between gap-3 py-3">
            <div className="d-flex align-items-center gap-3">
              <div
                className="rounded-3 bg-info text-white fw-semibold d-flex align-items-center justify-content-center"
                style={{ width: '3.25rem', height: '3.25rem', fontSize: '1.1rem' }}
              >
                R{demoRouteNumber}
              </div>
              <div>
                <div className="fw-semibold">Training route (live sync)</div>
                <div className="small text-muted">
                  {demoStopCount} practice stops · changes sync like a real run
                </div>
              </div>
            </div>
            <i className="bi bi-chevron-right text-muted" aria-hidden />
          </Card.Body>
        </Card>
      ) : (
        <Card className="text-start shadow-sm border border-info border-2 mb-3 tw-portal-route-card opacity-75">
          <Card.Body className="d-flex align-items-center justify-content-between gap-3 py-3">
            <div className="d-flex align-items-center gap-3">
              <div
                className="rounded-3 bg-info text-white fw-semibold d-flex align-items-center justify-content-center"
                style={{ width: '3.25rem', height: '3.25rem', fontSize: '1.1rem' }}
              >
                R{demoRouteNumber}
              </div>
              <div>
                <div className="fw-semibold">Training route (live sync)</div>
                <div className="small text-muted">
                  {demoLoading
                    ? 'Loading training route…'
                    : demoInfo?.seed_hint ??
                      'Training route is not set up yet — ask the office to run the seed script.'}
                </div>
              </div>
            </div>
          </Card.Body>
        </Card>
      )}

      {loading ? (
        <div className="d-flex align-items-center gap-2 text-muted py-3 mb-2">
          <Spinner size="sm" animation="border" /> Loading today’s runs…
        </div>
      ) : null}

      {!loading && data && data.routes.length === 0 ? (
        <Alert variant="info" className="mb-0">
          No runs are scheduled for today. Use the lookup above if you’re on a different route.
        </Alert>
      ) : null}

      {!loading && data && data.routes.length > 0 ? (
        <div className="d-grid gap-2">
          {data.routes.map((r) => (
            <Card
              key={r.id}
              as="button"
              type="button"
              className="text-start shadow-sm border-0 tw-portal-route-card"
              onClick={() => openRoute(r.id)}
            >
              <Card.Body className="d-flex align-items-center justify-content-between gap-3 py-3">
                <div className="d-flex align-items-center gap-3">
                  <div
                    className="rounded-3 bg-primary text-white fw-semibold d-flex align-items-center justify-content-center"
                    style={{ width: '3.25rem', height: '3.25rem', fontSize: '1.1rem' }}
                  >
                    R{r.route_number}
                  </div>
                  <div>
                    <div className="fw-semibold">{r.label}</div>
                    <div className="small text-muted">
                      {r.location_count} {r.location_count === 1 ? 'stop' : 'stops'}
                      {r.display_name ? ` · ${r.display_name}` : ''}
                    </div>
                  </div>
                </div>
                <i className="bi bi-chevron-right text-muted" aria-hidden />
              </Card.Body>
            </Card>
          ))}
        </div>
      ) : null}

    </div>
  )
}
