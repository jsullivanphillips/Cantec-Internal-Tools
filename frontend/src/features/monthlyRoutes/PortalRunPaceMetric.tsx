import Badge from 'react-bootstrap/Badge'
import type { PortalPriorMonthPace } from './monthlyRoutesShared'

function paceBadgeVariant(status: PortalPriorMonthPace['status']): string {
  if (status === 'ahead') return 'success'
  if (status === 'behind') return 'warning'
  return 'secondary'
}

function paceStatusLabel(status: PortalPriorMonthPace['status']): string {
  if (status === 'ahead') return 'Ahead'
  if (status === 'behind') return 'Behind'
  return 'On pace'
}

function formatPaceDelta(delta: number): string {
  if (delta > 0) return `+${delta}`
  return String(delta)
}

export function portalRunPaceAriaLabel(pace: PortalPriorMonthPace): string {
  if (!pace.available || pace.status == null || pace.delta == null) {
    return 'Prior month pace unavailable'
  }
  const time = (pace.as_of_time_label || '').trim() || 'now'
  const prior = (pace.prior_month_label || 'last month').trim()
  const sites = Math.abs(pace.delta) === 1 ? 'site' : 'sites'
  if (pace.status === 'even') {
    return `On pace with ${prior} as of ${time}`
  }
  const direction = pace.status === 'ahead' ? 'Ahead of' : 'Behind'
  return `${direction} ${prior} by ${Math.abs(pace.delta)} ${sites} as of ${time}`
}

type PortalRunPaceMetricProps = {
  pace: PortalPriorMonthPace
  className?: string
}

export function PortalRunPaceMetric({ pace, className }: PortalRunPaceMetricProps) {
  if (!pace.available || pace.status == null || pace.delta == null) {
    return null
  }

  const priorLabel = (pace.prior_month_label || 'last month').trim()
  const deltaLabel = formatPaceDelta(pace.delta)

  return (
    <div className={['pw-mock-chrome-pace', className].filter(Boolean).join(' ')}>
      <Badge
        bg={paceBadgeVariant(pace.status)}
        className="pw-mock-chrome-pace-badge"
        aria-label={portalRunPaceAriaLabel(pace)}
      >
        <span className="pw-mock-chrome-pace-status">{paceStatusLabel(pace.status)}</span>
        <span className="pw-mock-chrome-pace-delta" aria-hidden>
          {deltaLabel}
        </span>
        <span className="pw-mock-chrome-pace-vs" aria-hidden>
          vs {priorLabel}
        </span>
      </Badge>
    </div>
  )
}
