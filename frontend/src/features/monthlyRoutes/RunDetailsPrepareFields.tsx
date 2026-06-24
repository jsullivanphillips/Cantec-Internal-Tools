import { useCallback, useEffect, useState, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { Spinner, Form, OverlayTrigger, Tooltip } from 'react-bootstrap'
import MonitoringCompanySelect from './MonitoringCompanySelect'
import type { MonitoringCompanySummary } from './monthlyRoutesShared'
import { worksheetReadOnlyDisplay } from './officeWorksheetTableShared'
import RichTextDisplay from '../richText/RichTextDisplay'
import RichTextEditor, { type RichTextEditorHandle } from '../richText/RichTextEditor'
import RichTextToolbar from '../richText/RichTextToolbar'
import {
  normalizeRichTextComment,
  richTextIsEmpty,
  richTextValuesEqual,
} from '../richText/richTextSanitize'
import { PREP_READY_EDIT_LOCKED_MESSAGE } from './runWorkflowShared'

export type PrepLayoutVariant = 'legacy' | 'office'

function wrapPrepReadyLockedField(node: ReactNode, readyEditLocked: boolean, wrapId: string): ReactNode {
  if (!readyEditLocked) return node
  return (
    <OverlayTrigger
      trigger="click"
      rootClose
      overlay={
        <Tooltip id={`prep-ready-locked-${wrapId}`} className="run-details-prep-ready-locked-tooltip">
          {PREP_READY_EDIT_LOCKED_MESSAGE}
        </Tooltip>
      }
    >
      <span className="run-details-prep-ready-locked-wrap">{node}</span>
    </OverlayTrigger>
  )
}

function officeCompactFieldClassName({
  wide,
  stacked,
  empty,
  editable,
  editing,
}: {
  wide?: boolean
  stacked?: boolean
  empty?: boolean
  editable?: boolean
  editing?: boolean
}): string {
  return (
    [
      'tw-office-compact-field',
      wide ? 'tw-office-compact-field--wide' : '',
      stacked ? 'tw-office-compact-field--stacked' : '',
      empty ? 'tw-office-compact-field--empty' : '',
      editable ? 'run-details-prep-office-field--editable' : '',
      editing ? 'run-details-prep-office-field--editing' : '',
    ]
      .filter(Boolean)
      .join(' ') || 'tw-office-compact-field'
  )
}

function activateField(onActivate: (key: string | null) => void, fieldKey: string, disabled: boolean) {
  if (!disabled) onActivate(fieldKey)
}

/** Save draft when another cell is activated (single activeKey for the whole prep table). */
function useCommitDraftWhenEditingCloses(
  editing: boolean,
  draft: string,
  value: string,
  onCommit: (next: string) => void,
  setDraft: (next: string) => void,
) {
  const wasEditingRef = useRef(false)
  const skipCloseCommitRef = useRef(false)

  useEffect(() => {
    if (wasEditingRef.current && !editing) {
      if (!skipCloseCommitRef.current && draft !== value) {
        onCommit(draft)
      }
      skipCloseCommitRef.current = false
    }
    if (!editing) {
      setDraft(value)
    }
    wasEditingRef.current = editing
  }, [editing, draft, value, onCommit, setDraft])

  const markExplicitClose = useCallback(() => {
    skipCloseCommitRef.current = true
  }, [])

  return markExplicitClose
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

function PrepFieldLabel({
  label,
  saving,
  layoutVariant = 'legacy',
}: {
  label: string
  saving?: boolean
  layoutVariant?: PrepLayoutVariant
}) {
  if (layoutVariant === 'office') {
    return (
      <span className="tw-office-compact-label">
        {label}
        {saving ? (
          <Spinner
            animation="border"
            size="sm"
            className="run-details-prep-office-field-spinner ms-1"
            role="status"
            aria-label="Saving"
          />
        ) : null}
      </span>
    )
  }
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
  layoutVariant = 'legacy',
}: {
  onCancel: () => void
  onSave: () => void
  saving?: boolean
  layoutVariant?: PrepLayoutVariant
}) {
  const className =
    layoutVariant === 'office'
      ? 'run-details-prep-office-edit-actions'
      : 'run-details-prepare-edit-actions'
  const btnClass =
    layoutVariant === 'office' ? 'run-details-prep-office-edit-btn' : 'run-details-prepare-edit-btn'
  return (
    <div className={className}>
      <button type="button" className={btnClass} onClick={onCancel} disabled={saving}>
        Cancel
      </button>
      <button
        type="button"
        className={`${btnClass} ${layoutVariant === 'office' ? 'run-details-prep-office-edit-btn--primary' : 'run-details-prepare-edit-btn--primary'}`}
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
  disabled = false,
  saving,
  activeKey,
  onActivate,
  onCommit,
  multiline,
  hint,
  layoutVariant = 'legacy',
  wide,
  stacked,
  readyEditLocked = false,
}: {
  fieldKey: string
  label: string
  value: string
  disabled?: boolean
  saving?: boolean
  activeKey: string | null
  onActivate: (key: string | null) => void
  onCommit: (next: string) => void
  multiline?: boolean
  hint?: string
  layoutVariant?: PrepLayoutVariant
  wide?: boolean
  stacked?: boolean
  readyEditLocked?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const editing = activeKey === fieldKey
  const display = worksheetReadOnlyDisplay(value)
  const empty = display === '—'
  const fieldDisabled = disabled || readyEditLocked
  const [draft, setDraft] = useState(value)
  const markExplicitClose = useCommitDraftWhenEditingCloses(editing, draft, value, onCommit, setDraft)

  useEffect(() => {
    if (!editing) return
    const el = multiline ? textareaRef.current : inputRef.current
    el?.focus({ preventScroll: true })
  }, [editing, multiline])

  const cancel = useCallback(() => {
    markExplicitClose()
    setDraft(value)
    onActivate(null)
  }, [markExplicitClose, onActivate, value])

  const save = useCallback(() => {
    markExplicitClose()
    if (draft !== value) onCommit(draft)
    onActivate(null)
  }, [draft, markExplicitClose, onActivate, onCommit, value])

  if (!editing) {
    if (layoutVariant === 'office') {
      return wrapPrepReadyLockedField(
        <div
          className={officeCompactFieldClassName({
            wide: wide ?? stacked,
            stacked,
            empty,
            editable: !fieldDisabled,
          })}
          role={fieldDisabled ? undefined : 'button'}
          tabIndex={fieldDisabled ? undefined : 0}
          onClick={() => activateField(onActivate, fieldKey, fieldDisabled)}
          onKeyDown={(e) => fieldKeyDown(e, fieldDisabled, onActivate, fieldKey)}
        >
          <PrepFieldLabel label={label} saving={saving} layoutVariant={layoutVariant} />
          <span className="tw-office-compact-value">{display}</span>
          {hint ? <div className="run-details-prep-office-field-hint">{hint}</div> : null}
        </div>,
        readyEditLocked,
        fieldKey,
      )
    }
    return wrapPrepReadyLockedField(
      <div className="run-details-prepare-stack__field">
        <PrepFieldLabel label={label} saving={saving} layoutVariant={layoutVariant} />
        <div
          className={`run-details-prepare-display${
            multiline ? ' run-details-prepare-display--multiline' : ''
          }${empty ? ' run-details-prepare-display--empty' : ''}${
            fieldDisabled ? '' : ' run-details-prepare-display--editable'
          }`}
          role={fieldDisabled ? undefined : 'button'}
          tabIndex={fieldDisabled ? undefined : 0}
          onClick={() => activateField(onActivate, fieldKey, fieldDisabled)}
          onKeyDown={(e) => fieldKeyDown(e, fieldDisabled, onActivate, fieldKey)}
        >
          {display}
        </div>
        {hint ? <div className="run-details-prepare-field-hint">{hint}</div> : null}
      </div>,
      readyEditLocked,
      fieldKey,
    )
  }

  if (layoutVariant === 'office') {
    return (
      <div
        className={officeCompactFieldClassName({
          wide: wide ?? stacked ?? true,
          stacked,
          editing: true,
        })}
      >
        <PrepFieldLabel label={label} saving={saving} layoutVariant={layoutVariant} />
        {multiline ? (
          <textarea
            ref={textareaRef}
            className="run-details-prep-office-editor run-details-prep-office-editor--multiline form-control form-control-sm"
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
            className="run-details-prep-office-editor form-control form-control-sm"
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
        {hint ? <div className="run-details-prep-office-field-hint">{hint}</div> : null}
        <PrepEditActions onCancel={cancel} onSave={save} saving={saving} layoutVariant={layoutVariant} />
      </div>
    )
  }

  return (
    <div className="run-details-prepare-stack__field run-details-prepare-stack__field--editing">
      <PrepFieldLabel label={label} saving={saving} layoutVariant={layoutVariant} />
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
      <PrepEditActions onCancel={cancel} onSave={save} saving={saving} layoutVariant={layoutVariant} />
    </div>
  )
}

export function PrepLongTextCell({
  fieldKey,
  value,
  disabled = false,
  saving,
  activeKey,
  onActivate,
  onCommit,
  emptyPlaceholder,
  richText = false,
  layoutVariant = 'legacy',
  readyEditLocked = false,
}: {
  fieldKey: string
  value: string
  disabled?: boolean
  saving?: boolean
  activeKey: string | null
  onActivate: (key: string | null) => void
  onCommit: (next: string) => void
  /** When set, shown in read mode (and on the editor) instead of an em dash when empty. */
  emptyPlaceholder?: string
  richText?: boolean
  layoutVariant?: PrepLayoutVariant
  readyEditLocked?: boolean
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const richEditorRef = useRef<RichTextEditorHandle>(null)
  const [richEditorHandle, setRichEditorHandle] = useState<RichTextEditorHandle | null>(null)
  const editing = activeKey === fieldKey
  const trimmed = (value || '').trim()
  const empty = richText ? richTextIsEmpty(trimmed) : !trimmed
  const display = empty ? (emptyPlaceholder?.trim() || '—') : trimmed
  const fieldDisabled = disabled || readyEditLocked
  const [draft, setDraft] = useState(value)
  const markExplicitClose = useCommitDraftWhenEditingCloses(editing, draft, value, onCommit, setDraft)

  useEffect(() => {
    if (!editing || richText) return
    const el = textareaRef.current
    el?.focus({ preventScroll: true })
    if (el) {
      const len = el.value.length
      el.setSelectionRange(len, len)
    }
  }, [editing, richText])

  useEffect(() => {
    if (!editing || !richText) return
    richEditorRef.current?.focus()
    richEditorHandle?.focus()
  }, [editing, richText, richEditorHandle])

  const cancel = useCallback(() => {
    markExplicitClose()
    setDraft(value)
    onActivate(null)
  }, [markExplicitClose, onActivate, value])

  const save = useCallback(() => {
    markExplicitClose()
    const nextDraft = richText
      ? richEditorHandle?.getHtml() ?? richEditorRef.current?.getHtml() ?? draft
      : draft
    const changed = richText ? !richTextValuesEqual(nextDraft, value) : nextDraft !== value
    if (changed) onCommit(richText ? normalizeRichTextComment(nextDraft) ?? '' : nextDraft)
    onActivate(null)
  }, [draft, markExplicitClose, onActivate, onCommit, richText, value])

  if (!editing) {
    if (layoutVariant === 'office') {
      return wrapPrepReadyLockedField(
        <div
          className={`tw-office-detail-cell run-details-prep-office-longtext${fieldDisabled ? '' : ' run-details-prep-office-field--editable'}${saving ? ' run-details-prep-office-longtext--saving' : ''}`}
          role={fieldDisabled ? undefined : 'button'}
          tabIndex={fieldDisabled ? undefined : 0}
          onClick={() => activateField(onActivate, fieldKey, fieldDisabled)}
          onKeyDown={(e) => fieldKeyDown(e, fieldDisabled, onActivate, fieldKey)}
        >
          <div className={`tw-office-long-text${empty ? ' tw-office-compact-field--empty' : ''}`}>
            {richText ? (
              <RichTextDisplay value={value} emptyPlaceholder={emptyPlaceholder?.trim() || '—'} />
            ) : (
              display
            )}
          </div>
          {saving ? (
            <Spinner
              animation="border"
              size="sm"
              className="run-details-prep-office-field-spinner"
              role="status"
              aria-label="Saving"
            />
          ) : null}
        </div>,
        readyEditLocked,
        fieldKey,
      )
    }
    return wrapPrepReadyLockedField(
      <div
        className={`run-details-prepare-cell-surface${fieldDisabled ? '' : ' run-details-prepare-cell-surface--editable'}${saving ? ' run-details-prepare-cell-surface--saving' : ''}`}
        role={fieldDisabled ? undefined : 'button'}
        tabIndex={fieldDisabled ? undefined : 0}
        onClick={() => activateField(onActivate, fieldKey, fieldDisabled)}
        onKeyDown={(e) => fieldKeyDown(e, fieldDisabled, onActivate, fieldKey)}
      >
        <div className={`run-details-prepare-cell-view${empty ? ' run-details-prepare-cell-view--empty' : ''}`}>
          {richText ? (
            <RichTextDisplay value={value} emptyPlaceholder={emptyPlaceholder?.trim() || '—'} />
          ) : (
            display
          )}
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
      </div>,
      readyEditLocked,
      fieldKey,
    )
  }

  if (richText) {
    const editingClass =
      layoutVariant === 'office'
        ? 'run-details-prep-office-longtext run-details-prep-office-longtext--editing'
        : 'run-details-prepare-cell-surface run-details-prepare-cell-surface--editing'
    const toolbarClass =
      layoutVariant === 'office'
        ? 'run-details-prep-office-rich-toolbar'
        : 'run-details-prepare-rich-toolbar'
    const editorClass =
      layoutVariant === 'office'
        ? 'run-details-prep-office-cell-editor'
        : 'run-details-prepare-cell-editor'
    return (
      <div className={editingClass}>
        <RichTextToolbar editor={richEditorHandle} className={toolbarClass} />
        <RichTextEditor
          ref={richEditorRef}
          value={draft}
          placeholder={emptyPlaceholder}
          disabled={disabled || saving}
          className={editorClass}
          onHandleReady={setRichEditorHandle}
          onChange={setDraft}
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
        <PrepEditActions onCancel={cancel} onSave={save} saving={saving} layoutVariant={layoutVariant} />
      </div>
    )
  }

  if (layoutVariant === 'office') {
    return (
      <div className="run-details-prep-office-longtext run-details-prep-office-longtext--editing">
        <textarea
          ref={textareaRef}
          className="run-details-prep-office-cell-editor form-control form-control-sm"
          rows={3}
          value={draft}
          placeholder={emptyPlaceholder}
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
        <PrepEditActions onCancel={cancel} onSave={save} saving={saving} layoutVariant={layoutVariant} />
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
        placeholder={emptyPlaceholder}
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
      <PrepEditActions onCancel={cancel} onSave={save} saving={saving} layoutVariant={layoutVariant} />
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
  disabled = false,
  saving,
  activeKey,
  onActivate,
  onCommit,
  onCompanyCreated,
  layoutVariant = 'legacy',
  stacked,
  readyEditLocked = false,
}: {
  fieldKey: string
  label: string
  companyId: number | null
  companyName: string
  companies: MonitoringCompanySummary[]
  companiesLoading: boolean
  disabled?: boolean
  saving?: boolean
  activeKey: string | null
  onActivate: (key: string | null) => void
  onCommit: (nextId: number | null) => void
  onCompanyCreated: (company: MonitoringCompanySummary) => void
  layoutVariant?: PrepLayoutVariant
  stacked?: boolean
  readyEditLocked?: boolean
}) {
  const editing = activeKey === fieldKey
  const display = worksheetReadOnlyDisplay(companyName)
  const fieldDisabled = disabled || readyEditLocked
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
    if (layoutVariant === 'office') {
      return wrapPrepReadyLockedField(
        <div
          className={officeCompactFieldClassName({
            wide: true,
            stacked,
            empty: display === '—',
            editable: !fieldDisabled,
          })}
          role={fieldDisabled ? undefined : 'button'}
          tabIndex={fieldDisabled ? undefined : 0}
          onClick={() => activateField(onActivate, fieldKey, fieldDisabled)}
          onKeyDown={(e) => fieldKeyDown(e, fieldDisabled, onActivate, fieldKey)}
        >
          <PrepFieldLabel label={label} saving={saving} layoutVariant={layoutVariant} />
          <span className="tw-office-compact-value">{display}</span>
        </div>,
        readyEditLocked,
        fieldKey,
      )
    }
    return wrapPrepReadyLockedField(
      <PrepStackSlot label={label} saving={saving} layoutVariant={layoutVariant}>
        <div
          className={`run-details-prepare-display${
            display === '—' ? ' run-details-prepare-display--empty' : ''
          }${fieldDisabled ? '' : ' run-details-prepare-display--editable'}`}
          role={fieldDisabled ? undefined : 'button'}
          tabIndex={fieldDisabled ? undefined : 0}
          onClick={() => activateField(onActivate, fieldKey, fieldDisabled)}
          onKeyDown={(e) => fieldKeyDown(e, fieldDisabled, onActivate, fieldKey)}
        >
          {display}
        </div>
      </PrepStackSlot>,
      readyEditLocked,
      fieldKey,
    )
  }

  if (layoutVariant === 'office') {
    return (
      <div className={officeCompactFieldClassName({ wide: true, stacked, editing: true })}>
        <PrepFieldLabel label={label} saving={saving} layoutVariant={layoutVariant} />
        <MonitoringCompanySelect
          className="run-details-prep-office-editor"
          companies={companies}
          value={draftId}
          disabled={disabled || companiesLoading || saving}
          onChange={setDraftId}
          onCompanyCreated={(company) => {
            onCompanyCreated(company)
            setDraftId(company.id)
          }}
        />
        <PrepEditActions onCancel={cancel} onSave={save} saving={saving} layoutVariant={layoutVariant} />
      </div>
    )
  }

  return (
    <PrepStackSlot label={label} saving={saving} layoutVariant={layoutVariant}>
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
      <PrepEditActions onCancel={cancel} onSave={save} saving={saving} layoutVariant={layoutVariant} />
    </PrepStackSlot>
  )
}

export function PrepStackSlot({
  label,
  saving,
  children,
  layoutVariant = 'legacy',
}: {
  label: string
  saving?: boolean
  children: ReactNode
  layoutVariant?: PrepLayoutVariant
}) {
  return (
    <div className="run-details-prepare-stack__field">
      <PrepFieldLabel label={label} saving={saving} layoutVariant={layoutVariant} />
      <div className="run-details-prepare-stack__value">{children}</div>
    </div>
  )
}

export function PrepReadOnlyCompactField({
  label,
  value,
  wide,
  stacked,
}: {
  label: string
  value: string | null | undefined
  wide?: boolean
  stacked?: boolean
}) {
  const display = worksheetReadOnlyDisplay(value)
  const empty = display === '—'
  return (
    <div
      className={officeCompactFieldClassName({
        wide: wide ?? stacked,
        stacked,
        empty,
      })}
    >
      <span className="tw-office-compact-label">{label}</span>
      <span className="tw-office-compact-value">{display}</span>
    </div>
  )
}
