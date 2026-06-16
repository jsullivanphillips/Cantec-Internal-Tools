import type { SlaJobRow } from './slaSchedulingTypes'
import { formatSlaTimelineDate } from './slaTimelineFormat'

function formatDays(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${value} bd`
}

function formatRowMeta(row: SlaJobRow): string {
  const parts: string[] = []
  const serviceLine = row.deficiency_service_line?.trim()
  if (serviceLine) parts.push(serviceLine)
  const quoteCreator = row.quote_created_by?.trim()
  if (quoteCreator) parts.push(`Quote: ${quoteCreator}`)
  const jobCreator = row.job_created_by?.trim()
  if (jobCreator) parts.push(`Job: ${jobCreator}`)
  return parts.length > 0 ? parts.join(' · ') : '—'
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
      date: row.scheduled_on,
    },
  ]
}

function formatAppointmentDate(row: SlaJobRow): string | null {
  if (!row.scheduled_date || row.scheduled_date === row.scheduled_on) return null
  return `Appt ${formatSlaTimelineDate(row.scheduled_date)}`
}

export default function SlaJobTimelineRow({
  row,
  businessDayLimit,
}: {
  row: SlaJobRow
  businessDayLimit: number
}) {
  const steps = buildSteps(row)
  const appointmentDate = formatAppointmentDate(row)
  const title = row.location_address?.trim() || `Job ${row.job_id}`

  return (
    <article
      className={`sla-job-timeline-row ${
        row.within_sla ? 'sla-job-timeline-row--within-sla' : 'sla-job-timeline-row--over-sla'
      }`}
    >
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
          <span className="sla-job-timeline-row__meta">{formatRowMeta(row)}</span>
        </div>
        <div className="sla-job-timeline-row__badges">
          <span
            className={`sla-job-timeline-row__sla-badge ${
              row.within_sla ? 'sla-job-timeline-row__sla-badge--pass' : 'sla-job-timeline-row__sla-badge--fail'
            }`}
          >
            {row.within_sla ? 'Met SLA' : 'Over SLA'} · {row.business_days} bd
          </span>
          {row.days_deficiency_to_scheduled != null ? (
            <span className="sla-job-timeline-row__total">{row.days_deficiency_to_scheduled} bd total</span>
          ) : null}
        </div>
      </header>

      <div className="sla-job-timeline-row__track" role="list" aria-label={`Repair timeline for ${title}`}>
        {steps.map((step, index) => (
          <div key={step.key} className="sla-job-timeline-row__segment" role="listitem">
            {index > 0 ? (
              <div
                className={`sla-job-timeline-row__connector${
                  step.key === 'scheduled' && !row.within_sla
                    ? ' sla-job-timeline-row__connector--over-sla'
                    : ''
                }`}
                aria-hidden="true"
              >
                <span className="sla-job-timeline-row__connector-line" />
                <span className="sla-job-timeline-row__connector-days">
                  {formatDays(steps[index - 1].connectorDays)}
                  {step.key === 'scheduled' && !row.within_sla ? (
                    <span className="sla-job-timeline-row__connector-limit"> / {businessDayLimit} bd limit</span>
                  ) : null}
                </span>
              </div>
            ) : null}
            <div className="sla-job-timeline-row__step">
              <span className="sla-job-timeline-row__dot" aria-hidden="true" />
              <span className="sla-job-timeline-row__label">{step.label}</span>
              <span className="sla-job-timeline-row__date">
                {formatSlaTimelineDate(step.date)}
                {step.key === 'scheduled' && appointmentDate ? (
                  <span className="sla-job-timeline-row__date-sub">{appointmentDate}</span>
                ) : null}
              </span>
            </div>
          </div>
        ))}
      </div>
    </article>
  )
}
