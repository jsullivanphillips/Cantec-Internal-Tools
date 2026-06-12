import { useCallback, useEffect, useState } from 'react'
import { Alert, Button } from 'react-bootstrap'
import PortalDeficienciesCard from './PortalDeficienciesCard'
import PortalDeficiencyModal, { type DeficiencyFormValues } from './PortalDeficiencyModal'
import PortalEditableFieldRow from './PortalEditableFieldRow'
import PortalMonitoringCompanyField from './PortalMonitoringCompanyField'
import {
  portalFieldEditActionPointerGuard,
  usePortalFieldEditActionRegistry,
} from './portalFieldEditRegistry'
import {
  officeCreateDeficiency,
  officeUpdateDeficiency,
  officeVerifyDeficiency,
} from './officeStopSiteApi'
import { rollbackPatchForChanges } from './runDetailsPrepPatch'
import type { PrepStopPatchChanges } from './runDetailsPrepPatch'
import type { RunDetailsStopPatchApi } from './useRunDetailsStopPatch'
import type { MonitoringCompanySummary, TechnicianWorksheetLocation } from './monthlyRoutesShared'
import type { PortalDeficiencySummary } from './portalWorkflowShared'
import { useMonitoringCompanies } from './useMonitoringCompanies'
import type { WorksheetStopChangeSet } from './worksheetOfflineStore'

type Props = {
  stop: TechnicianWorksheetLocation
  routeId: number
  monthDate: string
  runId: number | null
  readOnly: boolean
  hasServiceTradeLink?: boolean
  stopPatch: RunDetailsStopPatchApi
  onStopMergedFromWorksheet: (stop: TechnicianWorksheetLocation, scope?: 'full' | 'deficiency') => void
}

export default function RunDetailsStopSiteEditableFields({
  stop,
  routeId,
  monthDate,
  runId,
  readOnly,
  hasServiceTradeLink = false,
  stopPatch,
  onStopMergedFromWorksheet,
}: Props) {
  const { companies: monitoringCompanies, loading: monitoringCompaniesLoading, appendCompany } =
    useMonitoringCompanies()
  const [editingField, setEditingField] = useState<string | null>(null)
  const {
    activeFieldEditActions,
    registerFieldEditActions,
    unregisterFieldEditActions,
  } = usePortalFieldEditActionRegistry(editingField)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [defModalOpen, setDefModalOpen] = useState(false)
  const [defModalMode, setDefModalMode] = useState<'add' | 'edit'>('add')
  const [editingDeficiency, setEditingDeficiency] = useState<PortalDeficiencySummary | null>(null)

  useEffect(() => {
    setEditingField(null)
    setSaveError(null)
  }, [stop.location_id])

  const { patchStop: patchStopFields, setError: setStopPatchError } = stopPatch

  const patchStop = useCallback(
    async (fieldKey: string, changes: WorksheetStopChangeSet) => {
      setSaveError(null)
      setStopPatchError(null)
      const prepChanges = changes as PrepStopPatchChanges
      try {
        await patchStopFields(
          stop.location_id,
          fieldKey,
          prepChanges,
          rollbackPatchForChanges(stop, prepChanges),
        )
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : 'Could not save.')
        throw e
      }
    },
    [stop, patchStopFields, setStopPatchError],
  )

  const saveField = useCallback(
    (field: keyof WorksheetStopChangeSet) => async (text: string) => {
      if (readOnly) return
      await patchStop(`modal-${String(field)}`, { [field]: text.length > 0 ? text : null })
    },
    [patchStop, readOnly],
  )

  const saveMonitoringCompanyId = useCallback(
    async (companyId: number | null) => {
      if (readOnly) return
      const selected =
        companyId != null ? monitoringCompanies.find((row) => row.id === companyId) ?? null : null
      await patchStop('modal-monitoring_company_id', {
        monitoring_company_id: companyId,
        monitoring_company: selected?.name?.trim() || null,
      })
    },
    [patchStop, readOnly, monitoringCompanies],
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

  const applyDeficiencyStop = useCallback(
    (updated: TechnicianWorksheetLocation) => {
      onStopMergedFromWorksheet(updated, 'deficiency')
    },
    [onStopMergedFromWorksheet],
  )

  const openDeficiencyAdd = useCallback(() => {
    setDefModalMode('add')
    setEditingDeficiency(null)
    setDefModalOpen(true)
  }, [])

  const openDeficiencyEdit = useCallback((def: PortalDeficiencySummary) => {
    setDefModalMode('edit')
    setEditingDeficiency(def)
    setDefModalOpen(true)
  }, [])

  const handleDeficiencySave = useCallback(
    async (values: DeficiencyFormValues) => {
      if (readOnly) return
      const updated =
        defModalMode === 'add'
          ? await officeCreateDeficiency(routeId, monthDate, stop.location_id, {
              title: values.title,
              severity: values.severity,
              status: values.status,
              description: values.description || undefined,
              run_id: runId,
              service_line: values.serviceLine,
              create_on_service_trade: values.createOnServiceTrade,
            })
          : editingDeficiency
            ? await officeUpdateDeficiency(
                routeId,
                monthDate,
                stop.location_id,
                editingDeficiency.id,
                values,
              )
            : null
      if (updated) await applyDeficiencyStop(updated)
    },
    [
      readOnly,
      defModalMode,
      routeId,
      monthDate,
      stop.location_id,
      runId,
      editingDeficiency,
      applyDeficiencyStop,
      hasServiceTradeLink,
    ],
  )

  const handleDeficiencyVerify = useCallback(
    async (def: PortalDeficiencySummary) => {
      if (readOnly) return
      setSaveError(null)
      try {
        const updated = await officeVerifyDeficiency(
          routeId,
          monthDate,
          stop.location_id,
          def.id,
        )
        await applyDeficiencyStop(updated)
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : 'Could not verify deficiency.')
      }
    },
    [readOnly, routeId, monthDate, stop.location_id, applyDeficiencyStop],
  )

  return (
    <>
      {saveError ? (
        <Alert variant="danger" className="py-2 small mx-3 mt-2 mb-0" onClose={() => setSaveError(null)} dismissible>
          {saveError}
        </Alert>
      ) : null}
      <div className="run-details-stop-site-modal__sections pw-mock-fields">
        <div className="pw-mock-field-group">
          <div className="pw-mock-field-group-title">Site</div>
          <PortalEditableFieldRow
            fieldKey="property_management_company"
            label="Property management"
            value={stop.property_management_company ?? ''}
            onSave={saveField('property_management_company')}
            {...fieldEditProps}
          />
          <PortalEditableFieldRow
            fieldKey="label"
            label="Building"
            value={stop.label ?? ''}
            onSave={saveField('label')}
            {...fieldEditProps}
          />
        </div>
        <div className="pw-mock-field-group">
          <div className="pw-mock-field-group-title">Access</div>
          <div className="pw-mock-access-row">
            <PortalEditableFieldRow
              fieldKey="ring"
              label="Ring"
              value={stop.ring ?? ''}
              onSave={saveField('ring')}
              {...fieldEditProps}
            />
            <PortalEditableFieldRow
              fieldKey="key_number"
              label="Key #"
              value={stop.key_number ?? ''}
              onSave={saveField('key_number')}
              {...fieldEditProps}
            />
            <PortalEditableFieldRow
              fieldKey="door_code"
              label="Door code"
              value={stop.door_code ?? ''}
              onSave={saveField('door_code')}
              {...fieldEditProps}
            />
            <PortalEditableFieldRow
              fieldKey="annual_month"
              label="Annual"
              value={stop.annual_month ?? ''}
              monthSelect
              onSave={saveField('annual_month')}
              {...fieldEditProps}
            />
          </div>
        </div>
        <div className="pw-mock-field-group">
          <div className="pw-mock-field-group-title">Panel</div>
          <PortalEditableFieldRow
            fieldKey="panel"
            label="Panel (make / model)"
            value={stop.panel ?? ''}
            onSave={saveField('panel')}
            {...fieldEditProps}
          />
          <PortalEditableFieldRow
            fieldKey="panel_location"
            label="Panel location"
            value={stop.panel_location ?? ''}
            onSave={saveField('panel_location')}
            {...fieldEditProps}
          />
        </div>
        <div className="pw-mock-field-group">
          <div className="pw-mock-field-group-title">Monitoring</div>
          <PortalMonitoringCompanyField
            fieldKey="monitoring_company_id"
            label="Company"
            companyId={stop.monitoring_company_id ?? null}
            companyName={stop.monitoring_company}
            companyRecord={stop.monitoring_company_record}
            companies={monitoringCompanies}
            companiesLoading={monitoringCompaniesLoading}
            onSave={saveMonitoringCompanyId}
            onCompanyCreated={handleMonitoringCompanyCreated}
            {...fieldEditProps}
          />
          <PortalEditableFieldRow
            fieldKey="monitoring_account_number"
            label="Account #"
            value={stop.monitoring_account_number ?? ''}
            onSave={saveField('monitoring_account_number')}
            {...fieldEditProps}
          />
          <PortalEditableFieldRow
            fieldKey="monitoring_password"
            label="Password"
            value={stop.monitoring_password ?? ''}
            onSave={saveField('monitoring_password')}
            {...fieldEditProps}
          />
          <PortalEditableFieldRow
            fieldKey="monitoring_notes"
            label="Notes"
            value={stop.monitoring_notes ?? ''}
            multiline
            onSave={saveField('monitoring_notes')}
            {...fieldEditProps}
          />
        </div>
        <PortalDeficienciesCard
          stop={stop}
          readOnly={readOnly}
          onAdd={openDeficiencyAdd}
          onEdit={openDeficiencyEdit}
          onVerify={handleDeficiencyVerify}
          onToggleHidden={() => {}}
        />
        <div className="pw-mock-field-group">
          <div className="pw-mock-field-group-title">Comments</div>
          <PortalEditableFieldRow
            fieldKey="testing_procedures"
            label="Testing procedures"
            value={stop.testing_procedures ?? ''}
            multiline
            onSave={saveField('testing_procedures')}
            {...fieldEditProps}
          />
          <PortalEditableFieldRow
            fieldKey="inspection_tech_notes"
            label="Location comments"
            value={stop.inspection_tech_notes ?? ''}
            multiline
            onSave={saveField('inspection_tech_notes')}
            {...fieldEditProps}
          />
          <PortalEditableFieldRow
            fieldKey="run_comments"
            label="Job comments"
            value={stop.run_comments ?? ''}
            multiline
            onSave={saveField('run_comments')}
            {...fieldEditProps}
          />
        </div>
      </div>
      {activeFieldEditActions ? (
        <div className="run-details-stop-site-modal__edit-footer">
          <Button
            variant="outline-secondary"
            size="sm"
            onPointerDown={portalFieldEditActionPointerGuard}
            onMouseDown={portalFieldEditActionPointerGuard}
            onClick={activeFieldEditActions.cancel}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onPointerDown={portalFieldEditActionPointerGuard}
            onMouseDown={portalFieldEditActionPointerGuard}
            onClick={activeFieldEditActions.save}
          >
            Save
          </Button>
        </div>
      ) : null}
      <PortalDeficiencyModal
        show={defModalOpen}
        mode={defModalMode}
        deficiency={editingDeficiency}
        onHide={() => setDefModalOpen(false)}
        onSave={handleDeficiencySave}
        officeServiceTrade={defModalMode === 'add' ? { hasServiceTradeLink } : null}
      />
    </>
  )
}
