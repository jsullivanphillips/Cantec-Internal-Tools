import { Button } from 'react-bootstrap'
import type { ServiceTradeRunJobMonth } from './monthlyRoutesShared'

export const SERVICE_TRADE_RUN_JOB_MISSING_TITLE =
  'No ServiceTrade testing job synced for this month yet'

type Props = {
  job: ServiceTradeRunJobMonth | null | undefined
  /** Compact icon + label layout for the route detail runs table. */
  tableAction?: boolean
  monthLabel?: string
  className?: string
}

export default function ViewServiceTradeRunJobButton({
  job,
  tableAction = false,
  monthLabel,
  className,
}: Props) {
  const jobUrl = (job?.service_trade_job_url || '').trim()
  const hasJob = jobUrl.length > 0 && job?.service_trade_job_id != null
  const ariaLabel = monthLabel
    ? `View ServiceTrade job for ${monthLabel}`
    : 'View ServiceTrade job for this month'

  if (tableAction) {
    if (hasJob) {
      return (
        <Button
          as="a"
          href={jobUrl}
          target="_blank"
          rel="noopener noreferrer"
          variant="light"
          size="sm"
          className={
            className ??
            'monthly-route-detail-runs-actions__btn monthly-route-runs-table-action monthly-route-runs-table-action--st-job'
          }
          title="View ST Job"
          aria-label={ariaLabel}
        >
          <i className="bi bi-box-arrow-up-right" aria-hidden />
          <span className="monthly-route-detail-runs-actions__btn-label">ST Job</span>
        </Button>
      )
    }
    return (
      <Button
        type="button"
        variant="light"
        size="sm"
        disabled
        className={
          className ??
          'monthly-route-detail-runs-actions__btn monthly-route-runs-table-action monthly-route-runs-table-action--st-job'
        }
        title={SERVICE_TRADE_RUN_JOB_MISSING_TITLE}
        aria-label={ariaLabel}
      >
        <i className="bi bi-box-arrow-up-right" aria-hidden />
        <span className="monthly-route-detail-runs-actions__btn-label">ST Job</span>
      </Button>
    )
  }

  if (hasJob) {
    return (
      <Button
        as="a"
        href={jobUrl}
        target="_blank"
        rel="noopener noreferrer"
        size="sm"
        variant="outline-secondary"
        className={className ?? 'monthly-location-detail-action'}
        aria-label={ariaLabel}
      >
        View ST Job
      </Button>
    )
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline-secondary"
      disabled
      className={className ?? 'monthly-location-detail-action'}
      title={SERVICE_TRADE_RUN_JOB_MISSING_TITLE}
      aria-label={ariaLabel}
    >
      View ST Job
    </Button>
  )
}
