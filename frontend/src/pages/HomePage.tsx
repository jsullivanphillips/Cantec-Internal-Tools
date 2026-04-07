import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../lib/apiClient'
import { Card, Col, Row } from 'react-bootstrap'

type NeedsItem = {
  severity: string
  title: string
  subtitle: string
  href: string
  badge?: string
}

/** Session cache: instant paint when navigating back to Home; refreshed in background. */
const HOME_CACHE_KEY = 'scheduleAssist.homeDashboard.v1'
const HOME_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000

type HomeCachePayload = {
  ts: number
  kpi: Record<string, number | string>
  needs: NeedsItem[]
}

function readHomeCache(): HomeCachePayload | null {
  try {
    const raw = sessionStorage.getItem(HOME_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as HomeCachePayload
    if (!parsed || typeof parsed.ts !== 'number' || !parsed.kpi || !Array.isArray(parsed.needs)) {
      return null
    }
    if (Date.now() - parsed.ts > HOME_CACHE_MAX_AGE_MS) {
      sessionStorage.removeItem(HOME_CACHE_KEY)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function writeHomeCache(kpi: Record<string, number | string>, needs: NeedsItem[]) {
  try {
    sessionStorage.setItem(
      HOME_CACHE_KEY,
      JSON.stringify({ ts: Date.now(), kpi, needs } satisfies HomeCachePayload)
    )
  } catch {
    /* storage full or disabled */
  }
}

function pillClass(sev: string) {
  if (sev === 'bad') return 'danger'
  if (sev === 'warn') return 'warning'
  return 'secondary'
}

function HomeSkeleton() {
  return (
    <div
      className="home-skeleton d-flex flex-column gap-4"
      aria-busy="true"
      aria-label="Loading dashboard"
    >
      <Card className="app-surface-card">
        <Card.Header className="h4 mb-0 py-3">
          <span className="home-skeleton-bar d-block" style={{ width: '8rem' }} />
        </Card.Header>
        <Card.Body>
          <span className="home-skeleton-bar d-block mb-4" style={{ width: 'min(18rem, 85%)' }} />
          <Row className="g-3">
            {[0, 1, 2, 3].map((i) => (
              <Col key={i} xs={12} sm={6} lg={3}>
                <Card className="app-kpi-nested h-100">
                  <Card.Body>
                    <span className="home-skeleton-bar d-block mb-2" style={{ width: '72%' }} />
                    <span className="home-skeleton-bar home-skeleton-bar--value d-block" style={{ width: '42%' }} />
                  </Card.Body>
                </Card>
              </Col>
            ))}
          </Row>
        </Card.Body>
      </Card>

      <Card className="app-surface-card">
        <Card.Header className="h5 mb-0 py-3">
          <span className="home-skeleton-bar d-block" style={{ width: '10rem' }} />
        </Card.Header>
        <Card.Body className="d-flex flex-column gap-2">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="app-kpi-nested">
              <Card.Body className="d-flex align-items-center gap-3 py-3">
                <span className="home-skeleton-dot" aria-hidden />
                <div className="flex-grow-1 min-w-0 d-flex flex-column gap-2">
                  <span className="home-skeleton-bar d-block" style={{ width: '38%' }} />
                  <span className="home-skeleton-bar d-block" style={{ width: '82%' }} />
                </div>
              </Card.Body>
            </Card>
          ))}
        </Card.Body>
      </Card>
    </div>
  )
}

export default function HomePage() {
  const [dateStr, setDateStr] = useState('')
  const [kpi, setKpi] = useState<Record<string, number | string>>({})
  const [needs, setNeeds] = useState<NeedsItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const today = new Date()
    setDateStr(
      today.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    )
  }, [])

  useEffect(() => {
    let cancelled = false
    const cached = readHomeCache()
    if (cached) {
      setKpi(cached.kpi)
      setNeeds(cached.needs)
      setLoading(false)
    }

    ;(async () => {
      try {
        const [jp, ji, fc, jc, na] = await Promise.all([
          apiFetch('/home/kpi/jobs_to_process').then((r) => r.json()),
          apiFetch('/home/kpi/jobs_to_invoice').then((r) => r.json()),
          apiFetch('/home/kpi/forward_schedule_coverage').then((r) => r.json()),
          apiFetch('/home/kpi/jobs_completed_today').then((r) => r.json()),
          apiFetch('/home/needs_attention').then((r) => r.json()),
        ])
        if (cancelled) return
        const nextKpi = {
          jobs_to_process: jp.jobs_to_process,
          jobs_to_invoice: ji.jobs_to_be_invoiced,
          forward: fc.forward_schedule_coverage,
          completed: jc.jobs_completed_today,
        }
        const nextNeeds = (na.items || []) as NeedsItem[]
        setKpi(nextKpi)
        setNeeds(nextNeeds)
        writeHomeCache(nextKpi, nextNeeds)
      } catch (e) {
        console.error(e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return <HomeSkeleton />
  }

  return (
    <div className="home-page d-flex flex-column gap-4">
      <Card className="app-surface-card home-overview-card">
        <Card.Header as="h1" className="h4 mb-0">
          Home
        </Card.Header>
        <Card.Body>
          <div className="text-muted small mb-4">{dateStr}</div>
          <Row className="g-3">
            <Col xs={12} sm={6} lg={3}>
              <Link to="/processing_attack" className="text-decoration-none text-reset">
                <Card className="app-kpi-nested h-100">
                  <Card.Body>
                    <div className="small text-muted">Jobs to be processed</div>
                    <div className="display-6">{kpi.jobs_to_process ?? '—'}</div>
                  </Card.Body>
                </Card>
              </Link>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Link to="/processing_attack" className="text-decoration-none text-reset">
                <Card className="app-kpi-nested h-100">
                  <Card.Body>
                    <div className="small text-muted">Jobs to be invoiced</div>
                    <div className="display-6">{kpi.jobs_to_invoice ?? '—'}</div>
                  </Card.Body>
                </Card>
              </Link>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Link to="/scheduling_attack" className="text-decoration-none text-reset">
                <Card className="app-kpi-nested h-100">
                  <Card.Body>
                    <div className="small text-muted">Forward schedule coverage</div>
                    <div className="display-6">{kpi.forward ?? '—'}</div>
                  </Card.Body>
                </Card>
              </Link>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Card className="app-kpi-nested h-100">
                <Card.Body>
                  <div className="small text-muted">Jobs completed today</div>
                  <div className="display-6">{kpi.completed ?? '—'}</div>
                </Card.Body>
              </Card>
            </Col>
          </Row>
        </Card.Body>
      </Card>

      <Card className="app-surface-card home-attention-card">
        <Card.Header as="h2" className="h5 mb-0">
          Needs Attention
        </Card.Header>
        <Card.Body>
          <div className="d-flex flex-column gap-2">
            {needs.length === 0 && <div className="text-muted">No alerts right now.</div>}
            {needs.map((it, i) => (
              <Link key={i} to={it.href} className="text-decoration-none text-reset">
                <Card
                  className={`app-kpi-nested home-attention-item home-attention-item--${it.severity || 'default'}`}
                  border={it.severity === 'bad' ? 'danger' : it.severity === 'warn' ? 'warning' : undefined}
                >
                  <Card.Body className="d-flex align-items-center gap-3 py-2">
                    {it.badge && (
                      <span className={`badge text-bg-${pillClass(it.severity)}`}>{it.badge}</span>
                    )}
                    <div>
                      <div className="fw-semibold text-body">{it.title}</div>
                      <div className="small text-muted">{it.subtitle}</div>
                    </div>
                  </Card.Body>
                </Card>
              </Link>
            ))}
          </div>
        </Card.Body>
      </Card>
    </div>
  )
}
