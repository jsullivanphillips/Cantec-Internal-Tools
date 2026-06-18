import { useCallback, useEffect, useState } from 'react'
import { Alert, Form } from 'react-bootstrap'
import PortalEditableFieldRow from './PortalEditableFieldRow'
import MonthlyLocationBillingCommentsPanel from './MonthlyLocationBillingCommentsPanel'
import { usePortalFieldEditActionRegistry } from './portalFieldEditRegistry'
import type { LibraryLocation } from './monthlyRoutesShared'
import { apiJson } from '../../lib/apiClient'

type MonthlyLocationBillingPanelProps = {
  location: LibraryLocation
  onLocationUpdated: (loc: LibraryLocation) => void
  readOnly?: boolean
}

export default function MonthlyLocationBillingPanel({
  location,
  onLocationUpdated,
  readOnly = false,
}: MonthlyLocationBillingPanelProps) {
  const [editingField, setEditingField] = useState<string | null>(null)
  const { registerFieldEditActions, unregisterFieldEditActions } =
    usePortalFieldEditActionRegistry(editingField)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [pricingUpdatedSaving, setPricingUpdatedSaving] = useState(false)

  useEffect(() => {
    setEditingField(null)
    setSaveError(null)
    setPricingUpdatedSaving(false)
  }, [location.id])

  const patchLocation = useCallback(
    async (payload: Record<string, unknown>) => {
      setSaveError(null)
      try {
        const res = await apiJson<{ location: LibraryLocation }>(
          `/api/monthly_routes/library/${location.id}`,
          {
            method: 'PATCH',
            body: JSON.stringify(payload),
          },
        )
        onLocationUpdated(res.location)
      } catch (e) {
        const msg =
          typeof e === 'object' && e && 'error' in e ? String((e as { error: unknown }).error) : null
        setSaveError(msg || 'Could not save.')
        throw e
      }
    },
    [location.id, onLocationUpdated],
  )

  const saveTextField = useCallback(
    (apiField: string) => async (text: string) => {
      if (readOnly) return
      await patchLocation({ [apiField]: text.length > 0 ? text : null })
    },
    [patchLocation, readOnly],
  )

  const togglePricingUpdated = useCallback(
    async (checked: boolean) => {
      if (readOnly || pricingUpdatedSaving) return
      setPricingUpdatedSaving(true)
      setSaveError(null)
      try {
        await patchLocation({ pricing_updated: checked })
      } catch {
        // saveError set in patchLocation
      } finally {
        setPricingUpdatedSaving(false)
      }
    },
    [patchLocation, pricingUpdatedSaving, readOnly],
  )

  const fieldEditProps = {
    readOnly,
    editingField,
    onEditingFieldChange: setEditingField,
    onRegisterFieldEditActions: registerFieldEditActions,
    onUnregisterFieldEditActions: unregisterFieldEditActions,
  }

  return (
    <div className="monthly-location-billing-panel">
      {saveError ? (
        <Alert variant="danger" className="py-2 small mb-3" onClose={() => setSaveError(null)} dismissible>
          {saveError}
        </Alert>
      ) : null}

      <div className="monthly-location-billing-price-pill">
        <span className="monthly-location-billing-price-pill__label">PRICE PER MONTH</span>
        <div className="monthly-location-billing-price-pill__field">
          <PortalEditableFieldRow
            fieldKey="price_per_month"
            label="Price per month"
            value={location.price_per_month != null ? String(location.price_per_month) : ''}
            onSave={saveTextField('price_per_month')}
            {...fieldEditProps}
          />
        </div>
        <Form.Check
          type="checkbox"
          id={`pricing-updated-${location.id}`}
          className="monthly-location-billing-pricing-updated"
          label="Pricing updated"
          checked={location.pricing_updated}
          disabled={readOnly || pricingUpdatedSaving}
          onChange={(e) => {
            void togglePricingUpdated(e.target.checked)
          }}
        />
      </div>

      <div className="monthly-location-billing-comments-block">
        <MonthlyLocationBillingCommentsPanel
          locationId={location.id}
          billingComments={location.billing_comments}
          onSaved={onLocationUpdated}
        />
      </div>
    </div>
  )
}
