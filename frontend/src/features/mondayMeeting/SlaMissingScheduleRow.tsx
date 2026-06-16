import type { SlaMissingScheduleJobRow } from './slaSchedulingTypes'
import { formatSlaTimelineDate } from './slaTimelineFormat'

function formatRowMeta(row: SlaMissingScheduleJobRow): string {
  const parts: string[] = []
  const serviceLine = row.deficiency_service_line?.trim()
  if (serviceLine) parts.push(serviceLine)
  const quoteCreator = row.quote_created_by?.trim()
  if (quoteCreator) parts.push(`Quote: ${quoteCreator}`)
  const jobCreator = row.job_created_by?.trim()
  if (jobCreator) parts.push(`Job: ${jobCreator}`)
  return parts.length > 0 ? parts.join(' · ') : '—'
}

export default function SlaMissingScheduleRow({
  row,
  overSla = false,
  awaitingJob = false,
  underSla = false,
  businessDayLimit,
}: {
  row: SlaMissingScheduleJobRow
  overSla?: boolean
  awaitingJob?: boolean
  underSla?: boolean
  businessDayLimit?: number
}) {
  const title =
    row.location_address?.trim() || (row.job_id != null ? `Job ${row.job_id}` : `Quote ${row.quote_id}`)

  return (
    <article
      className={`sla-job-timeline-row sla-job-timeline-row--missing-schedule${
        overSla ? ' sla-job-timeline-row--over-sla' : ''
      }${awaitingJob ? ' sla-job-timeline-row--awaiting-job' : ''}`}
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
              overSla
                ? 'sla-job-timeline-row__sla-badge--fail'
                : awaitingJob || underSla
                  ? 'sla-job-timeline-row__sla-badge--missing'
                  : 'sla-job-timeline-row__sla-badge--missing'
            }`}
          >
            {overSla ? 'Over SLA' : awaitingJob ? 'Awaiting job' : underSla ? 'Under SLA' : 'Unscheduled'}
          </span>
          {(overSla || awaitingJob) && row.days_since_approval != null ? (
            <span className="sla-job-timeline-row__total">{row.days_since_approval} bd since approval</span>
          ) : null}
        </div>
      </header>

      <dl className="sla-missing-schedule-row__dates">
        <div>
          <dt>Deficiency</dt>
          <dd>{formatSlaTimelineDate(row.deficiency_reported_on)}</dd>
        </div>
        <div>
          <dt>Quoted</dt>
          <dd>{formatSlaTimelineDate(row.quote_created_on)}</dd>
        </div>
        <div>
          <dt>Approved</dt>
          <dd>{formatSlaTimelineDate(row.quote_accepted_on)}</dd>
        </div>
        <div>
          <dt>Scheduled</dt>
          <dd className="sla-missing-schedule-row__missing-value">—</dd>
        </div>
      </dl>

      <p className="sla-missing-schedule-row__note text-muted small mb-0">
        {overSla
          ? awaitingJob || row.no_job_created
            ? `Approved more than ${businessDayLimit ?? 10} business days ago with no repair job created yet.`
            : `Approved more than ${businessDayLimit ?? 10} business days ago — job has not been scheduled yet.`
          : awaitingJob
            ? `Approved within the last ${businessDayLimit ?? 10} business days — repair job not created yet.`
            : underSla
              ? `Approved within the last ${businessDayLimit ?? 10} business days — job has not been scheduled yet.`
              : row.no_job_record
                ? 'Quote has a job ID but no job record is synced yet.'
                : 'Job exists in ServiceTrade but has no scheduling action in our sync.'}
      </p>
    </article>
  )
}
