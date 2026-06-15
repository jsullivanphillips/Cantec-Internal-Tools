import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { annualMonthSelectChoiceValues, normalizeAnnualMonthForSelect } from './monthlyRoutesShared'
import PortalFieldEditActionButtons from './PortalFieldEditActionButtons'
import {
  createPortalFieldEditBlurHandler,
  schedulePortalFieldRowScroll,
} from './portalFieldEditRegistry'
import RichTextDisplay from '../richText/RichTextDisplay'
import RichTextEditor, { type RichTextEditorHandle } from '../richText/RichTextEditor'
import RichTextToolbar from '../richText/RichTextToolbar'
import { isRichTextField } from '../richText/richTextFields'
import {
  normalizeRichTextComment,
  richTextIsEmpty,
  richTextValuesEqual,
} from '../richText/richTextSanitize'

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
  /** Portal worksheet uses a header toolbar instead of inline formatting controls. */
  richTextToolbarPlacement?: 'inline' | 'external'
  onRichTextEditorHandleChange?: (handle: RichTextEditorHandle | null) => void
  /** When true, show Cancel/Submit under the field even for rich-text editors. */
  inlineEditActions?: boolean
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
  richTextToolbarPlacement = 'inline',
  onRichTextEditorHandleChange,
  inlineEditActions,
}: PortalEditableFieldRowProps) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null)
  const richEditorRef = useRef<RichTextEditorHandle>(null)
  const [richEditorHandle, setRichEditorHandle] = useState<RichTextEditorHandle | null>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const normalizedValue = monthSelect ? normalizeAnnualMonthForSelect(value) : value.trim()
  const [draft, setDraft] = useState(normalizedValue)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const editing = !readOnly && editingField === fieldKey
  const richText = Boolean(multiline && isRichTextField(fieldKey))
  const showInlineRichToolbar = richText && richTextToolbarPlacement === 'inline'
  const showEditActionButtons = inlineEditActions ?? !richText
  const displayEmpty = richText ? richTextIsEmpty(value) : !value.trim()
  const display = monthSelect ? normalizedValue || '—' : displayEmpty ? '—' : value.trim()

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
      if (richText) {
        setRichEditorHandle(null)
        onRichTextEditorHandleChange?.(null)
      }
    }
  }, [value, editing, monthSelect, richText, onRichTextEditorHandleChange])

  useLayoutEffect(() => {
    if (!editing) return undefined
    return schedulePortalFieldRowScroll(rowRef)
  }, [editing])

  const commit = useCallback(async () => {
    if (saving) return
    const nextRaw = richText
      ? richEditorHandle?.getHtml() ?? richEditorRef.current?.getHtml() ?? draft
      : draft.trim()
    const next = richText ? normalizeRichTextComment(nextRaw) ?? '' : nextRaw
    const committed = richText
      ? normalizeRichTextComment(value) ?? ''
      : monthSelect
        ? normalizeAnnualMonthForSelect(value)
        : value.trim()
    const unchanged = richText ? richTextValuesEqual(next, committed) : next === committed
    if (unchanged) {
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
  }, [
    draft,
    monthSelect,
    onEditingFieldChange,
    onSave,
    richEditorHandle,
    richText,
    saving,
    value,
  ])

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

  const handleRichEditorReady = useCallback(
    (handle: RichTextEditorHandle | null) => {
      setRichEditorHandle(handle)
      if (richTextToolbarPlacement === 'external') {
        onRichTextEditorHandleChange?.(handle)
      }
    },
    [onRichTextEditorHandleChange, richTextToolbarPlacement],
  )

  useLayoutEffect(() => {
    if (!editing || richText) return undefined

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
  }, [editing, monthSelect, autoOpenSelect, richText])

  useLayoutEffect(() => {
    if (!editing || !richText) return undefined
    richEditorHandle?.focus()
    return undefined
  }, [editing, richText, richEditorHandle])

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
        <div className="pw-mock-field-value">
          {richText ? <RichTextDisplay value={value} /> : display}
        </div>
      </div>
    )
  }

  return (
    <div
      ref={rowRef}
      className={`pw-mock-field-row pw-mock-field-row--editing${
        multiline ? ' pw-mock-field-row--multiline' : ''
      }${richText ? ' pw-mock-field-row--rich-text' : ''}`}
    >
      <label className="pw-mock-field-label" htmlFor={inputId}>
        {labelBlock}
      </label>
      <div className="pw-mock-field-value" onBlur={richText ? undefined : handleEditBlur}>
        {richText ? (
          <>
            {showInlineRichToolbar ? (
              <RichTextToolbar
                editor={richEditorHandle}
                className="pw-mock-field-rich-toolbar"
              />
            ) : null}
            <RichTextEditor
              ref={richEditorRef}
              id={inputId}
              value={draft}
              disabled={saving}
              className="pw-mock-field-input pw-mock-field-input--rich"
              onHandleReady={handleRichEditorReady}
              onChange={setDraft}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault()
                  cancel()
                }
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  void commit()
                }
              }}
            />
          </>
        ) : multiline ? (
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
        {showEditActionButtons ? (
          <PortalFieldEditActionButtons
            saving={saving}
            onCancel={cancel}
            onSubmit={() => void commit()}
          />
        ) : null}
      </div>
    </div>
  )
}
