import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react'
import { flushSync } from 'react-dom'
import { Alert } from 'react-bootstrap'
import MonthlyLocationAddressField from './MonthlyLocationAddressField'
import PortalEditableFieldRow from './PortalEditableFieldRow'
import PortalMonitoringCompanyField from './PortalMonitoringCompanyField'
import { usePortalFieldEditActionRegistry } from './portalFieldEditRegistry'
import type { GeocodeCandidate, LibraryLocation, MonitoringCompanySummary } from './monthlyRoutesShared'
import { useMonitoringCompanies } from './useMonitoringCompanies'
import { apiJson } from '../../lib/apiClient'

type Props = {
  location: LibraryLocation
  onLocationUpdated: (loc: LibraryLocation) => void
  readOnly?: boolean
}

export type MonthlyLocationEditableFieldsHandle = {
  beginFieldEdit: (fieldKey: string, options?: { openSelect?: boolean }) => void
}

const MonthlyLocationEditableFields = forwardRef<MonthlyLocationEditableFieldsHandle, Props>(
  function MonthlyLocationEditableFields({ location, onLocationUpdated, readOnly = false }, ref) {
  const { companies: monitoringCompanies, loading: monitoringCompaniesLoading, appendCompany } =
    useMonitoringCompanies()
  const [editingField, setEditingField] = useState<string | null>(null)
  const [autoOpenSelectFieldKey, setAutoOpenSelectFieldKey] = useState<string | null>(null)
  const {
    registerFieldEditActions,
    unregisterFieldEditActions,
  } = usePortalFieldEditActionRegistry(editingField)
  const [saveError, setSaveError] = useState<string | null>(null)

  useImperativeHandle(
    ref,
    () => ({
      beginFieldEdit(fieldKey, options) {
        flushSync(() => {
          setEditingField(fieldKey)
          setAutoOpenSelectFieldKey(options?.openSelect ? fieldKey : null)
        })
      },
    }),
    [],
  )

  useEffect(() => {
    setEditingField(null)
    setAutoOpenSelectFieldKey(null)
    setSaveError(null)
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
          }
        )
        onLocationUpdated(res.location)
      } catch (e) {
        const msg =
          typeof e === 'object' && e && 'error' in e ? String((e as { error: unknown }).error) : null
        setSaveError(msg || 'Could not save.')
        throw e
      }
    },
    [location.id, onLocationUpdated]
  )

  const saveTextField = useCallback(
    (apiField: string) => async (text: string) => {
      if (readOnly) return
      await patchLocation({ [apiField]: text.length > 0 ? text : null })
    },
    [patchLocation, readOnly]
  )

  const saveAddress = useCallback(
    async (candidate: GeocodeCandidate) => {
      if (readOnly) return
      const addressLine = candidate.display_address.trim()
      if (!addressLine) {
        setSaveError('Navigation address is required.')
        throw new Error('address required')
      }
      await patchLocation({
        address: addressLine,
        display_address: candidate.display_address,
        latitude: candidate.latitude,
        longitude: candidate.longitude,
      })
    },
    [patchLocation, readOnly]
  )

  const saveMonitoringCompanyId = useCallback(
    async (companyId: number | null) => {
      if (readOnly) return
      await patchLocation({ monitoring_company_id: companyId })
    },
    [patchLocation, readOnly]
  )

  const handleMonitoringCompanyCreated = useCallback(
    (company: MonitoringCompanySummary) => {
      appendCompany(company)
    },
    [appendCompany]
  )

  const clearAutoOpenSelectFieldKey = useCallback(() => {
    setAutoOpenSelectFieldKey(null)
  }, [])

  const fieldEditProps = {
    readOnly,
    editingField,
    onEditingFieldChange: setEditingField,
    onRegisterFieldEditActions: registerFieldEditActions,
    onUnregisterFieldEditActions: unregisterFieldEditActions,
  }

  const panelValue = (location.panel ?? location.facp_detail ?? '').trim()
  const monitoringCompanyName = location.monitoring_company?.name?.trim() || null
  const mapPin = (location.display_address ?? '').trim()
  const masterAddress = (location.address ?? '').trim()
  const mapPinNote =
    mapPin && masterAddress && mapPin.toLowerCase() !== masterAddress.toLowerCase()
      ? `Map pin uses geocoded address: ${mapPin}`
      : null

  return (
    <>
      {saveError ? (
        <Alert variant="danger" className="py-2 small mb-3" onClose={() => setSaveError(null)} dismissible>
          {saveError}
        </Alert>
      ) : null}
      <div className="pw-mock-fields monthly-location-field-sheet">
        <div className="pw-mock-field-group">
          <div className="pw-mock-field-group-title">Identity</div>
          <PortalEditableFieldRow
            fieldKey="label"
            label="Label"
            hint="Display name in lists, worksheets, and paperwork"
            value={location.label ?? ''}
            onSave={saveTextField('label')}
            {...fieldEditProps}
          />
          <PortalEditableFieldRow
            fieldKey="building_name"
            label="Building name"
            value={location.building_name ?? ''}
            onSave={saveTextField('building_name')}
            {...fieldEditProps}
          />
          <MonthlyLocationAddressField
            fieldKey="address"
            label="Address"
            hint="Navigation address for maps and directions"
            value={location.address ?? ''}
            onSave={saveAddress}
            {...fieldEditProps}
          />
          {mapPinNote ? (
            <div className="monthly-location-map-pin-note">{mapPinNote}</div>
          ) : null}
          <PortalEditableFieldRow
            fieldKey="property_management_company"
            label="Property management"
            value={location.property_management_company ?? ''}
            onSave={saveTextField('property_management_company')}
            {...fieldEditProps}
          />
        </div>
        <div className="pw-mock-field-group">
          <div className="pw-mock-field-group-title">Access</div>
          <div className="pw-mock-access-row">
            <PortalEditableFieldRow
              fieldKey="ring_detail"
              label="Ring"
              value={location.ring_detail ?? ''}
              onSave={saveTextField('ring_detail')}
              {...fieldEditProps}
            />
            <PortalEditableFieldRow
              fieldKey="keys"
              label="Key #"
              value={location.keys ?? ''}
              onSave={saveTextField('keys')}
              {...fieldEditProps}
            />
            <PortalEditableFieldRow
              fieldKey="barcode"
              label="Barcode"
              value={location.barcode ?? ''}
              onSave={saveTextField('barcode')}
              {...fieldEditProps}
            />
            <PortalEditableFieldRow
              fieldKey="door_code"
              label="Door code"
              value={location.door_code ?? ''}
              onSave={saveTextField('door_code')}
              {...fieldEditProps}
            />
            <PortalEditableFieldRow
              fieldKey="annual_month"
              label="Annual"
              value={location.annual_month ?? ''}
              monthSelect
              autoOpenSelect={autoOpenSelectFieldKey === 'annual_month'}
              onAutoOpenSelectDone={clearAutoOpenSelectFieldKey}
              onSave={saveTextField('annual_month')}
              {...fieldEditProps}
            />
          </div>
        </div>
        <div className="pw-mock-field-group">
          <div className="pw-mock-field-group-title">Panel</div>
          <PortalEditableFieldRow
            fieldKey="panel"
            label="Panel (make / model)"
            value={panelValue}
            onSave={saveTextField('panel')}
            {...fieldEditProps}
          />
          <PortalEditableFieldRow
            fieldKey="panel_location"
            label="Panel location"
            value={location.panel_location ?? ''}
            onSave={saveTextField('panel_location')}
            {...fieldEditProps}
          />
        </div>
        <div className="pw-mock-field-group">
          <div className="pw-mock-field-group-title">Monitoring</div>
          <PortalMonitoringCompanyField
            fieldKey="monitoring_company_id"
            label="Company"
            companyId={location.monitoring_company_id ?? null}
            companyName={monitoringCompanyName}
            companyRecord={location.monitoring_company}
            companies={monitoringCompanies}
            companiesLoading={monitoringCompaniesLoading}
            onSave={saveMonitoringCompanyId}
            onCompanyCreated={handleMonitoringCompanyCreated}
            {...fieldEditProps}
          />
          <PortalEditableFieldRow
            fieldKey="monitoring_account_number"
            label="Account #"
            value={location.monitoring_account_number ?? ''}
            onSave={saveTextField('monitoring_account_number')}
            {...fieldEditProps}
          />
          <PortalEditableFieldRow
            fieldKey="monitoring_password"
            label="Password"
            value={location.monitoring_password ?? ''}
            onSave={saveTextField('monitoring_password')}
            {...fieldEditProps}
          />
          <PortalEditableFieldRow
            fieldKey="monitoring_notes"
            label="Notes"
            value={location.monitoring_notes ?? ''}
            multiline
            onSave={saveTextField('monitoring_notes')}
            {...fieldEditProps}
          />
        </div>
        <div className="pw-mock-field-group">
          <div className="pw-mock-field-group-title">Procedures</div>
          <PortalEditableFieldRow
            fieldKey="testing_procedures"
            label="Testing procedures"
            value={location.testing_procedures ?? ''}
            multiline
            inlineEditActions
            onSave={saveTextField('testing_procedures')}
            {...fieldEditProps}
          />
          <PortalEditableFieldRow
            fieldKey="inspection_tech_notes"
            label="Location comments"
            value={location.inspection_tech_notes ?? ''}
            multiline
            inlineEditActions
            onSave={saveTextField('inspection_tech_notes')}
            {...fieldEditProps}
          />
        </div>
        <div className="pw-mock-field-group">
          <div className="pw-mock-field-group-title">Billing</div>
          <PortalEditableFieldRow
            fieldKey="price_per_month"
            label="Price per month"
            value={location.price_per_month != null ? String(location.price_per_month) : ''}
            onSave={saveTextField('price_per_month')}
            {...fieldEditProps}
          />
        </div>
      </div>
    </>
  )
},
)

export default MonthlyLocationEditableFields
