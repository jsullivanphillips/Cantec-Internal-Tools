import { useEffect, useId, useMemo, useState } from 'react'
import { Button, Card, Form, Modal, OverlayTrigger, Tooltip } from 'react-bootstrap'
import SlaJobTimelineRow from './SlaJobTimelineRow'

const SLA_COHORT_TOOLTIP =
  'Only includes accepted repair quotes linked to a ServiceTrade deficiency. Standalone quotes without a deficiency link are excluded, as are quotes tied to inspection scheduling jobs.'

export type SlaJobRow = {
  quote_id: number
  job_id: number
  customer_name: string | null
  location_address: string | null
  deficiency_reported_on: string | null
  quote_created_on: string | null
  quote_accepted_on: string
  scheduled_date: string
  days_deficiency_to_quote: number | null
  days_quote_to_approval: number | null
  days_approval_to_scheduled: number
  days_deficiency_to_scheduled: number | null
  business_days: number
  within_sla: boolean
  job_url: string
}

type ScheduledWithinSlaGoal = {
  actual_pct: number
  target_pct: number
  meeting_goal: boolean
  eligible_count: number
  denominator_count?: number
  measurable_count?: number
  within_sla_count: number
  business_day_limit: number
  within_sla_jobs: SlaJobRow[]
  eligible_jobs: SlaJobRow[]
  missing_approval_date?: number
  missing_schedule_date?: number
}

function clampDays(value: number): number {
  if (!Number.isFinite(value)) return 10
  return Math.max(0, Math.round(value))
}

function formatPct(value: number): string {
  if (!Number.isFinite(value)) return '0'
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1)
}

function computeSlaMetrics(
  measurableJobs: SlaJobRow[],
  denominatorCount: number,
  dayLimit: number,
  targetPct: number,
) {
  const withinSlaJobs = measurableJobs.filter((row) => row.business_days <= dayLimit)
  const withinSlaCount = withinSlaJobs.length
  const actualPct = denominatorCount
    ? Math.round((withinSlaCount / denominatorCount) * 1000) / 10
    : 0
  return {
    denominatorCount,
    withinSlaCount,
    withinSlaJobs,
    actualPct,
    meetingGoal: denominatorCount > 0 && actualPct >= targetPct,
  }
}

function parseDaysDraft(draft: string, fallback: number): number {
  const parsed = Number.parseInt(draft, 10)
  if (!Number.isFinite(parsed)) return fallback
  return clampDays(parsed)
}

export default function ScheduledWithinSlaGoalTile({ slaGoal }: { slaGoal: ScheduledWithinSlaGoal | undefined }) {
  const inputId = useId()
  const [showModal, setShowModal] = useState(false)
  const [editingDays, setEditingDays] = useState(false)
  const [daysDraft, setDaysDraft] = useState('')
  const [daysOverride, setDaysOverride] = useState<number | null>(null)

  const defaultDayLimit = slaGoal?.business_day_limit ?? 10
  const committedDayLimit = daysOverride ?? defaultDayLimit
  const activeDayLimit = editingDays ? parseDaysDraft(daysDraft, committedDayLimit) : committedDayLimit
  const targetPct = slaGoal?.target_pct ?? 100
  const measurableJobs = slaGoal?.eligible_jobs ?? slaGoal?.within_sla_jobs ?? []
  const denominatorCount =
    slaGoal?.denominator_count ?? slaGoal?.eligible_count ?? measurableJobs.length

  const { denominatorCount: displayDenominator, withinSlaCount, withinSlaJobs, actualPct, meetingGoal } =
    useMemo(
      () => computeSlaMetrics(measurableJobs, denominatorCount, activeDayLimit, targetPct),
      [measurableJobs, denominatorCount, activeDayLimit, targetPct],
    )

  const serverDayLimit = slaGoal?.business_day_limit ?? 10
  const hasDaysOverride = daysOverride != null && daysOverride !== serverDayLimit

  useEffect(() => {
    setDaysOverride(null)
    setEditingDays(false)
  }, [slaGoal?.denominator_count, slaGoal?.within_sla_count, serverDayLimit])

  const beginEditDays = () => {
    setDaysDraft(String(committedDayLimit))
    setEditingDays(true)
  }

  const commitEditDays = () => {
    setDaysOverride(parseDaysDraft(daysDraft, committedDayLimit))
    setEditingDays(false)
  }

  const cancelEditDays = () => {
    setDaysDraft(String(committedDayLimit))
    setEditingDays(false)
  }

  const resetDaysOverride = () => {
    setDaysOverride(null)
    setEditingDays(false)
  }

  return (
    <>
      <Card
        className={`app-kpi-nested processing-tile monday-meeting-service-tile h-100 ${
          meetingGoal ? 'processing-tile--status-good' : 'processing-tile--status-warn'
        }`}
      >
        <Card.Body className="processing-kpi-card-body p-3 d-flex flex-column gap-2">
          <div className="d-flex justify-content-between align-items-start gap-2">
            <div className="processing-kpi-label d-flex align-items-start gap-1">
              <span>
                Repairs scheduled within{' '}
                {editingDays ? (
                <span className="monday-meeting-sla-days-edit-inline">
                  <Form.Control
                    id={inputId}
                    type="number"
                    min={0}
                    step={1}
                    value={daysDraft}
                    onChange={(e) => setDaysDraft(e.target.value)}
                    onBlur={commitEditDays}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitEditDays()
                      if (e.key === 'Escape') cancelEditDays()
                    }}
                    autoFocus
                    size="sm"
                    className="monday-meeting-sla-days-input d-inline-block"
                    aria-label="Business day limit"
                  />
                  <Button type="button" size="sm" variant="link" className="p-0 ms-1" onClick={commitEditDays}>
                    Set
                  </Button>
                </span>
              ) : (
                <button
                  type="button"
                  className="monday-meeting-sla-days-button"
                  onClick={beginEditDays}
                  title="Click to change business day limit for testing"
                >
                  {committedDayLimit}
                </button>
              )}{' '}
                business days of approval
              </span>
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

          <div className="processing-hero-value text-dark">{formatPct(actualPct)}%</div>

          <div className="monday-meeting-service-detail">Target: {targetPct}%</div>
          <div className="monday-meeting-service-detail">
            {withinSlaCount} of {displayDenominator} deficiency repair quotes with jobs
            {(slaGoal?.measurable_count ?? measurableJobs.length) !== displayDenominator ? (
              <> ({slaGoal?.measurable_count ?? measurableJobs.length} with approval and schedule dates)</>
            ) : null}
            {(slaGoal?.missing_approval_date ?? 0) > 0 || (slaGoal?.missing_schedule_date ?? 0) > 0 ? (
              <>
                {' '}
                · {slaGoal?.missing_approval_date ?? 0} missing approval date,{' '}
                {slaGoal?.missing_schedule_date ?? 0} missing schedule date
              </>
            ) : null}
          </div>
          {hasDaysOverride ? (
            <div className="monday-meeting-service-detail d-flex flex-wrap align-items-center gap-2">
              <span>Testing with {activeDayLimit} days (default: {serverDayLimit})</span>
              <Button type="button" size="sm" variant="link" className="p-0 align-baseline" onClick={resetDaysOverride}>
                Reset
              </Button>
            </div>
          ) : (
            <div className="monday-meeting-service-detail">Click the day count to test a different window.</div>
          )}

          <Button
            type="button"
            size="sm"
            variant="outline-secondary"
            className="align-self-start mt-1"
            onClick={() => setShowModal(true)}
            disabled={!slaGoal}
          >
            View jobs within {activeDayLimit} days ({withinSlaJobs.length})
          </Button>
        </Card.Body>
      </Card>

      <Modal
        show={showModal}
        onHide={() => setShowModal(false)}
        size="xl"
        scrollable
        dialogClassName="monday-meeting-sla-jobs-modal-dialog"
      >
        <Modal.Header closeButton>
          <Modal.Title className="h6 mb-0">
            Jobs scheduled within {activeDayLimit} business days of approval
          </Modal.Title>
        </Modal.Header>
        <Modal.Body className="monday-meeting-sla-jobs-modal-body">
          {withinSlaJobs.length === 0 ? (
            <p className="text-muted small mb-0">
              No jobs in this category for the selected date range and day limit. Eligible quotes need accepted status, a
              linked job, quote acceptance date, and a scheduled date.
            </p>
          ) : (
            <div className="sla-job-timeline-list">
              {withinSlaJobs.map((row) => (
                <SlaJobTimelineRow key={`${row.quote_id}-${row.job_id}`} row={row} />
              ))}
            </div>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button type="button" variant="secondary" onClick={() => setShowModal(false)}>
            Close
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  )
}
