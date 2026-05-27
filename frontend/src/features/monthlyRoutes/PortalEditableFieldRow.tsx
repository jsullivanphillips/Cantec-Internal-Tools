import { useCallback, useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react'
import {
  ANNUAL_MONTH_SELECT_OPTIONS,
  normalizeAnnualMonthForSelect,
} from './monthlyRoutesShared'

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
    const legacy =
      normalizedValue && !ANNUAL_MONTH_SELECT_OPTIONS.includes(normalizedValue)
        ? [normalizedValue]
        : []
    return ['', ...legacy, ...ANNUAL_MONTH_SELECT_OPTIONS]
  }, [monthSelect, normalizedValue])

  useEffect(() => {
    if (!editing) setDraft(monthSelect ? normalizeAnnualMonthForSelect(value) : value)
  }, [value, editing, monthSelect])

  useEffect(() => {
    if (!editing) return undefined

    const input = inputRef.current
    try {
      input?.focus({ preventScroll: true })
    } catch {
      input?.focus()
    }

    const scrollFieldIntoView = () => {
      const row = rowRef.current
      const scroller = row?.closest<HTMLElement>('.pw-mock-fields')
      if (!row || !scroller) return

      const rowRect = row.getBoundingClientRect()
      const scrollerRect = scroller.getBoundingClientRect()
      const visualViewport = window.visualViewport
      const viewportTop = visualViewport?.offsetTop ?? 0
      const viewportBottom = viewportTop + (visualViewport?.height ?? window.innerHeight)
      const visibleTop = Math.max(scrollerRect.top, viewportTop) + 16
      const visibleBottom = Math.min(scrollerRect.bottom, viewportBottom) - 16

      if (rowRect.top < visibleTop) {
        scroller.scrollTop -= visibleTop - rowRect.top
      } else if (rowRect.bottom > visibleBottom) {
        scroller.scrollTop += rowRect.bottom - visibleBottom
      }
    }

    const firstScroll = window.setTimeout(scrollFieldIntoView, 80)
    const keyboardScroll = window.setTimeout(scrollFieldIntoView, 320)

    return () => {
      window.clearTimeout(firstScroll)
      window.clearTimeout(keyboardScroll)
    }
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

  useEffect(() => {
    if (!editing || !onEditActionsChange) return undefined
    onEditActionsChange({
      fieldKey,
      cancel: () => cancelRef.current(),
      save: () => commitRef.current(),
    })
    return () => onEditActionsChange(null)
  }, [editing, fieldKey, onEditActionsChange])

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
