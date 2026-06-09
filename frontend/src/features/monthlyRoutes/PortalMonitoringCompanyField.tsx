import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import MonitoringCompanySelect, {
  monitoringCompanyDisplayName,
  monitoringCompanyPhonesText,
} from './MonitoringCompanySelect'
import type { PortalFieldEditActions } from './PortalEditableFieldRow'
import { schedulePortalFieldRowScroll } from './portalFieldEditRegistry'
import type { MonitoringCompanySummary } from './monthlyRoutesShared'

type PortalMonitoringCompanyFieldProps = {
  fieldKey: string
  label: string
  companyId: number | null
  companyName: string | null
  companyRecord: MonitoringCompanySummary | null | undefined
  companies: MonitoringCompanySummary[]
  companiesLoading?: boolean
  readOnly?: boolean
  editingField: string | null
  onEditingFieldChange: (key: string | null) => void
  onSave: (companyId: number | null) => void
  onCompanyCreated?: (company: MonitoringCompanySummary) => void
  onRegisterFieldEditActions?: (actions: PortalFieldEditActions) => void
  onUnregisterFieldEditActions?: (fieldKey: string) => void
  /** @deprecated Use onRegisterFieldEditActions / onUnregisterFieldEditActions */
  onEditActionsChange?: (actions: PortalFieldEditActions | null) => void
}

export default function PortalMonitoringCompanyField({
  fieldKey,
  label,
  companyId,
  companyName,
  companyRecord,
  companies,
  companiesLoading,
  readOnly,
  editingField,
  onEditingFieldChange,
  onSave,
  onCompanyCreated,
  onRegisterFieldEditActions,
  onUnregisterFieldEditActions,
  onEditActionsChange,
}: PortalMonitoringCompanyFieldProps) {
  const inputId = useId()
  const rowRef = useRef<HTMLDivElement>(null)
  const [draftId, setDraftId] = useState<number | null>(companyId)
  const editing = !readOnly && editingField === fieldKey

  const displayName =
    companyRecord?.name?.trim() ||
    monitoringCompanyDisplayName(companyId, companies, companyName) ||
    '—'
  const phones = monitoringCompanyPhonesText(companyRecord ?? companies.find((row) => row.id === companyId))

  useEffect(() => {
    if (!editing) setDraftId(companyId)
  }, [companyId, editing])

  const commit = useCallback(() => {
    if (draftId !== companyId) onSave(draftId)
    onEditingFieldChange(null)
  }, [companyId, draftId, onEditingFieldChange, onSave])

  const cancel = useCallback(() => {
    setDraftId(companyId)
    onEditingFieldChange(null)
  }, [companyId, onEditingFieldChange])

  const commitRef = useRef(commit)
  const cancelRef = useRef(cancel)
  commitRef.current = commit
  cancelRef.current = cancel

  useLayoutEffect(() => {
    if (!editing) return undefined
    return schedulePortalFieldRowScroll(rowRef)
  }, [editing])

  useLayoutEffect(() => {
    if (!editing) return undefined

    const actions: PortalFieldEditActions = {
      fieldKey,
      cancel: () => cancelRef.current(),
      save: () => commitRef.current(),
    }
    if (onRegisterFieldEditActions) {
      onRegisterFieldEditActions(actions)
    } else {
      onEditActionsChange?.(actions)
    }

    return () => {
      if (onUnregisterFieldEditActions) {
        onUnregisterFieldEditActions(fieldKey)
      } else {
        onEditActionsChange?.(null)
      }
    }
  }, [
    editing,
    fieldKey,
    onRegisterFieldEditActions,
    onUnregisterFieldEditActions,
    onEditActionsChange,
  ])

  const startEdit = () => {
    if (readOnly) return
    setDraftId(companyId)
    onEditingFieldChange(fieldKey)
  }

  if (!editing) {
    return (
      <div
        ref={rowRef}
        className="pw-mock-field-row pw-mock-field-row--editable"
        role="button"
        tabIndex={readOnly ? -1 : 0}
        onClick={startEdit}
        onKeyDown={(e) => {
          if (readOnly) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            startEdit()
          }
        }}
      >
        <div className="pw-mock-field-label">{label}</div>
        <div className="pw-mock-field-value">
          <div>{displayName}</div>
          {phones ? <div className="text-muted small">{phones}</div> : null}
        </div>
      </div>
    )
  }

  return (
    <div ref={rowRef} className="pw-mock-field-row pw-mock-field-row--editing">
      <label className="pw-mock-field-label" htmlFor={inputId}>
        {label}
      </label>
      <div className="pw-mock-field-value">
        <MonitoringCompanySelect
          id={inputId}
          className="pw-mock-field-input"
          companies={companies}
          value={draftId}
          disabled={companiesLoading}
          onChange={setDraftId}
          onCompanyCreated={onCompanyCreated}
        />
        {draftId != null ? (
          <div className="text-muted small mt-1">
            {monitoringCompanyPhonesText(companies.find((row) => row.id === draftId))}
          </div>
        ) : null}
        <div className="pw-mock-field-edit-actions">
          <button type="button" className="pw-mock-field-edit-btn" onClick={cancel}>
            Cancel
          </button>
          <button
            type="button"
            className="pw-mock-field-edit-btn pw-mock-field-edit-btn--primary"
            onClick={commit}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
