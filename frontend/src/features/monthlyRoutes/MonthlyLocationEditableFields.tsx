import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Alert } from 'react-bootstrap'
import PortalEditableFieldRow from './PortalEditableFieldRow'
import PortalMonitoringCompanyField from './PortalMonitoringCompanyField'
import { schedulePortalFieldRowScrollForElement, usePortalFieldEditActionRegistry } from './portalFieldEditRegistry'
import type { LibraryLocation, MonitoringCompanySummary } from './monthlyRoutesShared'
import { useMonitoringCompanies } from './useMonitoringCompanies'
import { apiJson } from '../../lib/apiClient'

type Props = {
  location: LibraryLocation
  onLocationUpdated: (loc: LibraryLocation) => void
  readOnly?: boolean
}

export type MonthlyLocationEditableFieldsHandle = {
  beginFieldEdit: (fieldKey: string, options?: { openSelect?: boolean }) => void
  scrollToField: (fieldKey: string) => void
}

const MonthlyLocationEditableFields = forwardRef<MonthlyLocationEditableFieldsHandle, Props>(
  function MonthlyLocationEditableFields({ location, onLocationUpdated, readOnly = false }, ref) {
    const { companies: monitoringCompanies, loading: monitoringCompaniesLoading, appendCompany } =
      useMonitoringCompanies()
    const [editingField, setEditingField] = useState<string | null>(null)
    const { registerFieldEditActions, unregisterFieldEditActions } =
      usePortalFieldEditActionRegistry(editingField)
    const [saveError, setSaveError] = useState<string | null>(null)
    const fieldsContainerRef = useRef<HTMLDivElement>(null)

    useImperativeHandle(
      ref,
      () => ({
        beginFieldEdit(fieldKey) {
          flushSync(() => {
            setEditingField(fieldKey)
          })
        },
        scrollToField(fieldKey) {
          const el = fieldsContainerRef.current?.querySelector<HTMLElement>(
            `[data-portal-field-key="${fieldKey}"]`,
          )
          if (el) schedulePortalFieldRowScrollForElement(el)
        },
      }),
      [],
    )

    useEffect(() => {
      setEditingField(null)
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

    const saveMonitoringCompanyId = useCallback(
      async (companyId: number | null) => {
        if (readOnly) return
        await patchLocation({ monitoring_company_id: companyId })
      },
      [patchLocation, readOnly],
    )

    const handleMonitoringCompanyCreated = useCallback(
      (company: MonitoringCompanySummary) => {
        appendCompany(company)
      },
      [appendCompany],
    )

    const fieldEditProps = {
      readOnly,
      editingField,
      onEditingFieldChange: setEditingField,
      onRegisterFieldEditActions: registerFieldEditActions,
      onUnregisterFieldEditActions: unregisterFieldEditActions,
    }

    const panelValue = (location.panel ?? location.facp_detail ?? '').trim()
    const monitoringCompanyName = location.monitoring_company?.name?.trim() || null

    return (
      <>
        {saveError ? (
          <Alert variant="danger" className="py-2 small mb-3" onClose={() => setSaveError(null)} dismissible>
            {saveError}
          </Alert>
        ) : null}
        <div
          ref={fieldsContainerRef}
          className="pw-mock-fields monthly-location-field-sheet monthly-location-technician-field-grid"
        >
          <div className="pw-mock-field-group monthly-location-technician-card monthly-location-technician-card--access">
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
                fieldKey="access_instructions"
                label="Access instructions"
                value={location.access_instructions ?? ''}
                onSave={saveTextField('access_instructions')}
                multiline
                {...fieldEditProps}
              />
            </div>
          </div>

          <div className="pw-mock-field-group monthly-location-technician-card monthly-location-technician-card--monitoring">
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

          <div className="pw-mock-field-group monthly-location-technician-card monthly-location-technician-card--panel">
            <div className="pw-mock-field-group-title">Panel</div>
            <PortalEditableFieldRow
              fieldKey="panel"
              label="Make and Model"
              value={panelValue}
              onSave={saveTextField('panel')}
              {...fieldEditProps}
            />
            <PortalEditableFieldRow
              fieldKey="panel_location"
              label="Location"
              value={location.panel_location ?? ''}
              onSave={saveTextField('panel_location')}
              {...fieldEditProps}
            />
          </div>

          <div className="pw-mock-field-group monthly-location-technician-card monthly-location-technician-card--testing-procedures">
            <div className="pw-mock-field-group-title">Testing procedures</div>
            <PortalEditableFieldRow
              fieldKey="testing_procedures"
              label="Testing procedures"
              value={location.testing_procedures ?? ''}
              multiline
              inlineEditActions
              onSave={saveTextField('testing_procedures')}
              {...fieldEditProps}
            />
          </div>

          <div className="pw-mock-field-group monthly-location-technician-card monthly-location-technician-card--tech-comments">
            <div className="pw-mock-field-group-title">Tech location comments</div>
            <PortalEditableFieldRow
              fieldKey="inspection_tech_notes"
              label="Tech location comments"
              value={location.inspection_tech_notes ?? ''}
              multiline
              inlineEditActions
              onSave={saveTextField('inspection_tech_notes')}
              {...fieldEditProps}
            />
          </div>
        </div>
      </>
    )
  },
)

export default MonthlyLocationEditableFields
