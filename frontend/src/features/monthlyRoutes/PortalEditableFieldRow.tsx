import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { annualMonthSelectChoiceValues, normalizeAnnualMonthForSelect } from './monthlyRoutesShared'
import PortalFieldEditActionButtons from './PortalFieldEditActionButtons'
import {
  createPortalFieldEditBlurHandler,
  schedulePortalFieldRowScroll,
} from './portalFieldEditRegistry'

export type PortalFieldEditActions = {
  fieldKey: string
  cancel: () => void
  save: () => void
}

type PortalEditableFieldRowProps = {
  fieldKey: string
  label: string
  value: string
  /** Short helper shown under the field label. */
  hint?: string
  multiline?: boolean
  readOnly?: boolean
  editingField: string | null
  onEditingFieldChange: (key: string | null) => void
  onSave: (next: string) => void | Promise<void>
  onRegisterFieldEditActions?: (actions: PortalFieldEditActions) => void
  onUnregisterFieldEditActions?: (fieldKey: string) => void
  /** @deprecated Use onRegisterFieldEditActions / onUnregisterFieldEditActions */
  onEditActionsChange?: (actions: PortalFieldEditActions | null) => void
  /** When true, edit with a month-of-year dropdown instead of free text. */
  monthSelect?: boolean
  /** When true, open the month select dropdown as soon as edit mode starts (requires user gesture). */
  autoOpenSelect?: boolean
  onAutoOpenSelectDone?: () => void
}

export default function PortalEditableFieldRow({
  fieldKey,
  label,
  value,
  hint,
  multiline,
  readOnly,
  editingField,
  onEditingFieldChange,
  onSave,
  onRegisterFieldEditActions,
  onUnregisterFieldEditActions,
  onEditActionsChange,
  monthSelect = false,
  autoOpenSelect = false,
  onAutoOpenSelectDone,
}: PortalEditableFieldRowProps) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const normalizedValue = monthSelect ? normalizeAnnualMonthForSelect(value) : value.trim()
  const [draft, setDraft] = useState(normalizedValue)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const editing = !readOnly && editingField === fieldKey
  const display = monthSelect ? normalizedValue || '—' : value.trim() || '—'

  const monthSelectChoices = useMemo(() => {
    if (!monthSelect) return []
    return annualMonthSelectChoiceValues(value)
  }, [monthSelect, value])

  useEffect(() => {
    savingRef.current = saving
  }, [saving])

  useEffect(() => {
    if (!editing) {
      setDraft(monthSelect ? normalizeAnnualMonthForSelect(value) : value)
      setSaving(false)
    }
  }, [value, editing, monthSelect])

  useLayoutEffect(() => {
    if (!editing) return undefined
    return schedulePortalFieldRowScroll(rowRef)
  }, [editing])

  const commit = useCallback(async () => {
    if (saving) return
    const next = draft.trim()
    const committed = monthSelect ? normalizeAnnualMonthForSelect(value) : value.trim()
    if (next === committed) {
      onEditingFieldChange(null)
      return
    }
    setSaving(true)
    try {
      await onSave(next)
      onEditingFieldChange(null)
    } catch {
      // Parent surfaces save errors; keep edit mode open.
    } finally {
      setSaving(false)
    }
  }, [draft, monthSelect, onEditingFieldChange, onSave, saving, value])

  const cancel = useCallback(() => {
    if (saving) return
    setDraft(monthSelect ? normalizeAnnualMonthForSelect(value) : value)
    onEditingFieldChange(null)
  }, [monthSelect, onEditingFieldChange, saving, value])

  const commitRef = useRef(commit)
  const cancelRef = useRef(cancel)
  commitRef.current = commit
  cancelRef.current = cancel

  const handleEditBlur = useMemo(
    () =>
      createPortalFieldEditBlurHandler(
        rowRef,
        () => savingRef.current,
        () => cancelRef.current(),
      ),
    [],
  )

  const onAutoOpenSelectDoneRef = useRef(onAutoOpenSelectDone)
  onAutoOpenSelectDoneRef.current = onAutoOpenSelectDone

  useLayoutEffect(() => {
    if (!editing) return undefined

    const input = inputRef.current
    try {
      input?.focus({ preventScroll: true })
    } catch {
      input?.focus()
    }

    if (monthSelect && autoOpenSelect && input instanceof HTMLSelectElement) {
      try {
        input.showPicker()
      } catch {
        // showPicker may fail outside a user gesture or on unsupported browsers.
      }
      onAutoOpenSelectDoneRef.current?.()
    }

    return undefined
  }, [editing, monthSelect, autoOpenSelect])

  useLayoutEffect(() => {
    if (!editing) return undefined

    const actions: PortalFieldEditActions = {
      fieldKey,
      cancel: () => cancelRef.current(),
      save: () => void commitRef.current(),
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
    setDraft(monthSelect ? normalizeAnnualMonthForSelect(value) : value)
    onEditingFieldChange(fieldKey)
  }

  const labelBlock = hint ? (
    <>
      <span>{label}</span>
      <span className="pw-mock-field-hint">{hint}</span>
    </>
  ) : (
    label
  )

  if (!editing) {
    return (
      <div
        className={`pw-mock-field-row${multiline ? ' pw-mock-field-row--multiline' : ''}${
          readOnly ? '' : ' pw-mock-field-row--editable'
        }`}
        role={readOnly ? undefined : 'button'}
        tabIndex={readOnly ? undefined : 0}
        onClick={startEdit}
        onKeyDown={(e) => {
          if (readOnly) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            startEdit()
          }
        }}
      >
        <div className="pw-mock-field-label">{labelBlock}</div>
        <div className="pw-mock-field-value">{display}</div>
      </div>
    )
  }

  return (
    <div
      ref={rowRef}
      className={`pw-mock-field-row pw-mock-field-row--editing${
        multiline ? ' pw-mock-field-row--multiline' : ''
      }`}
    >
      <label className="pw-mock-field-label" htmlFor={inputId}>
        {labelBlock}
      </label>
      <div className="pw-mock-field-value" onBlur={handleEditBlur}>
        {multiline ? (
          <textarea
            ref={inputRef as RefObject<HTMLTextAreaElement>}
            id={inputId}
            className="pw-mock-field-input"
            rows={4}
            value={draft}
            disabled={saving}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                cancel()
              }
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                commit()
              }
            }}
          />
        ) : monthSelect ? (
          <select
            ref={inputRef as RefObject<HTMLSelectElement>}
            id={inputId}
            className="pw-mock-field-input pw-mock-field-select"
            value={draft}
            disabled={saving}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commit()
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                cancel()
              }
            }}
          >
            {monthSelectChoices.map((monthName) => (
              <option key={monthName || '__empty'} value={monthName}>
                {monthName || '—'}
              </option>
            ))}
          </select>
        ) : (
          <input
            ref={inputRef as RefObject<HTMLInputElement>}
            id={inputId}
            type="text"
            className="pw-mock-field-input"
            value={draft}
            disabled={saving}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commit()
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                cancel()
              }
            }}
          />
        )}
        <PortalFieldEditActionButtons
          saving={saving}
          onCancel={cancel}
          onSubmit={() => void commit()}
        />
      </div>
    </div>
  )
}
