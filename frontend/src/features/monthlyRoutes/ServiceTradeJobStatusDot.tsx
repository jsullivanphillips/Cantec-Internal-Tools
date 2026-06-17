import type { ServiceTradeJobDot } from './monthlyDashboardShared'

type Props = {
  dot: ServiceTradeJobDot
  label?: string
  showLabel?: boolean
  className?: string
}

export default function ServiceTradeJobStatusDot({
  dot,
  label,
  showLabel = false,
  className,
}: Props) {
  const wrapClassName = className
    ? `service-trade-job-status-dot-wrap ${className}`
    : 'service-trade-job-status-dot-wrap'

  return (
    <span className={wrapClassName} title={dot.tooltip}>
      <span
        className={`service-trade-job-status-dot service-trade-job-status-dot--${dot.color}`}
        aria-label={dot.tooltip}
        role="img"
      />
      {showLabel && label ? (
        <span className="service-trade-job-status-dot__label">{label}</span>
      ) : null}
    </span>
  )
}
