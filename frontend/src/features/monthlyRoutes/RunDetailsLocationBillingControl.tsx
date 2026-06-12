import { Badge, Button, ButtonGroup } from 'react-bootstrap'
import {
  billingStatusLabel,
  billingStatusVariant,
  type OfficeBillingStatus,
} from './officeRunReviewShared'

const BILLING_CHOICES: {
  value: Extract<OfficeBillingStatus, 'bill' | 'do_not_bill'>
  label: string
  variant: string
  activeVariant: string
}[] = [
  { value: 'bill', label: 'Bill', variant: 'outline-success', activeVariant: 'success' },
  { value: 'do_not_bill', label: 'Waive', variant: 'outline-danger', activeVariant: 'danger' },
]

type Props = {
  billingStatus: string | null
  readOnly?: boolean
  error?: string | null
  layout?: 'horizontal' | 'vertical'
  onChange: (status: Extract<OfficeBillingStatus, 'bill' | 'do_not_bill' | 'unset'>) => void
}

export default function RunDetailsLocationBillingControl({
  billingStatus,
  readOnly = false,
  error = null,
  layout = 'horizontal',
  onChange,
}: Props) {
  const status = (billingStatus || '').trim().toLowerCase()
  const isLegacy = status === 'legacy'
  const isUnset = status === '' || status === 'unset'

  if (readOnly || isLegacy) {
    return (
      <div className="run-location-card__billing-readonly">
        <Badge bg={billingStatusVariant(billingStatus)} className="run-location-card__billing-badge">
          {billingStatusLabel(billingStatus)}
        </Badge>
      </div>
    )
  }

  const vertical = layout === 'vertical'

  return (
    <div
      className={`run-location-card__billing-control${vertical ? ' run-location-card__billing-control--vertical' : ''}`}
    >
      <ButtonGroup
        vertical={vertical}
        className={`run-location-card__billing-segment${isUnset ? ' run-location-card__billing-segment--unset' : ''}${vertical ? ' run-location-card__billing-segment--vertical' : ''}`}
        role="group"
        aria-label={isUnset ? 'Choose billing for this location' : 'Billing status'}
      >
        {BILLING_CHOICES.map((seg) => {
          const active = status === seg.value
          return (
            <Button
              key={seg.value}
              size="sm"
              variant={active ? seg.activeVariant : seg.variant}
              active={active}
              aria-pressed={active}
              title={active ? 'Click again to clear billing' : undefined}
              onClick={() => onChange(active ? 'unset' : seg.value)}
            >
              {seg.label}
            </Button>
          )
        })}
      </ButtonGroup>
      {error ? (
        <p className="run-location-card__billing-error text-danger small mb-0" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
