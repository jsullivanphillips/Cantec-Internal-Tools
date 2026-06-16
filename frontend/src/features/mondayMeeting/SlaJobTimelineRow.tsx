import type { SlaJobRow } from './ScheduledWithinSlaGoalTile'

function formatDays(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${value} bd`
}

type TimelineStep = {
  key: string
  label: string
  date: string | null
  connectorDays?: number | null
}

function buildSteps(row: SlaJobRow): TimelineStep[] {
  return [
    {
      key: 'deficiency',
      label: 'Deficiency',
      date: row.deficiency_reported_on,
      connectorDays: row.days_deficiency_to_quote,
    },
    {
      key: 'quoted',
      label: 'Quoted',
      date: row.quote_created_on,
      connectorDays: row.days_quote_to_approval,
    },
    {
      key: 'approved',
      label: 'Approved',
      date: row.quote_accepted_on,
      connectorDays: row.days_approval_to_scheduled,
    },
    {
      key: 'scheduled',
      label: 'Scheduled',
      date: row.scheduled_date,
    },
  ]
}

export default function SlaJobTimelineRow({ row }: { row: SlaJobRow }) {
  const steps = buildSteps(row)
  const title = row.location_address?.trim() || `Job ${row.job_id}`

  return (
    <article className="sla-job-timeline-row">
      <header className="sla-job-timeline-row__header">
        <div className="sla-job-timeline-row__title-wrap">
          <a
            href={row.job_url}
            target="_blank"
            rel="noopener noreferrer"
            className="sla-job-timeline-row__title"
          >
            {title}
          </a>
          <span className="sla-job-timeline-row__meta">
            {row.customer_name?.trim() || 'Unknown customer'} · Job #{row.job_id}
          </span>
        </div>
        {row.days_deficiency_to_scheduled != null ? (
          <span className="sla-job-timeline-row__total">{row.days_deficiency_to_scheduled} bd total</span>
        ) : null}
      </header>

      <div className="sla-job-timeline-row__track" role="list" aria-label={`Repair timeline for ${title}`}>
        {steps.map((step, index) => (
          <div key={step.key} className="sla-job-timeline-row__segment" role="listitem">
            {index > 0 ? (
              <div className="sla-job-timeline-row__connector" aria-hidden="true">
                <span className="sla-job-timeline-row__connector-line" />
                <span className="sla-job-timeline-row__connector-days">
                  {formatDays(steps[index - 1].connectorDays)}
                </span>
              </div>
            ) : null}
            <div className="sla-job-timeline-row__step">
              <span className="sla-job-timeline-row__dot" aria-hidden="true" />
              <span className="sla-job-timeline-row__label">{step.label}</span>
              <span className="sla-job-timeline-row__date">{step.date ?? '—'}</span>
            </div>
          </div>
        ))}
      </div>
    </article>
  )
}
