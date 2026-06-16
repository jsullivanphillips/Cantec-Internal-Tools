import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Card, Form, OverlayTrigger, Spinner, Tooltip } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import { apiFetch, isAbortError } from '../../lib/apiClient'
import ExcludedDeficienciesModal from './ExcludedDeficienciesModal'
import ScheduledWithinSlaGoalTile, { type SlaJobRow } from './ScheduledWithinSlaGoalTile'

const PIPELINE_EXCLUSION_TOOLTIP =
  'Deficiency counts exclude record-only items: keyword matches (e.g. fire safety plan, monitoring company) and similar deficiencies never quoted after 90 business days.'

type ServiceMetrics = {
  deficiency_quoting: {
    total: number
    quoted: number
    quoted_pct: number
    not_quoted_pct: number
    excluded_non_quoteable?: number
    excluded_keyword?: number
    excluded_stale_cluster?: number
    classification?: {
      classified_count: number
      needs_classification: boolean
      last_classified_at: string | null
    }
  }
  quote_approval: {
    total_quotes: number
    approved: number
    approved_pct: number
  }
  approved_to_job: {
    approved_total: number
    with_job: number
    with_job_pct: number
  }
  goals: {
    deficiencies_repaired: {
      actual_pct: number
      target_pct: number
      meeting_goal: boolean
      repaired_count: number
      total_deficiencies: number
    }
    scheduled_within_10_business_days: {
      actual_pct: number
      target_pct: number
      meeting_goal: boolean
      eligible_count: number
      within_sla_count: number
      business_day_limit: number
      within_sla_jobs: SlaJobRow[]
      eligible_jobs: SlaJobRow[]
    }
  }
}

function params(start: string, end: string) {
  const q = new URLSearchParams()
  if (start) q.set('start_date', start)
  if (end) q.set('end_date', end)
  const s = q.toString()
  return s ? `?${s}` : ''
}

function defaultDateRange() {
  const today = new Date()
  const defaultEnd = today.toISOString().slice(0, 10)
  const defaultStart = new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString().slice(0, 10)
  return { defaultStart, defaultEnd }
}

function formatExclusionSubline(quoting: ServiceMetrics['deficiency_quoting'] | undefined): string | null {
  const excluded = quoting?.excluded_non_quoteable ?? 0
  if (excluded <= 0) return null
  const keyword = quoting?.excluded_keyword ?? 0
  const cluster = quoting?.excluded_stale_cluster ?? 0
  return `${excluded} excluded as non-quoteable (${keyword} keyword, ${cluster} similar unquoted cluster) — view list`
}

function MetricTile({
  label,
  value,
  detail,
  subDetail,
  onSubDetailClick,
  infoTooltip,
  status,
}: {
  label: string
  value: string
  detail?: string
  subDetail?: string | null
  onSubDetailClick?: () => void
  infoTooltip?: string
  status?: 'good' | 'warn'
}) {
  const statusClass =
    status === 'good'
      ? 'processing-tile--status-good'
      : status === 'warn'
        ? 'processing-tile--status-warn'
        : ''
  return (
    <Card className={`app-kpi-nested processing-tile monday-meeting-service-tile h-100 ${statusClass}`}>
      <Card.Body className="processing-kpi-card-body p-3">
        <div className="d-flex align-items-start gap-1">
          <div className="processing-kpi-label">{label}</div>
          {infoTooltip ? (
            <OverlayTrigger
              placement="top"
              trigger={['hover', 'focus']}
              overlay={
                <Tooltip id={`monday-meeting-metric-${label}`} className="monday-meeting-sla-info-tooltip">
                  {infoTooltip}
                </Tooltip>
              }
            >
              <button type="button" className="monday-meeting-sla-info-btn" aria-label={`About ${label}`}>
                <i className="bi bi-info-circle" aria-hidden />
              </button>
            </OverlayTrigger>
          ) : null}
        </div>
        <div className="processing-hero-value text-dark">{value}</div>
        {detail ? <div className="monday-meeting-service-detail">{detail}</div> : null}
        {subDetail ? (
          onSubDetailClick ? (
            <button
              type="button"
              className="monday-meeting-service-detail monday-meeting-service-detail--muted monday-meeting-excluded-link btn btn-link p-0 text-start"
              onClick={onSubDetailClick}
            >
              {subDetail}
            </button>
          ) : (
            <div className="monday-meeting-service-detail monday-meeting-service-detail--muted">{subDetail}</div>
          )
        ) : null}
      </Card.Body>
    </Card>
  )
}

function GoalTile({
  label,
  actualPct,
  targetPct,
  meetingGoal,
  sampleText,
}: {
  label: string
  actualPct: number
  targetPct: number
  meetingGoal: boolean
  sampleText: string
}) {
  return (
    <Card
      className={`app-kpi-nested processing-tile monday-meeting-service-tile h-100 ${
        meetingGoal ? 'processing-tile--status-good' : 'processing-tile--status-warn'
      }`}
    >
      <Card.Body className="processing-kpi-card-body p-3 d-flex flex-column gap-2">
        <div className="d-flex justify-content-between align-items-start gap-2">
          <div className="processing-kpi-label">{label}</div>
          <span
            className={`monday-meeting-service-goal-badge ${
              meetingGoal ? 'monday-meeting-service-goal-badge--pass' : 'monday-meeting-service-goal-badge--fail'
            }`}
          >
            {meetingGoal ? 'On target' : 'Below target'}
          </span>
        </div>
        <div className="processing-hero-value text-dark">{actualPct}%</div>
        <div className="monday-meeting-service-detail">Target: {targetPct}%</div>
        <div className="monday-meeting-service-detail">{sampleText}</div>
      </Card.Body>
    </Card>
  )
}

export default function MondayMeetingServiceTab() {
  const { defaultStart, defaultEnd } = defaultDateRange()
  const [start, setStart] = useState(defaultStart)
  const [end, setEnd] = useState(defaultEnd)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<ServiceMetrics | null>(null)
  const [showExcludedModal, setShowExcludedModal] = useState(false)

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    try {
      const response = await apiFetch(`/api/monday_meeting/service${params(start, end)}`, { signal })
      if (!response.ok) throw new Error('load_failed')
      const payload = (await response.json()) as ServiceMetrics
      if (signal?.aborted) return
      setData(payload)
    } catch (e) {
      if (isAbortError(e)) return
      console.error(e)
      setError('load_failed')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [start, end])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const quoting = data?.deficiency_quoting
  const approval = data?.quote_approval
  const assignment = data?.approved_to_job
  const repairedGoal = data?.goals.deficiencies_repaired
  const slaGoal = data?.goals.scheduled_within_10_business_days
  const exclusionSubline = formatExclusionSubline(quoting)
  const hasExcluded = (quoting?.excluded_non_quoteable ?? 0) > 0

  return (
    <div className="monday-meeting-service-tab p-3">
      <div className="monday-meeting-service-filters">
        <Form.Group>
          <Form.Label>Start date</Form.Label>
          <Form.Control type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </Form.Group>
        <Form.Group>
          <Form.Label>End date</Form.Label>
          <Form.Control type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Form.Group>
        <Button
          type="button"
          variant="outline-secondary"
          className="performance-apply-btn"
          onClick={() => void load()}
          disabled={loading}
        >
          Apply
        </Button>
        <Link
          to="/monday_meeting/service/admin"
          className="btn btn-outline-secondary btn-sm monday-meeting-service-admin-link"
        >
          <i className="bi bi-gear me-1" aria-hidden />
          Filter settings
        </Link>
      </div>

      {error ? (
        <Alert variant="warning" className="mb-0 py-2 small">
          Something went wrong loading service metrics. Try again, or pick a different range.
        </Alert>
      ) : null}

      {quoting?.classification?.needs_classification ? (
        <Alert variant="info" className="py-2 small">
          Non-quoteable filtering has not been run yet, so nothing is excluded. Open{' '}
          <Link to="/monday_meeting/service/admin">Filter settings</Link> and click{' '}
          <strong>Reclassify all deficiencies</strong> (or run the sync that updates deficiencies).
        </Alert>
      ) : null}

      {loading ? (
        <div className="text-center py-5" aria-busy="true" aria-label="Loading service metrics">
          <Spinner />
        </div>
      ) : data ? (
        <>
          <section>
            <h2 className="monday-meeting-service-section-title">Pipeline</h2>
            <div className="monday-meeting-service-kpi-grid monday-meeting-service-kpi-grid--pipeline">
              <MetricTile
                label="Deficiencies quoted"
                value={`${quoting?.quoted_pct ?? 0}%`}
                detail={`${quoting?.quoted ?? 0} of ${quoting?.total ?? 0} deficiencies`}
                subDetail={exclusionSubline}
                onSubDetailClick={hasExcluded ? () => setShowExcludedModal(true) : undefined}
                infoTooltip={PIPELINE_EXCLUSION_TOOLTIP}
              />
              <MetricTile
                label="Not quoted"
                value={`${quoting?.not_quoted_pct ?? 0}%`}
                detail={`${(quoting?.total ?? 0) - (quoting?.quoted ?? 0)} deficiencies without quote`}
                infoTooltip={PIPELINE_EXCLUSION_TOOLTIP}
              />
              <MetricTile
                label="Quotes approved"
                value={`${approval?.approved_pct ?? 0}%`}
                detail={`${approval?.approved ?? 0} of ${approval?.total_quotes ?? 0} quotes accepted`}
              />
            </div>
          </section>

          <section>
            <h2 className="monday-meeting-service-section-title">Job assignment</h2>
            <div className="monday-meeting-service-kpi-grid monday-meeting-service-kpi-grid--assignment">
              <MetricTile
                label="Approved → job assigned"
                value={`${assignment?.with_job_pct ?? 0}%`}
                detail={`${assignment?.with_job ?? 0} of ${assignment?.approved_total ?? 0} approved quotes`}
              />
            </div>
          </section>

          <section>
            <h2 className="monday-meeting-service-section-title">Goals</h2>
            <div className="monday-meeting-service-kpi-grid monday-meeting-service-kpi-grid--goals">
              <GoalTile
                label="Deficiencies repaired"
                actualPct={repairedGoal?.actual_pct ?? 0}
                targetPct={repairedGoal?.target_pct ?? 35}
                meetingGoal={repairedGoal?.meeting_goal ?? false}
                sampleText={`${repairedGoal?.repaired_count ?? 0} of ${repairedGoal?.total_deficiencies ?? 0} deficiencies completed`}
              />
              <ScheduledWithinSlaGoalTile slaGoal={slaGoal} />
            </div>
          </section>

          <ExcludedDeficienciesModal
            show={showExcludedModal}
            onHide={() => setShowExcludedModal(false)}
            startDate={start}
            endDate={end}
          />
        </>
      ) : null}
    </div>
  )
}
