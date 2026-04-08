import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch, isAbortError } from '../lib/apiClient'
import { Card, Col, Row } from 'react-bootstrap'

type NeedsItem = {
  severity: string
  title: string
  subtitle: string
  href: string
  badge?: string
}

/** Session cache: instant paint when navigating back to Home; refreshed in background. */
const HOME_CACHE_KEY = 'scheduleAssist.homeDashboard.v2'
const HOME_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000

/** Align with Processing Attack / home needs_attention thresholds. */
const HOME_KPI_TARGETS = {
  /** Jobs to be marked complete: at most this many is on target */
  jobsToProcessMax: 50,
  /** Completed jobs waiting to invoice: strictly under this count is on target */
  jobsToInvoiceMax: 30,
  /** “Forward schedule coverage” KPI is % confirmed in next 2 weeks (scheduling_attack_v2) */
  confirmedNextTwoWeeksMinPct: 75,
} as const

type JobsTodayPayload = {
  jobs_processed_today?: number
  incoming_jobs_today?: number
}

type HomeCachePayload = {
  ts: number
  kpi: Record<string, number | string>
  jobsToday: JobsTodayPayload | null
  needs: NeedsItem[]
}

type KpiHealth = 'good' | 'bad' | 'unknown'

function toFiniteNumber(v: unknown): number | null {
  if (v == null || v === '—') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function healthClass(h: KpiHealth): string {
  if (h === 'good') return 'processing-tile--status-good'
  if (h === 'bad') return 'processing-tile--status-warn'
  return 'home-kpi-tile--unknown'
}

function jobsToProcessHealth(v: unknown): KpiHealth {
  const n = toFiniteNumber(v)
  if (n == null) return 'unknown'
  return n <= HOME_KPI_TARGETS.jobsToProcessMax ? 'good' : 'bad'
}

function jobsToInvoiceHealth(v: unknown): KpiHealth {
  const n = toFiniteNumber(v)
  if (n == null) return 'unknown'
  return n < HOME_KPI_TARGETS.jobsToInvoiceMax ? 'good' : 'bad'
}

function forwardCoverageHealth(v: unknown): KpiHealth {
  const n = toFiniteNumber(v)
  if (n == null) return 'unknown'
  return n >= HOME_KPI_TARGETS.confirmedNextTwoWeeksMinPct ? 'good' : 'bad'
}

/** Same rule as Processing Attack “job processing progress today”: processed &gt; incoming */
function completedTodayHealth(jobsToday: JobsTodayPayload | null): KpiHealth {
  if (!jobsToday) return 'unknown'
  const p = jobsToday.jobs_processed_today
  const i = jobsToday.incoming_jobs_today
  if (p == null || i == null) return 'unknown'
  return p > i ? 'good' : 'bad'
}

function jobsToBeProcessedNetToday(jobsToday: JobsTodayPayload | null): number | null {
  if (!jobsToday) return null
  const p = jobsToday.jobs_processed_today
  const i = jobsToday.incoming_jobs_today
  if (p == null || i == null) return null
  return p - i
}

function readHomeCache(): HomeCachePayload | null {
  try {
    const raw = sessionStorage.getItem(HOME_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as HomeCachePayload
    if (
      !parsed ||
      typeof parsed.ts !== 'number' ||
      !parsed.kpi ||
      !Array.isArray(parsed.needs) ||
      !('jobsToday' in parsed)
    ) {
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

function writeHomeCache(
  kpi: Record<string, number | string>,
  jobsToday: JobsTodayPayload | null,
  needs: NeedsItem[],
) {
  try {
    sessionStorage.setItem(
      HOME_CACHE_KEY,
      JSON.stringify({ ts: Date.now(), kpi, jobsToday, needs } satisfies HomeCachePayload),
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
  const [jobsToday, setJobsToday] = useState<JobsTodayPayload | null>(null)
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
    const controller = new AbortController()
    let cancelled = false
    const cached = readHomeCache()
    if (cached) {
      setKpi(cached.kpi)
      setJobsToday(cached.jobsToday ?? null)
      setNeeds(cached.needs)
      setLoading(false)
    }

    ;(async () => {
      try {
        const [jp, ji, fc, jt, na] = await Promise.all([
          apiFetch('/home/kpi/jobs_to_process', { signal: controller.signal }).then((r) => r.json()),
          apiFetch('/home/kpi/jobs_to_invoice', { signal: controller.signal }).then((r) => r.json()),
          apiFetch('/home/kpi/forward_schedule_coverage', { signal: controller.signal }).then((r) => r.json()),
          apiFetch('/processing_attack/jobs_today', { signal: controller.signal })
            .then((r) => r.json())
            .catch(() => ({})),
          apiFetch('/home/needs_attention', { signal: controller.signal }).then((r) => r.json()),
        ])
        if (cancelled) return
        const nextKpi = {
          jobs_to_process: jp.jobs_to_process,
          jobs_to_invoice: ji.jobs_to_be_invoiced,
          forward: fc.forward_schedule_coverage,
        }
        const nextJobsToday: JobsTodayPayload = {
          jobs_processed_today:
            typeof jt.jobs_processed_today === 'number' ? jt.jobs_processed_today : undefined,
          incoming_jobs_today:
            typeof jt.incoming_jobs_today === 'number' ? jt.incoming_jobs_today : undefined,
        }
        const nextNeeds = (na.items || []) as NeedsItem[]
        setKpi(nextKpi)
        setJobsToday(nextJobsToday)
        setNeeds(nextNeeds)
        writeHomeCache(nextKpi, nextJobsToday, nextNeeds)
      } catch (e) {
        if (isAbortError(e)) return
        console.error(e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])

  if (loading) {
    return <HomeSkeleton />
  }

  const forwardNum = toFiniteNumber(kpi.forward)
  const forwardDisplay = forwardNum != null ? `${forwardNum}%` : (kpi.forward ?? '—')
  const jobsToBeProcessedNet = jobsToBeProcessedNetToday(jobsToday)

  return (
    <div className="home-page d-flex flex-column gap-4 py-3 px-2">
      <Card className="app-surface-card home-overview-card">
        <Card.Header as="h1" className="processing-page-title mb-0">
          Home
        </Card.Header>
        <Card.Body>
          <div className="text-muted small mb-4">{dateStr}</div>
          <Row className="g-3">
            <Col xs={12} sm={6} lg={3}>
              <Link to="/processing_attack" className="text-decoration-none text-reset">
                <Card
                  className={`app-kpi-nested processing-tile home-kpi-tile ${healthClass(jobsToProcessHealth(kpi.jobs_to_process))} h-100`}
                >
                  <Card.Body>
                    <div className="small home-kpi-tile__label">Jobs to be processed</div>
                    <div className="display-6 home-kpi-tile__value">{kpi.jobs_to_process ?? '—'}</div>
                  </Card.Body>
                </Card>
              </Link>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Link to="/processing_attack" className="text-decoration-none text-reset">
                <Card
                  className={`app-kpi-nested processing-tile home-kpi-tile ${healthClass(jobsToInvoiceHealth(kpi.jobs_to_invoice))} h-100`}
                >
                  <Card.Body>
                    <div className="small home-kpi-tile__label">Jobs to be invoiced</div>
                    <div className="display-6 home-kpi-tile__value">{kpi.jobs_to_invoice ?? '—'}</div>
                  </Card.Body>
                </Card>
              </Link>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Link to="/scheduling_attack" className="text-decoration-none text-reset">
                <Card
                  className={`app-kpi-nested processing-tile home-kpi-tile ${healthClass(forwardCoverageHealth(kpi.forward))} h-100`}
                >
                  <Card.Body>
                    <div className="small home-kpi-tile__label">Confirmed (next 2 weeks)</div>
                    <div className="display-6 home-kpi-tile__value">{forwardDisplay}</div>
                  </Card.Body>
                </Card>
              </Link>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Link to="/processing_attack" className="text-decoration-none text-reset">
                <Card
                  className={`app-kpi-nested processing-tile home-kpi-tile ${healthClass(completedTodayHealth(jobsToday))} h-100`}
                >
                  <Card.Body>
                  <div className="small home-kpi-tile__label">Job processing progress today</div>
                  <div className="display-6 home-kpi-tile__value">
                    {jobsToBeProcessedNet == null
                      ? '—'
                      : `${jobsToBeProcessedNet > 0 ? '+' : ''}${jobsToBeProcessedNet}`}
                  </div>
                  </Card.Body>
                </Card>
              </Link>
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
