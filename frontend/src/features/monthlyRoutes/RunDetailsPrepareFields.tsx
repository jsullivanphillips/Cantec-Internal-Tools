import {
  useCallback,
  useEffect,
  useState,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { Spinner } from 'react-bootstrap'
import MonitoringCompanySelect from './MonitoringCompanySelect'
import type { MonitoringCompanySummary } from './monthlyRoutesShared'
import { worksheetReadOnlyDisplay } from './officeWorksheetTableShared'

function activateField(onActivate: (key: string | null) => void, fieldKey: string, disabled: boolean) {
  if (!disabled) onActivate(fieldKey)
}

function fieldKeyDown(
  e: KeyboardEvent<HTMLElement>,
  disabled: boolean,
  onActivate: (key: string | null) => void,
  fieldKey: string,
) {
  if (disabled) return
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    onActivate(fieldKey)
  }
}

function PrepFieldLabel({ label, saving }: { label: string; saving?: boolean }) {
  return (
    <div className="run-details-prepare-stack__label">
      {label}
      {saving ? (
        <Spinner
          animation="border"
          size="sm"
          className="run-details-prepare-field-spinner ms-1"
          role="status"
          aria-label="Saving"
        />
      ) : null}
    </div>
  )
}

function PrepEditActions({
  onCancel,
  onSave,
  saving,
}: {
  onCancel: () => void
  onSave: () => void
  saving?: boolean
}) {
  return (
    <div className="run-details-prepare-edit-actions">
      <button type="button" className="run-details-prepare-edit-btn" onClick={onCancel} disabled={saving}>
        Cancel
      </button>
      <button
        type="button"
        className="run-details-prepare-edit-btn run-details-prepare-edit-btn--primary"
        onClick={onSave}
        disabled={saving}
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}

export function PrepCompactField({
  fieldKey,
  label,
  value,
  disabled,
  saving,
  activeKey,
  onActivate,
  onCommit,
  multiline,
  hint,
}: {
  fieldKey: string
  label: string
  value: string
  disabled: boolean
  saving?: boolean
  activeKey: string | null
  onActivate: (key: string | null) => void
  onCommit: (next: string) => void
  multiline?: boolean
  hint?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const editing = activeKey === fieldKey
  const display = worksheetReadOnlyDisplay(value)
  const empty = display === '—'
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  useEffect(() => {
    if (!editing) return
    const el = multiline ? textareaRef.current : inputRef.current
    el?.focus({ preventScroll: true })
  }, [editing, multiline])

  const cancel = useCallback(() => {
    setDraft(value)
    onActivate(null)
  }, [onActivate, value])

  const save = useCallback(() => {
    if (draft !== value) onCommit(draft)
    onActivate(null)
  }, [draft, onActivate, onCommit, value])

  if (!editing) {
    return (
      <div className="run-details-prepare-stack__field">
        <PrepFieldLabel label={label} saving={saving} />
        <div
          className={`run-details-prepare-display${
            multiline ? ' run-details-prepare-display--multiline' : ''
          }${empty ? ' run-details-prepare-display--empty' : ''}${
            disabled ? '' : ' run-details-prepare-display--editable'
          }`}
          role={disabled ? undefined : 'button'}
          tabIndex={disabled ? undefined : 0}
          onClick={() => activateField(onActivate, fieldKey, disabled)}
          onKeyDown={(e) => fieldKeyDown(e, disabled, onActivate, fieldKey)}
        >
          {display}
        </div>
        {hint ? <div className="run-details-prepare-field-hint">{hint}</div> : null}
      </div>
    )
  }

  return (
    <div className="run-details-prepare-stack__field run-details-prepare-stack__field--editing">
      <PrepFieldLabel label={label} saving={saving} />
      {multiline ? (
        <textarea
          ref={textareaRef}
          className="run-details-prepare-editor run-details-prepare-editor--multiline form-control form-control-sm"
          rows={2}
          value={draft}
          disabled={disabled || saving}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              cancel()
            }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              save()
            }
          }}
        />
      ) : (
        <input
          ref={inputRef}
          type="text"
          className="run-details-prepare-editor form-control form-control-sm"
          value={draft}
          disabled={disabled || saving}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              save()
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              cancel()
            }
          }}
        />
      )}
      {hint ? <div className="run-details-prepare-field-hint">{hint}</div> : null}
      <PrepEditActions onCancel={cancel} onSave={save} saving={saving} />
    </div>
  )
}

export function PrepLongTextCell({
  fieldKey,
  value,
  disabled,
  saving,
  activeKey,
  onActivate,
  onCommit,
}: {
  fieldKey: string
  value: string
  disabled: boolean
  saving?: boolean
  activeKey: string | null
  onActivate: (key: string | null) => void
  onCommit: (next: string) => void
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const editing = activeKey === fieldKey
  const trimmed = (value || '').trim()
  const display = trimmed || '—'
  const empty = !trimmed
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  useEffect(() => {
    if (!editing) return
    const el = textareaRef.current
    el?.focus({ preventScroll: true })
    if (el) {
      const len = el.value.length
      el.setSelectionRange(len, len)
    }
  }, [editing])

  const cancel = useCallback(() => {
    setDraft(value)
    onActivate(null)
  }, [onActivate, value])

  const save = useCallback(() => {
    if (draft !== value) onCommit(draft)
    onActivate(null)
  }, [draft, onActivate, onCommit, value])

  if (!editing) {
    return (
      <div
        className={`run-details-prepare-cell-surface${disabled ? '' : ' run-details-prepare-cell-surface--editable'}${saving ? ' run-details-prepare-cell-surface--saving' : ''}`}
        role={disabled ? undefined : 'button'}
        tabIndex={disabled ? undefined : 0}
        onClick={() => activateField(onActivate, fieldKey, disabled)}
        onKeyDown={(e) => fieldKeyDown(e, disabled, onActivate, fieldKey)}
      >
        <div className={`run-details-prepare-cell-view${empty ? ' run-details-prepare-cell-view--empty' : ''}`}>
          {display}
        </div>
        {saving ? (
          <Spinner
            animation="border"
            size="sm"
            className="run-details-prepare-field-spinner run-details-prepare-cell-spinner"
            role="status"
            aria-label="Saving"
          />
        ) : null}
      </div>
    )
  }

  return (
    <div className="run-details-prepare-cell-surface run-details-prepare-cell-surface--editing">
      <textarea
        ref={textareaRef}
        className="run-details-prepare-cell-editor form-control form-control-sm"
        rows={3}
        value={draft}
        disabled={disabled || saving}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            cancel()
          }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            save()
          }
        }}
      />
      <PrepEditActions onCancel={cancel} onSave={save} saving={saving} />
    </div>
  )
}

export function PrepCompanyField({
  fieldKey,
  label,
  companyId,
  companyName,
  companies,
  companiesLoading,
  disabled,
  saving,
  activeKey,
  onActivate,
  onCommit,
  onCompanyCreated,
}: {
  fieldKey: string
  label: string
  companyId: number | null
  companyName: string
  companies: MonitoringCompanySummary[]
  companiesLoading: boolean
  disabled: boolean
  saving?: boolean
  activeKey: string | null
  onActivate: (key: string | null) => void
  onCommit: (nextId: number | null) => void
  onCompanyCreated: (company: MonitoringCompanySummary) => void
}) {
  const editing = activeKey === fieldKey
  const display = worksheetReadOnlyDisplay(companyName)
  const [draftId, setDraftId] = useState<number | null>(companyId)

  useEffect(() => {
    if (!editing) setDraftId(companyId)
  }, [companyId, editing])

  const cancel = useCallback(() => {
    setDraftId(companyId)
    onActivate(null)
  }, [companyId, onActivate])

  const save = useCallback(() => {
    if (draftId !== companyId) onCommit(draftId)
    onActivate(null)
  }, [companyId, draftId, onActivate, onCommit])

  if (!editing) {
    return (
      <PrepStackSlot label={label} saving={saving}>
        <div
          className={`run-details-prepare-display${
            display === '—' ? ' run-details-prepare-display--empty' : ''
          }${disabled ? '' : ' run-details-prepare-display--editable'}`}
          role={disabled ? undefined : 'button'}
          tabIndex={disabled ? undefined : 0}
          onClick={() => {
            if (!disabled) onActivate(fieldKey)
          }}
          onKeyDown={(e) => {
            if (disabled) return
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onActivate(fieldKey)
            }
          }}
        >
          {display}
        </div>
      </PrepStackSlot>
    )
  }

  return (
    <PrepStackSlot label={label} saving={saving}>
      <MonitoringCompanySelect
        className="run-details-prepare-editor"
        companies={companies}
        value={draftId}
        disabled={disabled || companiesLoading || saving}
        onChange={setDraftId}
        onCompanyCreated={(company) => {
          onCompanyCreated(company)
          setDraftId(company.id)
        }}
      />
      <PrepEditActions onCancel={cancel} onSave={save} saving={saving} />
    </PrepStackSlot>
  )
}

export function PrepStackSlot({
  label,
  saving,
  children,
}: {
  label: string
  saving?: boolean
  children: ReactNode
}) {
  return (
    <div className="run-details-prepare-stack__field">
      <PrepFieldLabel label={label} saving={saving} />
      <div className="run-details-prepare-stack__value">{children}</div>
    </div>
  )
}
