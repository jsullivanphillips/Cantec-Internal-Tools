import { useEffect, useMemo, useState } from 'react'
import { apiJson, isAbortError } from '../lib/apiClient'
import { Card, Col, Row, Modal, Table, Button, Spinner, Form } from 'react-bootstrap'
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

type ScheduledTodayActivityResponse = {
  baseline_date_local: string
  scheduled_today_count: number
  rescheduled_to_today_count: number
  generated_at: string
  baseline_missing: boolean
}

type UnconfirmedNextTwoWeeksResponse = {
  generated_at: string
  window_start_local: string
  window_end_local: string
  rows: Array<{
    id: number
    location_id: number
    address: string
    scheduled_date: string | null
    job_id: number | null
    job_type: string
    job_url: string | null
  }>
}

type JobsLeftMonthSlot = {
  year_month: string
  label_month: string
  jobs_left: number | null
  updated_at: string | null
  updated_by: string | null
}

type JobsLeftMonthlyResponse = {
  timezone: string
  current: JobsLeftMonthSlot
  next: JobsLeftMonthSlot
}

export default function SchedulingAttackPage() {
  const [loading, setLoading] = useState(true)
  const [kpis, setKpis] = useState<SchedulingKpis | null>(null)
  const [weekly, setWeekly] = useState<WeeklySchedulingVolumeResponse | null>(null)
  const [forward, setForward] = useState<ForwardScheduleCoverageResponse | null>(null)
  const [scheduledToday, setScheduledToday] = useState<ScheduledTodayActivityResponse | null>(null)
  const [showUnconfirmedModal, setShowUnconfirmedModal] = useState(false)
  const [loadingUnconfirmed, setLoadingUnconfirmed] = useState(false)
  const [unconfirmedError, setUnconfirmedError] = useState<string | null>(null)
  const [unconfirmed, setUnconfirmed] = useState<UnconfirmedNextTwoWeeksResponse | null>(null)
  const [jobsLeftMonthly, setJobsLeftMonthly] = useState<JobsLeftMonthlyResponse | null>(null)
  const [jobsLeftModalSlot, setJobsLeftModalSlot] = useState<'current' | 'next' | null>(null)
  const [jobsLeftDraft, setJobsLeftDraft] = useState('')
  const [jobsLeftSaving, setJobsLeftSaving] = useState(false)
  const [jobsLeftModalError, setJobsLeftModalError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    const run = async () => {
      setLoading(true)
      try {
        const [kpiPayload, weeklyPayload, forwardPayload, scheduledTodayPayload, jobsLeftPayload] = await Promise.all([
          apiJson<SchedulingKpis>('/scheduling_attack/v2/kpis', { signal: controller.signal }),
          apiJson<WeeklySchedulingVolumeResponse>('/scheduling_attack/v2/weekly_scheduling_volume', {
            signal: controller.signal,
          }),
          apiJson<ForwardScheduleCoverageResponse>('/scheduling_attack/v2/forward_schedule_coverage', {
            signal: controller.signal,
          }),
          apiJson<ScheduledTodayActivityResponse>('/scheduling_attack/v2/scheduled_today_activity', {
            signal: controller.signal,
          }),
          apiJson<JobsLeftMonthlyResponse>('/scheduling_attack/v2/jobs_left_monthly', { signal: controller.signal }),
        ])
        if (!active) return
        setKpis(kpiPayload)
        setWeekly(weeklyPayload)
        setForward(forwardPayload)
        setScheduledToday(scheduledTodayPayload)
        setJobsLeftMonthly(jobsLeftPayload)
      } catch (error) {
        if (isAbortError(error)) return
        console.error(error)
        if (!active) return
        setKpis(null)
        setWeekly(null)
        setForward(null)
        setScheduledToday(null)
        setJobsLeftMonthly(null)
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
    const labels = weeklyPoints.map((w, idx) =>
      idx === weeklyPoints.length - 1 ? 'Current week' : formatWeekRangeLabel(w.period_start, w.period_end),
    )
    const scheduledBarColors = weeklyPoints.map((_, idx) => (idx === weeklyPoints.length - 1 ? '#2eb67d' : '#4aa3ff'))
    const rescheduledBarColors = weeklyPoints.map((_, idx) => (idx === weeklyPoints.length - 1 ? '#2f4858' : '#1f2d3d'))
    return {
      labels,
      datasets: [
        {
          type: 'bar' as const,
          label: 'Rescheduled',
          data: weeklyPoints.map((w) => Number(w.rescheduled || 0)),
          backgroundColor: rescheduledBarColors,
          borderRadius: 6,
          maxBarThickness: 44,
          categoryPercentage: 0.5,
          barPercentage: 1.0,
          order: 2,
        },
        {
          type: 'bar' as const,
          label: 'Scheduled',
          data: weeklyPoints.map((w) => Number(w.scheduled || 0)),
          backgroundColor: scheduledBarColors,
          borderRadius: 6,
          maxBarThickness: 44,
          categoryPercentage: 0.5,
          barPercentage: 1.0,
          order: 2,
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
  const scheduledTodayCount = scheduledToday ? Number(scheduledToday.scheduled_today_count ?? 0) : null
  const coverageWeeks = Number(forward?.coverage_weeks_60pct ?? 0)
  const confirmedOk = confirmedPct >= 90
  const scheduledOk = (scheduledLastWeek ?? 0) > 30
  const coverageOk = coverageWeeks >= 6
  const scheduledTodayHasValue = scheduledTodayCount != null
  const scheduledTodayOk = (scheduledTodayCount ?? 0) > 0

  const openUnconfirmedModal = async () => {
    setShowUnconfirmedModal(true)
    setLoadingUnconfirmed(true)
    setUnconfirmedError(null)
    try {
      const payload = await apiJson<UnconfirmedNextTwoWeeksResponse>('/scheduling_attack/v2/unconfirmed_next_two_weeks')
      setUnconfirmed(payload)
    } catch (error) {
      console.error(error)
      setUnconfirmed(null)
      setUnconfirmedError('Failed to load unconfirmed jobs. Please try again.')
    } finally {
      setLoadingUnconfirmed(false)
    }
  }

  const closeJobsLeftModal = () => {
    setJobsLeftModalSlot(null)
    setJobsLeftModalError(null)
    setJobsLeftDraft('')
  }

  const openJobsLeftModal = (slot: 'current' | 'next') => {
    if (!jobsLeftMonthly) return
    const slotData = slot === 'current' ? jobsLeftMonthly.current : jobsLeftMonthly.next
    setJobsLeftModalSlot(slot)
    setJobsLeftDraft(slotData.jobs_left != null ? String(slotData.jobs_left) : '')
    setJobsLeftModalError(null)
  }

  const submitJobsLeft = async () => {
    if (!jobsLeftModalSlot || !jobsLeftMonthly) return
    const slotData = jobsLeftModalSlot === 'current' ? jobsLeftMonthly.current : jobsLeftMonthly.next
    const trimmed = jobsLeftDraft.trim()
    let body: { year_month: string; jobs_left: number | null }
    if (trimmed === '') {
      body = { year_month: slotData.year_month, jobs_left: null }
    } else {
      if (!/^\d+$/.test(trimmed)) {
        setJobsLeftModalError('Enter a non-negative whole number, or leave empty to clear.')
        return
      }
      const n = Number.parseInt(trimmed, 10)
      if (n < 0 || n > 9_999_999) {
        setJobsLeftModalError('Enter a reasonable non-negative whole number.')
        return
      }
      body = { year_month: slotData.year_month, jobs_left: n }
    }

    setJobsLeftSaving(true)
    setJobsLeftModalError(null)
    try {
      await apiJson('/scheduling_attack/v2/jobs_left_monthly', {
        method: 'PUT',
        body: JSON.stringify(body),
      })
      const refreshed = await apiJson<JobsLeftMonthlyResponse>('/scheduling_attack/v2/jobs_left_monthly')
      setJobsLeftMonthly(refreshed)
      closeJobsLeftModal()
    } catch (error: unknown) {
      console.error(error)
      const msg =
        typeof error === 'object' && error !== null && 'error' in error
          ? String((error as { error?: unknown }).error)
          : 'Failed to save. Please try again.'
      setJobsLeftModalError(msg)
    } finally {
      setJobsLeftSaving(false)
    }
  }

  const editingJobsLeftSlot =
    jobsLeftModalSlot != null && jobsLeftMonthly
      ? jobsLeftModalSlot === 'current'
        ? jobsLeftMonthly.current
        : jobsLeftMonthly.next
      : null

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
                role="button"
                tabIndex={0}
                onClick={() => void openUnconfirmedModal()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    void openUnconfirmedModal()
                  }
                }}
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
                  scheduledTodayHasValue && scheduledTodayOk ? 'processing-tile--status-good' : 'scheduling-kpi-tile--neutral'
                }`}
              >
                <Card.Body className="scheduling-kpi-tile__body">
                  <div className="processing-kpi-label">Jobs Scheduled Today</div>
                  <div className="scheduling-kpi-main">
                    <div
                      className={`scheduling-kpi-tile__value ${
                        scheduledTodayHasValue && scheduledTodayOk
                          ? 'processing-stat--good'
                          : 'scheduling-kpi-tile__value--neutral'
                      }`}
                    >
                      {scheduledTodayCount ?? '—'}
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

          <Row className="g-3">
            <Col lg={6} md={12}>
              <Card
                role="button"
                tabIndex={0}
                onClick={() => openJobsLeftModal('current')}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    openJobsLeftModal('current')
                  }
                }}
                className="app-kpi-nested processing-tile h-100 scheduling-kpi-tile scheduling-kpi-tile--neutral"
              >
                <Card.Body className="scheduling-kpi-tile__body">
                  <div className="processing-kpi-label">
                    {jobsLeftMonthly
                      ? `Jobs left in ${jobsLeftMonthly.current.label_month}`
                      : 'Jobs left (current month)'}
                  </div>
                  <div className="scheduling-kpi-main">
                    <div className="scheduling-kpi-tile__value scheduling-kpi-tile__value--neutral">
                      {jobsLeftMonthly && jobsLeftMonthly.current.jobs_left != null
                        ? jobsLeftMonthly.current.jobs_left
                        : '—'}
                    </div>
                  </div>
                  <div className="processing-kpi-target">Click to edit</div>
                </Card.Body>
              </Card>
            </Col>
            <Col lg={6} md={12}>
              <Card
                role="button"
                tabIndex={0}
                onClick={() => openJobsLeftModal('next')}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    openJobsLeftModal('next')
                  }
                }}
                className="app-kpi-nested processing-tile h-100 scheduling-kpi-tile scheduling-kpi-tile--neutral"
              >
                <Card.Body className="scheduling-kpi-tile__body">
                  <div className="processing-kpi-label">
                    {jobsLeftMonthly
                      ? `Jobs left in ${jobsLeftMonthly.next.label_month}`
                      : 'Jobs left (next month)'}
                  </div>
                  <div className="scheduling-kpi-main">
                    <div className="scheduling-kpi-tile__value scheduling-kpi-tile__value--neutral">
                      {jobsLeftMonthly && jobsLeftMonthly.next.jobs_left != null
                        ? jobsLeftMonthly.next.jobs_left
                        : '—'}
                    </div>
                  </div>
                  <div className="processing-kpi-target">Click to edit</div>
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

      <Modal show={showUnconfirmedModal} onHide={() => setShowUnconfirmedModal(false)} size="lg" centered>
        <Modal.Header closeButton>
          <Modal.Title>Unconfirmed Jobs - Next 2 Weeks</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {loadingUnconfirmed ? (
            <div className="d-flex align-items-center gap-2 py-3">
              <Spinner animation="border" size="sm" />
              <span>Loading unconfirmed jobs...</span>
            </div>
          ) : unconfirmedError ? (
            <div className="text-danger">{unconfirmedError}</div>
          ) : !unconfirmed?.rows?.length ? (
            <div>No unconfirmed jobs in the next 2 weeks.</div>
          ) : (
            <Table striped hover responsive size="sm" className="mb-0">
              <thead>
                <tr>
                  <th>Scheduled Date</th>
                  <th>Address</th>
                  <th>Job Type</th>
                  <th>ServiceTrade Job</th>
                </tr>
              </thead>
              <tbody>
                {unconfirmed.rows.map((row) => (
                  <tr key={row.id}>
                    <td>{formatDateTime(row.scheduled_date)}</td>
                    <td>{row.address}</td>
                    <td>{formatJobType(row.job_type)}</td>
                    <td>
                      {row.job_url && row.job_id ? (
                        <a href={row.job_url} target="_blank" rel="noreferrer">
                          Job #{row.job_id}
                        </a>
                      ) : (
                        'No link'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowUnconfirmedModal(false)}>
            Close
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal show={jobsLeftModalSlot !== null} onHide={() => closeJobsLeftModal()} centered>
        <Modal.Header closeButton>
          <Modal.Title>
            {editingJobsLeftSlot ? `Jobs left — ${editingJobsLeftSlot.label_month}` : 'Jobs left'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {jobsLeftModalError ? <div className="text-danger small mb-2">{jobsLeftModalError}</div> : null}
          <Form.Group className="mb-0" controlId="jobs-left-input">
            <Form.Label>Jobs remaining to schedule</Form.Label>
            <Form.Control
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={jobsLeftDraft}
              onChange={(e) => setJobsLeftDraft(e.target.value)}
              disabled={jobsLeftSaving}
            />
            <Form.Text className="text-muted">Leave empty and save to clear (shows —).</Form.Text>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => closeJobsLeftModal()} disabled={jobsLeftSaving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submitJobsLeft()} disabled={jobsLeftSaving}>
            {jobsLeftSaving ? <Spinner animation="border" size="sm" className="me-1" /> : null}
            Save
          </Button>
        </Modal.Footer>
      </Modal>
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

      <Row className="g-3">
        <Col lg={6} md={12}>
          <Card className="app-kpi-nested processing-tile h-100 scheduling-kpi-tile">
            <Card.Body className="scheduling-kpi-tile__body">
              <span className="home-skeleton-bar d-block" style={{ width: '72%' }} />
              <div className="scheduling-kpi-main">
                <span className="home-skeleton-bar home-skeleton-bar--value d-block" style={{ width: '48%' }} />
              </div>
              <span className="home-skeleton-bar d-block" style={{ width: '42%' }} />
            </Card.Body>
          </Card>
        </Col>
        <Col lg={6} md={12}>
          <Card className="app-kpi-nested processing-tile h-100 scheduling-kpi-tile">
            <Card.Body className="scheduling-kpi-tile__body">
              <span className="home-skeleton-bar d-block" style={{ width: '72%' }} />
              <div className="scheduling-kpi-main">
                <span className="home-skeleton-bar home-skeleton-bar--value d-block" style={{ width: '48%' }} />
              </div>
              <span className="home-skeleton-bar d-block" style={{ width: '42%' }} />
            </Card.Body>
          </Card>
        </Col>
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

function formatWeekRangeLabel(periodStart: string, periodEnd: string): string {
  const start = new Date(periodStart)
  const endExclusive = new Date(periodEnd)
  if (Number.isNaN(start.getTime()) || Number.isNaN(endExclusive.getTime())) return ''

  // API period_end is exclusive (next Monday 00:00 UTC), so display through Sunday.
  const endInclusive = new Date(endExclusive.getTime() - 24 * 60 * 60 * 1000)

  const startLabel = start.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
  const endLabel = endInclusive.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })

  return `${startLabel}-${endLabel}`
}

function formatUpdated(value?: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function formatDateTime(value?: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatJobType(value: string): string {
  const raw = (value || 'unknown').trim()
  if (!raw) return 'Unknown'
  return raw
    .split('_')
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : ''))
    .join(' ')
}

function formatPercent(value: number): string {
  return `${Number.isFinite(value) ? value.toFixed(1) : '0.0'} %`
}

function clampPct(value: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, n))
}
