import { Card, OverlayTrigger, Tooltip } from 'react-bootstrap'
import ScheduledWithinSlaGoalTile from './ScheduledWithinSlaGoalTile'
import SlaBucketKpiRow from './SlaBucketKpiRow'
import {
  ALL_QUOTES_TOOLTIP,
  DEFICIENCIES_REPAIRED_TOOLTIP,
  DEFICIENCY_COHORT_TOOLTIP,
  formatExclusionSubline,
  PIPELINE_EXCLUSION_TOOLTIP,
} from './serviceMetricShared'
import type { ServiceMetrics } from './serviceMetricsTypes'
import type { ScheduledWithinSlaGoal } from './ScheduledWithinSlaGoalTile'

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

type Props = {
  data: ServiceMetrics
  onOpenExcludedModal: () => void
}

export default function MondayMeetingServiceMetricsView({ data, onOpenExcludedModal }: Props) {
  const allQuotes = data.all_quotes
  const pipeline = data.deficiency_pipeline
  const repairedGoal = data.goals.deficiencies_repaired
  const slaGoal = data.goals.scheduled_within_10_business_days as ScheduledWithinSlaGoal | undefined
  const exclusionSubline = formatExclusionSubline(pipeline)
  const hasExcluded = (pipeline?.excluded_non_quoteable ?? 0) > 0

  return (
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
            onSampleSubDetailClick={hasExcluded ? onOpenExcludedModal : undefined}
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
            onSubDetailClick={hasExcluded ? onOpenExcludedModal : undefined}
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
    </>
  )
}
