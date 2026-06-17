import { Card, OverlayTrigger, Tooltip } from 'react-bootstrap'
import type { SlaJobRow, SlaMissingScheduleJobRow } from './slaSchedulingTypes'

export type { SlaJobRow, SlaMissingScheduleJobRow } from './slaSchedulingTypes'

const SLA_COHORT_TOOLTIP =
  'Counts deficiency repair quotes approved this quarter. SLA measures when office first scheduled the job (not the appointment date). Approved quotes without a scheduling action are split by whether they are still within the 10-business-day SLA.'

export type ScheduledWithinSlaGoal = {
  actual_pct: number
  target_pct: number
  meeting_goal: boolean
  eligible_count: number
  denominator_count?: number
  measurable_count?: number
  within_sla_count: number
  business_day_limit: number
  within_sla_jobs: SlaJobRow[]
  eligible_jobs?: SlaJobRow[]
  missing_approval_date?: number
  awaiting_job_under_sla_count?: number
  awaiting_job_under_sla_jobs?: SlaMissingScheduleJobRow[]
  awaiting_job_over_sla_count?: number
  awaiting_job_over_sla_jobs?: SlaMissingScheduleJobRow[]
  unscheduled_under_sla_count?: number
  unscheduled_under_sla_jobs?: SlaMissingScheduleJobRow[]
  unscheduled_over_sla_count?: number
  unscheduled_over_sla_jobs?: SlaMissingScheduleJobRow[]
}

export type SlaModalView =
  | 'met'
  | 'over'
  | 'unscheduledUnderSla'
  | 'awaitingJobUnderSla'
  | 'unscheduledOverSla'
  | 'awaitingJobOverSla'

function formatPct(value: number): string {
  if (!Number.isFinite(value)) return '0'
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1)
}

export function sortSlaJobsByApprovalToScheduledDesc(rows: SlaJobRow[]): SlaJobRow[] {
  return [...rows].sort((a, b) => b.business_days - a.business_days)
}

export default function ScheduledWithinSlaGoalTile({ slaGoal }: { slaGoal: ScheduledWithinSlaGoal | undefined }) {
  const targetPct = slaGoal?.target_pct ?? 100
  const businessDayLimit = slaGoal?.business_day_limit ?? 10
  const actualPct = slaGoal?.actual_pct ?? 0
  const meetingGoal = slaGoal?.meeting_goal ?? false
  const withinSlaCount = slaGoal?.within_sla_count ?? 0
  const displayDenominator = slaGoal?.denominator_count ?? slaGoal?.eligible_count ?? 0

  return (
    <Card
      className={`app-kpi-nested processing-tile monday-meeting-service-tile h-100 ${
        meetingGoal ? 'processing-tile--status-good' : 'processing-tile--status-warn'
      }`}
    >
      <Card.Body className="monday-meeting-service-tile__body">
        <div className="monday-meeting-service-tile__header monday-meeting-service-tile__header--split">
          <div className="processing-kpi-label d-flex align-items-start gap-1">
            <span>Repairs scheduled within {businessDayLimit} business days of approval</span>
            <OverlayTrigger
              placement="top"
              trigger={['hover', 'focus']}
              overlay={
                <Tooltip id="monday-meeting-sla-cohort-tooltip" className="monday-meeting-sla-info-tooltip">
                  {SLA_COHORT_TOOLTIP}
                </Tooltip>
              }
            >
              <button
                type="button"
                className="monday-meeting-sla-info-btn"
                aria-label="About deficiency repair quote cohort"
              >
                <i className="bi bi-info-circle" aria-hidden />
              </button>
            </OverlayTrigger>
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
          {formatPct(actualPct)}%
        </div>

        <div className="monday-meeting-service-tile__footer">
          <div className="monday-meeting-service-tile__meta">Target: {targetPct}%</div>
          <div className="monday-meeting-service-tile__meta">
            {withinSlaCount} of {displayDenominator} approved repair quotes
          </div>
        </div>
      </Card.Body>
    </Card>
  )
}
