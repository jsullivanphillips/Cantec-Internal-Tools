import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Form, Spinner } from 'react-bootstrap'
import { apiJson } from '../../lib/apiClient'
import { portalFieldEditActionPointerGuard } from './portalFieldEditRegistry'
import type { LibraryLocation } from './monthlyRoutesShared'

type BillingBoardCommentCellProps = {
  locationId: number
  billingComments: string | null | undefined
  isEditing: boolean
  onBeginEdit: () => void
  onEndEdit: () => void
  onSaved: (billingComments: string | null) => void
}

function BillingCommentEditActions({
  saving,
  onCancel,
  onSave,
}: {
  saving: boolean
  onCancel: () => void
  onSave: () => void
}) {
  return (
    <div className="pw-mock-field-edit-actions">
      <button
        type="button"
        className="pw-mock-field-edit-btn"
        onPointerDown={portalFieldEditActionPointerGuard}
        onMouseDown={portalFieldEditActionPointerGuard}
        onClick={onCancel}
        disabled={saving}
      >
        Cancel
      </button>
      <button
        type="button"
        className="pw-mock-field-edit-btn pw-mock-field-edit-btn--primary"
        onPointerDown={portalFieldEditActionPointerGuard}
        onMouseDown={portalFieldEditActionPointerGuard}
        onClick={onSave}
        disabled={saving}
        aria-busy={saving}
      >
        {saving ? (
          <span className="pw-mock-field-edit-btn-content">
            <Spinner animation="border" size="sm" variant="light" role="status" aria-hidden="true" />
            <span>Saving…</span>
          </span>
        ) : (
          'Save'
        )}
      </button>
    </div>
  )
}

export default function BillingBoardCommentCell({
  locationId,
  billingComments,
  isEditing,
  onBeginEdit,
  onEndEdit,
  onSaved,
}: BillingBoardCommentCellProps) {
  const storedText = billingComments?.trim() ?? ''
  const [draft, setDraft] = useState(storedText)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!isEditing) {
      setDraft(storedText)
      setError(null)
    }
  }, [storedText, isEditing])

  useEffect(() => {
    if (!isEditing) return
    textareaRef.current?.focus({ preventScroll: true })
  }, [isEditing])

  const cancel = () => {
    setDraft(storedText)
    setError(null)
    onEndEdit()
  }

  const save = async () => {
    const trimmed = draft.trim()
    const nextValue = trimmed || null
    const currentValue = storedText || null
    if (nextValue === currentValue) {
      onEndEdit()
      return
    }

    setSaving(true)
    setError(null)
    try {
      const res = await apiJson<{ location: LibraryLocation }>(
        `/api/monthly_routes/library/${locationId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ billing_comments: nextValue }),
        },
      )
      onSaved(res.location.billing_comments ?? null)
      onEndEdit()
    } catch (e) {
      const msg =
        typeof e === 'object' && e && 'error' in e ? String((e as { error: unknown }).error) : null
      setError(msg || 'Unable to save billing comment.')
    } finally {
      setSaving(false)
    }
  }

  const beginEdit = () => {
    setDraft(storedText)
    setError(null)
    onBeginEdit()
  }

  const handleDisplayKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      event.stopPropagation()
      beginEdit()
    }
  }

  if (!isEditing) {
    return (
      <div
        className="monthly-billing-comment-cell__display small text-muted text-break"
        role="button"
        tabIndex={0}
        aria-label={storedText ? 'Edit billing comment' : 'Add billing comment'}
        onClick={(event) => {
          event.stopPropagation()
          beginEdit()
        }}
        onKeyDown={handleDisplayKeyDown}
      >
        {storedText || '—'}
      </div>
    )
  }

  return (
    <div
      className="monthly-billing-comment-cell monthly-billing-comment-cell--editing"
      onClick={(event) => event.stopPropagation()}
    >
      <Form.Control
        as="textarea"
        ref={textareaRef}
        rows={3}
        value={draft}
        disabled={saving}
        className="monthly-billing-comment-cell__input form-control-sm"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            cancel()
          }
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            void save()
          }
        }}
      />
      {error ? <div className="text-danger small mt-1">{error}</div> : null}
      <BillingCommentEditActions
        saving={saving}
        onCancel={cancel}
        onSave={() => {
          void save()
        }}
      />
    </div>
  )
}
