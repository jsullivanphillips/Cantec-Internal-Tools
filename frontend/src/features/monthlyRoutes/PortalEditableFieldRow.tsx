import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { annualMonthSelectChoiceValues, normalizeAnnualMonthForSelect } from './monthlyRoutesShared'
import { schedulePortalFieldRowScroll } from './portalFieldEditRegistry'

export type PortalFieldEditActions = {
  fieldKey: string
  cancel: () => void
  save: () => void
}

type PortalEditableFieldRowProps = {
  fieldKey: string
  label: string
  value: string
  multiline?: boolean
  readOnly?: boolean
  editingField: string | null
  onEditingFieldChange: (key: string | null) => void
  onSave: (next: string) => void
  onRegisterFieldEditActions?: (actions: PortalFieldEditActions) => void
  onUnregisterFieldEditActions?: (fieldKey: string) => void
  /** @deprecated Use onRegisterFieldEditActions / onUnregisterFieldEditActions */
  onEditActionsChange?: (actions: PortalFieldEditActions | null) => void
  /** When true, edit with a month-of-year dropdown instead of free text. */
  monthSelect?: boolean
}

export default function PortalEditableFieldRow({
  fieldKey,
  label,
  value,
  multiline,
  readOnly,
  editingField,
  onEditingFieldChange,
  onSave,
  onRegisterFieldEditActions,
  onUnregisterFieldEditActions,
  onEditActionsChange,
  monthSelect = false,
}: PortalEditableFieldRowProps) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const normalizedValue = monthSelect ? normalizeAnnualMonthForSelect(value) : value.trim()
  const [draft, setDraft] = useState(normalizedValue)
  const editing = !readOnly && editingField === fieldKey
  const display = monthSelect ? normalizedValue || '—' : value.trim() || '—'

  const monthSelectChoices = useMemo(() => {
    if (!monthSelect) return []
    return annualMonthSelectChoiceValues(value)
  }, [monthSelect, value])

  useEffect(() => {
    if (!editing) setDraft(monthSelect ? normalizeAnnualMonthForSelect(value) : value)
  }, [value, editing, monthSelect])

  useLayoutEffect(() => {
    if (!editing) return undefined
    return schedulePortalFieldRowScroll(rowRef)
  }, [editing])

  const commit = useCallback(() => {
    const next = draft.trim()
    const committed = monthSelect ? normalizeAnnualMonthForSelect(value) : value.trim()
    if (next !== committed) onSave(next)
    onEditingFieldChange(null)
  }, [draft, monthSelect, onEditingFieldChange, onSave, value])

  const cancel = useCallback(() => {
    setDraft(monthSelect ? normalizeAnnualMonthForSelect(value) : value)
    onEditingFieldChange(null)
  }, [monthSelect, onEditingFieldChange, value])

  const commitRef = useRef(commit)
  const cancelRef = useRef(cancel)
  commitRef.current = commit
  cancelRef.current = cancel

  useLayoutEffect(() => {
    if (!editing) return undefined

    const input = inputRef.current
    try {
      input?.focus({ preventScroll: true })
    } catch {
      input?.focus()
    }

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
    setDraft(monthSelect ? normalizeAnnualMonthForSelect(value) : value)
    onEditingFieldChange(fieldKey)
  }

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
        <div className="pw-mock-field-label">{label}</div>
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
        {label}
      </label>
      <div className="pw-mock-field-value">
        {multiline ? (
          <textarea
            ref={inputRef as RefObject<HTMLTextAreaElement>}
            id={inputId}
            className="pw-mock-field-input"
            rows={4}
            value={draft}
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
