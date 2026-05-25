import { useEffect, useId, useRef, useState, type RefObject } from 'react'

type PortalEditableFieldRowProps = {
  fieldKey: string
  label: string
  value: string
  multiline?: boolean
  readOnly?: boolean
  editingField: string | null
  onEditingFieldChange: (key: string | null) => void
  onSave: (next: string) => void
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
}: PortalEditableFieldRowProps) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)
  const [draft, setDraft] = useState(value)
  const editing = !readOnly && editingField === fieldKey
  const display = value.trim() || '—'

  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const commit = () => {
    const next = draft.trim()
    if (next !== value.trim()) onSave(next)
    onEditingFieldChange(null)
  }

  const cancel = () => {
    setDraft(value)
    onEditingFieldChange(null)
  }

  const startEdit = () => {
    if (readOnly) return
    setDraft(value)
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
