import { useEffect, useMemo, useState } from 'react'
import { apiJson, isAbortError } from '../lib/apiClient'
import { Card, Col, Row } from 'react-bootstrap'
import { Chart } from 'react-chartjs-2'

type SchedulingKpis = {
  confirmed_pct?: number
}

type WeeklySchedulingVolumeResponse = {
  job_type: string
  generated_at: string | null
  weeks: Array<{
    period_start: string
    period_end: string
    scheduled: number
    rescheduled: number
  }>
}

type ForwardScheduleCoverageResponse = {
  generated_at: string
  threshold_pct: number
  coverage_weeks_60pct: number
  weeks: Array<{
    week_start_local: string
    week_end_local: string
    utilization_pct: number
    meets_60pct: boolean
  }>
}

export default function SchedulingAttackPage() {
  const [loading, setLoading] = useState(true)
  const [kpis, setKpis] = useState<SchedulingKpis | null>(null)
  const [weekly, setWeekly] = useState<WeeklySchedulingVolumeResponse | null>(null)
  const [forward, setForward] = useState<ForwardScheduleCoverageResponse | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    const run = async () => {
      setLoading(true)
      try {
        const [kpiPayload, weeklyPayload, forwardPayload] = await Promise.all([
          apiJson<SchedulingKpis>('/scheduling_attack/v2/kpis', { signal: controller.signal }),
          apiJson<WeeklySchedulingVolumeResponse>('/scheduling_attack/v2/weekly_scheduling_volume', {
            signal: controller.signal,
          }),
          apiJson<ForwardScheduleCoverageResponse>('/scheduling_attack/v2/forward_schedule_coverage', {
            signal: controller.signal,
          }),
        ])
        if (!active) return
        setKpis(kpiPayload)
        setWeekly(weeklyPayload)
        setForward(forwardPayload)
      } catch (error) {
        if (isAbortError(error)) return
        console.error(error)
        if (!active) return
        setKpis(null)
        setWeekly(null)
        setForward(null)
      } finally {
        if (active) setLoading(false)
      }
    }
    void run()
    return () => {
      active = false
      controller.abort()
    }
  }, [])

  const weeklyPoints = weekly?.weeks ?? []
  const forwardWeeks = (forward?.weeks ?? []).slice(1, 11)
  const previousWeek = weeklyPoints.length > 1 ? weeklyPoints[weeklyPoints.length - 2] : null

  const weeklyChartData = useMemo(() => {
    if (!weeklyPoints.length) return null
    const labels = weeklyPoints.map((w) => formatShortDate(w.period_start))
    return {
      labels,
      datasets: [
        {
          type: 'bar' as const,
          label: 'Scheduled',
          data: weeklyPoints.map((w) => Number(w.scheduled || 0)),
          backgroundColor: '#4aa3ff',
          borderRadius: 6,
          maxBarThickness: 44,
          order: 2,
        },
        {
          type: 'line' as const,
          label: 'Rescheduled',
          data: weeklyPoints.map((w) => Number(w.rescheduled || 0)),
          borderColor: '#1f2d3d',
          borderWidth: 2,
          pointRadius: 2,
          pointHoverRadius: 3,
          tension: 0.3,
          fill: false,
          order: 1,
        },
      ],
    }
  }, [weeklyPoints])

  const weeklyChartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'top' as const },
        datalabels: { display: false },
      },
      scales: {
        x: {
          grid: { display: false },
        },
        y: {
          beginAtZero: true,
          ticks: { precision: 0 },
        },
      },
    }),
    [],
  )

  const forwardChartData = useMemo(() => {
    if (!forwardWeeks.length) return null
    const labels = forwardWeeks.map((w) => formatShortDate(w.week_start_local))
    return {
      labels,
      datasets: [
        {
          type: 'line' as const,
          label: 'Utilization',
          data: forwardWeeks.map((w) => clampPct(w.utilization_pct)),
          borderColor: '#1e90ff',
          borderWidth: 3,
          pointRadius: 0,
          pointHoverRadius: 3,
          tension: 0.3,
          fill: false,
        },
        {
          type: 'line' as const,
          label: '60% target',
          data: forwardWeeks.map(() => 60),
          borderColor: '#ff6b81',
          borderWidth: 2,
          borderDash: [6, 6],
          pointRadius: 0,
          tension: 0,
          fill: false,
        },
      ],
    }
  }, [forwardWeeks])

  const forwardChartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        datalabels: { display: false },
      },
      scales: {
        x: {
          grid: { display: false },
        },
        y: {
          beginAtZero: true,
          min: 0,
          max: 100,
          ticks: {
            stepSize: 25,
            callback: (value: string | number) => {
              const n = Number(value)
              return n % 25 === 0 ? `${n}%` : ''
            },
          },
        },
      },
    }),
    [],
  )

  const confirmedPct = Number(kpis?.confirmed_pct ?? 0)
  const scheduledLastWeek = previousWeek ? Number(previousWeek.scheduled ?? 0) : null
  const rescheduledLastWeek = previousWeek ? Number(previousWeek.rescheduled ?? 0) : null
  const coverageWeeks = Number(forward?.coverage_weeks_60pct ?? 0)
  const confirmedOk = confirmedPct >= 90
  const scheduledOk = (scheduledLastWeek ?? 0) > 30
  const coverageOk = coverageWeeks >= 6
  const rescheduledHasValue = rescheduledLastWeek != null
  const rescheduledIsZero = (rescheduledLastWeek ?? 0) === 0

  return (
    <div className="container-fluid py-3 px-2 scheduling-page d-flex flex-column gap-3">
      <Card className="app-surface-card">
        <Card.Body className="p-3 p-md-4">
          <h1 className="processing-page-title mb-1">Scheduling Attack</h1>
          <p className="processing-page-subtitle mb-0">
            Monitor confirmation health, weekly scheduling output, and forward utilization coverage.
          </p>
        </Card.Body>
      </Card>

      {loading ? (
        <SchedulingAttackSkeleton />
      ) : (
        <>
          <Row className="g-3">
            <Col lg={3} md={6}>
              <Card
                className={`app-kpi-nested processing-tile h-100 scheduling-kpi-tile ${
                  confirmedOk ? 'processing-tile--status-good' : 'processing-tile--status-warn'
                }`}
              >
                <Card.Body className="scheduling-kpi-tile__body">
                  <div className="processing-kpi-label">Next 2 Weeks Confirmed</div>
                  <div className="scheduling-kpi-main">
                    <div className={`scheduling-kpi-tile__value ${confirmedOk ? 'processing-stat--good' : 'processing-stat--warn'}`}>
                      {formatPercent(confirmedPct)}
                    </div>
                  </div>
                  <div className="processing-kpi-target">Target: &gt; 90%</div>
                </Card.Body>
              </Card>
            </Col>
            <Col lg={3} md={6}>
              <Card
                className={`app-kpi-nested processing-tile h-100 scheduling-kpi-tile ${
                  scheduledOk ? 'processing-tile--status-good' : 'processing-tile--status-warn'
                }`}
              >
                <Card.Body className="scheduling-kpi-tile__body">
                  <div className="processing-kpi-label">Scheduling Volume Last Week</div>
                  <div className="scheduling-kpi-main">
                    <div className={`scheduling-kpi-tile__value ${scheduledOk ? 'processing-stat--good' : 'processing-stat--warn'}`}>
                      {scheduledLastWeek ?? '—'}
                    </div>
                  </div>
                  <div className="processing-kpi-target">Target: &gt; 30 - Inspections only</div>
                </Card.Body>
              </Card>
            </Col>
            <Col lg={3} md={6}>
              <Card
                className={`app-kpi-nested processing-tile h-100 scheduling-kpi-tile ${
                  rescheduledHasValue && !rescheduledIsZero ? 'processing-tile--status-good' : 'scheduling-kpi-tile--neutral'
                }`}
              >
                <Card.Body className="scheduling-kpi-tile__body">
                  <div className="processing-kpi-label">Jobs Rescheduled Last Week</div>
                  <div className="scheduling-kpi-main">
                    <div
                      className={`scheduling-kpi-tile__value ${
                        rescheduledHasValue && !rescheduledIsZero
                          ? 'processing-stat--good'
                          : 'scheduling-kpi-tile__value--neutral'
                      }`}
                    >
                      {rescheduledLastWeek ?? '—'}
                    </div>
                  </div>
                  <div className="processing-kpi-target">&nbsp;</div>
                </Card.Body>
              </Card>
            </Col>
            <Col lg={3} md={6}>
              <Card
                className={`app-kpi-nested processing-tile h-100 scheduling-kpi-tile ${
                  coverageOk ? 'processing-tile--status-good' : 'processing-tile--status-warn'
                }`}
              >
                <Card.Body className="scheduling-kpi-tile__body">
                  <div className="processing-kpi-label">Forward Schedule Coverage</div>
                  <div className="scheduling-kpi-main">
                    <div className={`scheduling-kpi-tile__value ${coverageOk ? 'processing-stat--good' : 'processing-stat--warn'}`}>
                      {coverageWeeks} weeks
                    </div>
                  </div>
                  <div className="processing-kpi-target">Target: 6+ Weeks at &gt; 60% booked</div>
                </Card.Body>
              </Card>
            </Col>
          </Row>

          <Card className="app-surface-card scheduling-chart-card">
            <Card.Body>
              <div className="scheduling-chart-card__header">
                <h2 className="h6 mb-0">Weekly Scheduling Volume</h2>
                <span className="scheduling-chart-card__updated">Updated {formatUpdated(weekly?.generated_at)}</span>
              </div>
              <div className="scheduling-chart-card__canvas">
                {weeklyChartData ? (
                  <Chart type="bar" data={weeklyChartData} options={weeklyChartOptions} />
                ) : (
                  <div className="scheduling-chart-card__empty">No scheduling volume yet</div>
                )}
              </div>
            </Card.Body>
          </Card>

          <Card className="app-surface-card scheduling-chart-card">
            <Card.Body>
              <div className="scheduling-chart-card__header">
                <h2 className="h6 mb-0">Forward Schedule Utilization</h2>
                <span className="scheduling-chart-card__updated">Updated {formatUpdated(forward?.generated_at)}</span>
              </div>
              <div className="scheduling-chart-card__canvas scheduling-chart-card__canvas--tall">
                {forwardChartData ? (
                  <Chart type="line" data={forwardChartData} options={forwardChartOptions} />
                ) : (
                  <div className="scheduling-chart-card__empty">No forward utilization data</div>
                )}
              </div>
            </Card.Body>
          </Card>
        </>
      )}
    </div>
  )
}

function SchedulingAttackSkeleton() {
  return (
    <div className="home-skeleton d-flex flex-column gap-3" aria-busy="true" aria-label="Loading scheduling metrics">
      <Row className="g-3">
        {Array.from({ length: 4 }).map((_, idx) => (
          <Col lg={3} md={6} key={`sched-kpi-skel-${idx}`}>
            <Card className="app-kpi-nested processing-tile h-100 scheduling-kpi-tile">
              <Card.Body className="scheduling-kpi-tile__body">
                <span className="home-skeleton-bar d-block" style={{ width: '72%' }} />
                <div className="scheduling-kpi-main">
                  <span className="home-skeleton-bar home-skeleton-bar--value d-block" style={{ width: '48%' }} />
                </div>
                <span className="home-skeleton-bar d-block" style={{ width: '82%' }} />
              </Card.Body>
            </Card>
          </Col>
        ))}
      </Row>

      <Card className="app-surface-card scheduling-chart-card">
        <Card.Body>
          <div className="scheduling-chart-card__header">
            <span className="home-skeleton-bar d-block" style={{ width: '12rem', height: '1.1rem' }} />
            <span className="home-skeleton-bar d-block" style={{ width: '7rem', height: '0.9rem' }} />
          </div>
          <div className="scheduling-chart-card__canvas">
            <div className="scheduling-chart-skeleton">
              <div className="scheduling-chart-skeleton__grid">
                <span className="home-skeleton-bar d-block" />
                <span className="home-skeleton-bar d-block" />
                <span className="home-skeleton-bar d-block" />
                <span className="home-skeleton-bar d-block" />
              </div>
              <div className="scheduling-chart-skeleton__series">
                <span className="home-skeleton-bar d-block" style={{ width: '14%' }} />
                <span className="home-skeleton-bar d-block" style={{ width: '22%' }} />
                <span className="home-skeleton-bar d-block" style={{ width: '18%' }} />
                <span className="home-skeleton-bar d-block" style={{ width: '26%' }} />
                <span className="home-skeleton-bar d-block" style={{ width: '16%' }} />
              </div>
              <span className="home-skeleton-bar d-block scheduling-chart-skeleton__xaxis" />
            </div>
          </div>
        </Card.Body>
      </Card>

      <Card className="app-surface-card scheduling-chart-card">
        <Card.Body>
          <div className="scheduling-chart-card__header">
            <span className="home-skeleton-bar d-block" style={{ width: '14rem', height: '1.1rem' }} />
            <span className="home-skeleton-bar d-block" style={{ width: '7rem', height: '0.9rem' }} />
          </div>
          <div className="scheduling-chart-card__canvas scheduling-chart-card__canvas--tall">
            <div className="scheduling-chart-skeleton">
              <div className="scheduling-chart-skeleton__grid">
                <span className="home-skeleton-bar d-block" />
                <span className="home-skeleton-bar d-block" />
                <span className="home-skeleton-bar d-block" />
                <span className="home-skeleton-bar d-block" />
              </div>
              <div className="scheduling-chart-skeleton__line-wrap">
                <span className="home-skeleton-bar d-block scheduling-chart-skeleton__line" />
              </div>
              <span className="home-skeleton-bar d-block scheduling-chart-skeleton__xaxis" />
            </div>
          </div>
        </Card.Body>
      </Card>
    </div>
  )
}

function formatShortDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatUpdated(value?: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function formatPercent(value: number): string {
  return `${Number.isFinite(value) ? value.toFixed(1) : '0.0'} %`
}

function clampPct(value: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, n))
}
