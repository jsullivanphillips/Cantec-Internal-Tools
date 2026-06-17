import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Card, Form, OverlayTrigger, Spinner, Tooltip } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import { apiFetch, isAbortError } from '../../lib/apiClient'
import ExcludedDeficienciesModal from './ExcludedDeficienciesModal'
import {
  ALL_TIME_QUARTER_KEY,
  defaultServiceQuarterKey,
  listServiceQuarterSelectItems,
  serviceDateRangeParams,
} from './mondayMeetingServiceDateRange'
import ServiceQuarterAllTimeInfo from './ServiceQuarterAllTimeInfo'
import ScheduledWithinSlaGoalTile from './ScheduledWithinSlaGoalTile'
import SlaBucketKpiRow from './SlaBucketKpiRow'
import type { SlaJobRow } from './slaSchedulingTypes'

const ALL_QUOTES_TOOLTIP =
  'All quotes created in the selected quarter, including inspection and standalone quotes (not tied to deficiencies).'

const DEFICIENCY_COHORT_TOOLTIP =
  'Based on deficiencies reported in the selected quarter. Quote, approval, and job steps count whenever they happened.'

const PIPELINE_EXCLUSION_TOOLTIP =
  'Deficiency counts exclude record-only items: keyword matches (e.g. fire safety plan, monitoring company) and similar deficiencies never quoted after 90 business days.'

type DeficiencyPipelineMetrics = {
  total: number
  quoted: number
  quoted_pct: number
  approved_of_quoted: number
  approved_of_quoted_pct: number
  approved_with_job: number
  approved_with_job_pct: number
  excluded_non_quoteable?: number
  excluded_keyword?: number
  excluded_stale_cluster?: number
  classification?: {
    classified_count: number
    needs_classification: boolean
    last_classified_at: string | null
  }
}

type ServiceMetrics = {
  all_quotes: {
    total: number
    approved: number
    approved_pct: number
  }
  deficiency_pipeline: DeficiencyPipelineMetrics
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

function formatExclusionSubline(pipeline: DeficiencyPipelineMetrics | undefined): string | null {
  const excluded = pipeline?.excluded_non_quoteable ?? 0
  if (excluded <= 0) return null
  return `${excluded} excluded as non-quotable`
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
        : 'monday-meeting-service-tile--neutral'
  return (
    <Card className={`app-kpi-nested processing-tile monday-meeting-service-tile h-100 ${statusClass}`}>
      <Card.Body className="monday-meeting-service-tile__body">
        <div className="monday-meeting-service-tile__header">
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
        <div className="monday-meeting-service-tile__value">{value}</div>
        {(detail || subDetail) && (
          <div className="monday-meeting-service-tile__footer">
            {detail && subDetail ? (
              <div className="monday-meeting-service-detail-row">
                <span className="monday-meeting-service-tile__meta">{detail}</span>
                {onSubDetailClick ? (
                  <button
                    type="button"
                    className="monday-meeting-service-tile__meta monday-meeting-service-tile__meta--link monday-meeting-excluded-link btn btn-link p-0"
                    onClick={onSubDetailClick}
                  >
                    {subDetail}
                  </button>
                ) : (
                  <span className="monday-meeting-service-tile__meta monday-meeting-service-tile__meta--muted">
                    {subDetail}
                  </span>
                )}
              </div>
            ) : (
              <>
                {detail ? <div className="monday-meeting-service-tile__meta">{detail}</div> : null}
                {subDetail ? (
                  onSubDetailClick ? (
                    <button
                      type="button"
                      className="monday-meeting-service-tile__meta monday-meeting-service-tile__meta--link monday-meeting-excluded-link btn btn-link p-0 text-start"
                      onClick={onSubDetailClick}
                    >
                      {subDetail}
                    </button>
                  ) : (
                    <div className="monday-meeting-service-tile__meta monday-meeting-service-tile__meta--muted">
                      {subDetail}
                    </div>
                  )
                ) : null}
              </>
            )}
          </div>
        )}
      </Card.Body>
    </Card>
  )
}

const DEFICIENCIES_REPAIRED_TOOLTIP =
  'Tracks deficiency repairs completed for deficiencies reported in the selected quarter.'

function GoalTile({
  label,
  actualPct,
  targetPct,
  meetingGoal,
  sampleText,
  sampleSubDetail,
  onSampleSubDetailClick,
  infoTooltip,
}: {
  label: string
  actualPct: number
  targetPct: number
  meetingGoal: boolean
  sampleText: string
  sampleSubDetail?: string | null
  onSampleSubDetailClick?: () => void
  infoTooltip?: string
}) {
  return (
    <Card
      className={`app-kpi-nested processing-tile monday-meeting-service-tile h-100 ${
        meetingGoal ? 'processing-tile--status-good' : 'processing-tile--status-warn'
      }`}
    >
      <Card.Body className="monday-meeting-service-tile__body">
        <div className="monday-meeting-service-tile__header monday-meeting-service-tile__header--split">
          <div className="processing-kpi-label d-flex align-items-start gap-1">
            <span>{label}</span>
            {infoTooltip ? (
              <OverlayTrigger
                placement="top"
                trigger={['hover', 'focus']}
                overlay={
                  <Tooltip id={`monday-meeting-goal-${label}`} className="monday-meeting-sla-info-tooltip">
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
          <span
            className={`monday-meeting-service-goal-badge ${
              meetingGoal ? 'monday-meeting-service-goal-badge--pass' : 'monday-meeting-service-goal-badge--fail'
            }`}
          >
            {meetingGoal ? 'On target' : 'Below target'}
          </span>
        </div>
        <div
          className={`monday-meeting-service-tile__value ${
            meetingGoal ? 'monday-meeting-service-tile__value--good' : 'monday-meeting-service-tile__value--warn'
          }`}
        >
          {actualPct}%
        </div>
        <div className="monday-meeting-service-tile__footer">
          <div className="monday-meeting-service-tile__meta">Target: {targetPct}%</div>
          {sampleSubDetail ? (
            <div className="monday-meeting-service-detail-row">
              <span className="monday-meeting-service-tile__meta">{sampleText}</span>
              {onSampleSubDetailClick ? (
                <button
                  type="button"
                  className="monday-meeting-service-tile__meta monday-meeting-service-tile__meta--link monday-meeting-excluded-link btn btn-link p-0"
                  onClick={onSampleSubDetailClick}
                >
                  {sampleSubDetail}
                </button>
              ) : (
                <span className="monday-meeting-service-tile__meta monday-meeting-service-tile__meta--muted">
                  {sampleSubDetail}
                </span>
              )}
            </div>
          ) : (
            <div className="monday-meeting-service-tile__meta">{sampleText}</div>
          )}
        </div>
      </Card.Body>
    </Card>
  )
}

export default function MondayMeetingServiceTab() {
  const quarterOptions = useMemo(() => listServiceQuarterSelectItems(), [])
  const [selectedQuarterKey, setSelectedQuarterKey] = useState(defaultServiceQuarterKey())
  const selectedQuarter =
    quarterOptions.find((option) => option.key === selectedQuarterKey) ?? quarterOptions[0]
  const start = selectedQuarter?.startDate ?? ''
  const end = selectedQuarter?.endDate ?? ''
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<ServiceMetrics | null>(null)
  const [showExcludedModal, setShowExcludedModal] = useState(false)

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    try {
      const response = await apiFetch(`/api/monday_meeting/service${serviceDateRangeParams(start, end)}`, { signal })
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

  const allQuotes = data?.all_quotes
  const pipeline = data?.deficiency_pipeline
  const repairedGoal = data?.goals.deficiencies_repaired
  const slaGoal = data?.goals.scheduled_within_10_business_days
  const exclusionSubline = formatExclusionSubline(pipeline)
  const hasExcluded = (pipeline?.excluded_non_quoteable ?? 0) > 0

  return (
    <div className="monday-meeting-service-tab">
      <div className="monday-meeting-service-toolbar">
        <div className="monday-meeting-service-toolbar__group">
          <span className="monday-meeting-service-toolbar__label">Quarter</span>
          <div className="monday-meeting-service-quarter-select-wrap">
            <Form.Select
              size="sm"
              className="monday-meeting-service-quarter-control"
              value={selectedQuarterKey}
              aria-label="Reporting quarter"
              onChange={(e) => setSelectedQuarterKey(e.target.value)}
            >
              {quarterOptions.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </Form.Select>
            {selectedQuarterKey === ALL_TIME_QUARTER_KEY ? (
              <ServiceQuarterAllTimeInfo startDate={start} endDate={end} />
            ) : null}
          </div>
        </div>
        <Link
          to="/monday_meeting/service/admin"
          className="btn btn-outline-secondary btn-sm monday-meeting-service-admin-link"
        >
          <i className="bi bi-gear me-1" aria-hidden />
          Filter settings
        </Link>
      </div>

      {error ? (
        <Alert variant="warning" className="monday-meeting-service-alert mb-0">
          Something went wrong loading service metrics. Try again, or pick a different quarter.
        </Alert>
      ) : null}

      {pipeline?.classification?.needs_classification ? (
        <Alert variant="info" className="monday-meeting-service-alert mb-0">
          Non-quoteable filtering has not been run yet, so nothing is excluded. Open{' '}
          <Link to="/monday_meeting/service/admin">Filter settings</Link> and click{' '}
          <strong>Reclassify all deficiencies</strong> (or run the sync that updates deficiencies).
        </Alert>
      ) : null}

      {loading ? (
        <div className="monday-meeting-service-loading" aria-busy="true" aria-label="Loading service metrics">
          <Spinner />
        </div>
      ) : data ? (
        <>
          <section className="monday-meeting-service-panel">
            <h2 className="monday-meeting-service-section-title">Goals</h2>
            <div className="monday-meeting-service-kpi-grid monday-meeting-service-kpi-grid--cols-2">
              <GoalTile
                label="Deficiencies repaired"
                actualPct={repairedGoal?.actual_pct ?? 0}
                targetPct={repairedGoal?.target_pct ?? 35}
                meetingGoal={repairedGoal?.meeting_goal ?? false}
                sampleText={`${repairedGoal?.repaired_count ?? 0} of ${repairedGoal?.total_deficiencies ?? 0} deficiencies repaired`}
                sampleSubDetail={exclusionSubline}
                onSampleSubDetailClick={hasExcluded ? () => setShowExcludedModal(true) : undefined}
                infoTooltip={DEFICIENCIES_REPAIRED_TOOLTIP}
              />
              <ScheduledWithinSlaGoalTile slaGoal={slaGoal} />
            </div>
          </section>

          <section className="monday-meeting-service-panel">
            <SlaBucketKpiRow slaGoal={slaGoal} />
          </section>

          <section className="monday-meeting-service-panel">
            <h2 className="monday-meeting-service-section-title">Deficiency funnel</h2>
            <div className="monday-meeting-service-kpi-grid monday-meeting-service-kpi-grid--cols-3">
              <MetricTile
                label="Deficiencies quoted"
                value={`${pipeline?.quoted_pct ?? 0}%`}
                detail={`${pipeline?.quoted ?? 0} of ${pipeline?.total ?? 0} deficiencies`}
                subDetail={exclusionSubline}
                onSubDetailClick={hasExcluded ? () => setShowExcludedModal(true) : undefined}
                infoTooltip={`${DEFICIENCY_COHORT_TOOLTIP} ${PIPELINE_EXCLUSION_TOOLTIP}`}
              />
              <MetricTile
                label="Quotes approved"
                value={`${pipeline?.approved_of_quoted_pct ?? 0}%`}
                detail={`${pipeline?.approved_of_quoted ?? 0} of ${pipeline?.quoted ?? 0} quoted deficiencies`}
                infoTooltip={DEFICIENCY_COHORT_TOOLTIP}
              />
              <MetricTile
                label="Approved → job assigned"
                value={`${pipeline?.approved_with_job_pct ?? 0}%`}
                detail={`${pipeline?.approved_with_job ?? 0} of ${pipeline?.approved_of_quoted ?? 0} approved deficiencies`}
                infoTooltip={DEFICIENCY_COHORT_TOOLTIP}
              />
            </div>
          </section>

          <section className="monday-meeting-service-panel">
            <h2 className="monday-meeting-service-section-title">Total quotes</h2>
            <div className="monday-meeting-service-kpi-grid monday-meeting-service-kpi-grid--cols-3">
              <MetricTile
                label="Quotes approved"
                value={`${allQuotes?.approved_pct ?? 0}%`}
                detail={`${allQuotes?.approved ?? 0} of ${allQuotes?.total ?? 0} quotes accepted`}
                infoTooltip={ALL_QUOTES_TOOLTIP}
              />
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
