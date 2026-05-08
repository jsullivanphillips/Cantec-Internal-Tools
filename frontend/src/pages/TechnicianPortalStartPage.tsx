import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Alert, Button, Card, Form, Spinner } from 'react-bootstrap'
import { useNavigate } from 'react-router-dom'
import { apiJson } from '../lib/apiClient'
import { monthFirstIsoLocalToday } from '../features/monthlyRoutes/monthlyRoutesShared'

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

export default function TechnicianPortalStartPage() {
  const nav = useNavigate()
  const [data, setData] = useState<RoutesTodayResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [manual, setManual] = useState('')
  const [manualError, setManualError] = useState<string | null>(null)
  const [lookingUp, setLookingUp] = useState(false)

  const monthIso = useMemo(() => monthFirstIsoLocalToday(), [])

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

  const openRoute = useCallback(
    (routeId: number) => {
      nav(`/tech/route/${routeId}/worksheet/${monthIso}`)
    },
    [monthIso, nav]
  )

  const onManualSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      setManualError(null)
      const trimmed = manual.trim()
      if (!/^\d+$/.test(trimmed)) {
        setManualError('Enter a route number, e.g. 7.')
        return
      }
      const rn = parseInt(trimmed, 10)
      const fromToday = data?.routes.find((r) => r.route_number === rn)
      if (fromToday) {
        openRoute(fromToday.id)
        return
      }
      setLookingUp(true)
      try {
        const res = await apiJson<RouteLookupResponse>(
          `/api/technician_portal/routes_lookup?route_number=${encodeURIComponent(trimmed)}`
        )
        if (res?.route?.id != null) {
          openRoute(res.route.id)
          return
        }
        setManualError(`No route #${trimmed} was found.`)
      } catch (err) {
        const maybe = err as { code?: string; error?: string }
        if (maybe?.code === 'portal_locked') {
          nav('/tech', { replace: true })
          return
        }
        if (maybe?.code === 'not_found') {
          setManualError(`No route #${trimmed} was found.`)
          return
        }
        setManualError('Could not look up that route. Try again.')
      } finally {
        setLookingUp(false)
      }
    },
    [data, manual, nav, openRoute]
  )

  const heading = data?.date ? formatTodayHeading(data.date) : ''

  return (
    <div className="container py-4" style={{ maxWidth: '40rem' }}>
      <div className="mb-4">
        <h1 className="h4 mb-1">Pick a run to start</h1>
        {heading ? <div className="text-muted small">{heading}</div> : null}
      </div>

      {loading ? (
        <div className="d-flex align-items-center gap-2 text-muted py-3">
          <Spinner size="sm" animation="border" /> Loading today’s runs…
        </div>
      ) : null}

      {error ? <Alert variant="danger">{error}</Alert> : null}

      {!loading && data && data.routes.length === 0 ? (
        <Alert variant="info" className="mb-4">
          No runs are scheduled for today. Use the lookup below to start a run for a different route.
        </Alert>
      ) : null}

      {!loading && data && data.routes.length > 0 ? (
        <div className="d-grid gap-2 mb-4">
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

      <Card className="shadow-sm">
        <Card.Body>
          <div className="fw-semibold mb-1">Different route?</div>
          <div className="small text-muted mb-2">
            Type the route number to start a run for it even if it isn’t scheduled for today.
          </div>
          <Form onSubmit={onManualSubmit} className="d-flex gap-2">
            <Form.Control
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="e.g. 7"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              disabled={lookingUp}
            />
            <Button type="submit" variant="outline-primary" disabled={lookingUp || !manual.trim()}>
              {lookingUp ? <Spinner size="sm" animation="border" /> : 'Open'}
            </Button>
          </Form>
          {manualError ? <div className="small text-danger mt-2">{manualError}</div> : null}
        </Card.Body>
      </Card>
    </div>
  )
}
