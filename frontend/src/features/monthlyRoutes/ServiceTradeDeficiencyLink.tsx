import { type MouseEvent } from 'react'
import { Button } from 'react-bootstrap'
import { serviceTradeDeficiencyUrl } from './serviceTradeDeficienciesApi'

type Props = {
  deficiencyId: number
  className?: string
  compact?: boolean
  onClick?: (event: MouseEvent<HTMLElement>) => void
}

export default function ServiceTradeDeficiencyLink({
  deficiencyId,
  className,
  compact = false,
  onClick,
}: Props) {
  return (
    <Button
      as="a"
      href={serviceTradeDeficiencyUrl(deficiencyId)}
      target="_blank"
      rel="noopener noreferrer"
      variant="outline-primary"
      size="sm"
      className={className ?? (compact ? 'service-trade-def-link service-trade-def-link--compact' : 'service-trade-def-link')}
      onClick={onClick}
      aria-label={compact ? 'Open in ServiceTrade' : undefined}
    >
      <i className="bi bi-box-arrow-up-right" aria-hidden />
      {compact ? null : <span className="service-trade-def-link__label">Open in ServiceTrade</span>}
    </Button>
  )
}
