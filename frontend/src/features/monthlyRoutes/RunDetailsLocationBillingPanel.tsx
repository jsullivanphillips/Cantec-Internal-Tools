import { useCallback, useState } from 'react'
import { Badge, Button, Spinner } from 'react-bootstrap'
import {
  billingStatusLabel,
  billingStatusVariant,
  type OfficeBillingStatus,
} from './officeRunReviewShared'
import type {
  MonthlyRunDetailBillingLocation,
  TechnicianWorksheetRun,
} from './monthlyRoutesShared'
import { apiJson } from '../../lib/apiClient'
import { runDetailsOfficeReviewReadOnly } from './runWorkflowShared'

type BillingPatchResponse = {
  ok: boolean
  location_id: number
  month_date: string
  billing_status: OfficeBillingStatus
}

export default function RunDetailsLocationBillingPanel({
  routeId,
  monthDate,
  billingLocations,
  run,
  onBillingUpdated,
}: {
  routeId: number
  monthDate: string
  billingLocations: MonthlyRunDetailBillingLocation[]
  run: TechnicianWorksheetRun | null
  onBillingUpdated: () => Promise<void>
}) {
  const readOnly = runDetailsOfficeReviewReadOnly(run)

  const [busyLocationId, setBusyLocationId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const setBilling = useCallback(
    async (locationId: number, billing_status: OfficeBillingStatus) => {
      setBusyLocationId(locationId)
      setError(null)
      try {
        const qs = new URLSearchParams({ month: monthDate })
        await apiJson<BillingPatchResponse>(
          `/api/monthly_routes/routes/${routeId}/locations/${locationId}/billing_status?${qs.toString()}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ billing_status }),
          },
        )
        await onBillingUpdated()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to update billing.')
      } finally {
        setBusyLocationId(null)
      }
    },
    [routeId, monthDate, onBillingUpdated],
  )

  if (!billingLocations.length) return null

  return (
    <section
      className="monthly-location-detail-surface monthly-run-detail-billing"
      aria-label="Location billing"
    >
      <h2 className="monthly-run-detail-section__title">Billing by location</h2>
      <p className="monthly-run-detail-section__meta text-muted small mb-3">
        Set whether each address is billed for this month. Legacy imports are read-only.
      </p>
      {error ? (
        <p className="text-danger small" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="monthly-run-detail-billing__list list-unstyled mb-0">
        {billingLocations.map((group) => {
          const status = (group.billing_status || 'unset').toLowerCase()
          const isLegacy = status === 'legacy'
          const disabled = readOnly || isLegacy || busyLocationId === group.location_id
          return (
            <li key={group.location_id} className="monthly-run-detail-billing__row">
              <div className="monthly-run-detail-billing__label">
                <span className="monthly-run-detail-billing__address">{group.location_label}</span>
                <Badge bg={billingStatusVariant(group.billing_status)} className="ms-2">
                  {billingStatusLabel(group.billing_status)}
                </Badge>
              </div>
              <div className="monthly-run-detail-billing__actions">
                {busyLocationId === group.location_id ? (
                  <Spinner animation="border" size="sm" aria-label="Saving billing" />
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant={status === 'bill' ? 'success' : 'outline-success'}
                      disabled={disabled}
                      onClick={() => void setBilling(group.location_id, 'bill')}
                    >
                      Bill
                    </Button>
                    <Button
                      size="sm"
                      variant={status === 'do_not_bill' ? 'danger' : 'outline-danger'}
                      disabled={disabled}
                      onClick={() => void setBilling(group.location_id, 'do_not_bill')}
                    >
                      Do not bill
                    </Button>
                    {!isLegacy && !readOnly ? (
                      <Button
                        size="sm"
                        variant={status === 'unset' ? 'warning' : 'outline-secondary'}
                        disabled={disabled}
                        onClick={() => void setBilling(group.location_id, 'unset')}
                      >
                        Unset
                      </Button>
                    ) : null}
                  </>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
