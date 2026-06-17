import { useCallback, useEffect, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Form, Spinner } from 'react-bootstrap'
import { Link, useNavigate } from 'react-router-dom'
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

function routeMeta(route: PortalRoute): string {
  const stops = `${route.location_count} ${route.location_count === 1 ? 'stop' : 'stops'}`
  return route.display_name ? `${stops} · ${route.display_name}` : stops
}

type RouteCardProps = {
  routeNumber: number
  title: string
  meta: string
  onClick?: () => void
  disabled?: boolean
  demo?: boolean
}

function RouteCard({ routeNumber, title, meta, onClick, disabled, demo }: RouteCardProps) {
  return (
    <button
      type="button"
      className={`portal-route-card${demo ? ' portal-route-card--demo' : ''}${disabled ? ' portal-route-card--disabled' : ''}`}
      onClick={onClick}
      disabled={disabled || !onClick}
    >
      <span className={`portal-route-card__badge${demo ? ' portal-route-card__badge--demo' : ''}`}>
        R{routeNumber}
      </span>
      <span className="portal-route-card__content">
        <span className="portal-route-card__title">{title}</span>
        <span className="portal-route-card__meta">{meta}</span>
      </span>
      {onClick && !disabled ? <i className="bi bi-chevron-right portal-route-card__chevron" aria-hidden /> : null}
    </button>
  )
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
    <div className="portal-start-scene">
      <div className="portal-start-scene__mesh" aria-hidden="true" />

      <div className="portal-start-page">
        <Link to="/tech/home" className="portal-flow-back">
          ← Back to home
        </Link>

        <header className="portal-picker-header">
          <h1 className="portal-picker-header__title">Pick a run to start</h1>
          {heading ? <p className="portal-picker-header__subtitle">{heading}</p> : null}
        </header>

        {error ? (
          <div className="portal-flow-notice portal-flow-notice--error" role="alert">
            {error}
          </div>
        ) : null}

        <section className="portal-picker-glass portal-start-lookup" aria-label="Route lookup">
          <h2 className="portal-start-section-title">Look up by route number</h2>

          <Form onSubmit={onManualSubmit} className="portal-start-lookup-form">
            <div className="portal-start-lookup-field">
              <Form.Control
                type="text"
                className="portal-glass-input"
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
                <div id="portal-route-suggest-list" className="portal-route-suggest" role="listbox">
                  {suggestions.map((r, i) => (
                    <button
                      key={r.id}
                      type="button"
                      role="option"
                      aria-selected={i === suggestHighlight}
                      className={`portal-route-suggest__item${i === suggestHighlight ? ' portal-route-suggest__item--active' : ''}`}
                      onMouseDown={(ev) => ev.preventDefault()}
                      onMouseEnter={() => setSuggestHighlight(i)}
                      onClick={() => pickSuggestion(r)}
                    >
                      <span className="portal-route-suggest__number">R{r.route_number}</span>
                      <span className="portal-route-suggest__label">{r.label}</span>
                      <span className="portal-route-suggest__meta">{routeMeta(r)}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </Form>

          {manualError ? (
            <div className="portal-start-inline-error" role="alert">
              {manualError}
            </div>
          ) : null}
        </section>

        <section className="portal-start-runs" aria-label="Today's runs">
          <h2 className="portal-start-section-title portal-start-section-title--list">Today&apos;s runs</h2>

          {demoSeeded ? (
            <RouteCard
              demo
              routeNumber={demoRouteNumber}
              title="Training route (live sync)"
              meta={`${demoStopCount} practice stops · changes sync like a real run`}
              onClick={openDemoWorksheet}
            />
          ) : (
            <RouteCard
              demo
              routeNumber={demoRouteNumber}
              title="Training route (live sync)"
              meta={
                demoLoading
                  ? 'Loading training route…'
                  : demoInfo?.seed_hint ??
                    'Training route is not set up yet — ask the office to run the seed script.'
              }
              disabled
            />
          )}

          {loading ? (
            <div className="portal-picker-status" role="status">
              <Spinner size="sm" animation="border" className="me-2" />
              Loading today&apos;s runs…
            </div>
          ) : null}

          {!loading && data && data.routes.length === 0 ? (
            <div className="portal-flow-notice portal-flow-notice--muted" role="status">
              No runs are scheduled for today. Use the lookup above if you&apos;re on a different route.
            </div>
          ) : null}

          {!loading && data && data.routes.length > 0 ? (
            <div className="portal-route-list">
              {data.routes.map((r) => (
                <RouteCard
                  key={r.id}
                  routeNumber={r.route_number}
                  title={r.label}
                  meta={routeMeta(r)}
                  onClick={() => openRoute(r.id)}
                />
              ))}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  )
}
