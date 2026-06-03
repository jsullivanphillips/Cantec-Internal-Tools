import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'
import { Alert, Button, Form } from 'react-bootstrap'
import { apiJson } from '../../lib/apiClient'
import type { LibraryLocation } from './monthlyRoutesShared'

type MonthlyLocationBillingCommentsPanelProps = {
  locationId: number
  billingComments: string | null | undefined
  onSaved: (location: LibraryLocation) => void
}

export default function MonthlyLocationBillingCommentsPanel({
  locationId,
  billingComments,
  onSaved,
}: MonthlyLocationBillingCommentsPanelProps) {
  const storedText = billingComments?.trim() ?? ''
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [showComposer, setShowComposer] = useState(false)
  const [draft, setDraft] = useState(storedText)

  useEffect(() => {
    if (!isEditing && !showComposer) {
      setDraft(storedText)
    }
  }, [storedText, isEditing, showComposer])

  const patchBillingComments = async (value: string | null) => {
    setSaving(true)
    setSaveError(null)
    try {
      const res = await apiJson<{ location: LibraryLocation }>(
        `/api/monthly_sites/library/${locationId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ billing_comments: value }),
        }
      )
      onSaved(res.location)
      setIsEditing(false)
      setShowComposer(false)
    } catch (e) {
      const msg =
        typeof e === 'object' && e && 'error' in e ? String((e as { error: unknown }).error) : null
      setSaveError(msg || 'Unable to save billing comments.')
    } finally {
      setSaving(false)
    }
  }

  const beginEdit = () => {
    setSaveError(null)
    setShowComposer(false)
    setDraft(storedText)
    setIsEditing(true)
  }

  const cancelEdit = () => {
    setDraft(storedText)
    setIsEditing(false)
    setSaveError(null)
  }

  const saveEdit = async () => {
    const trimmed = draft.trim()
    if (!trimmed) {
      setSaveError('Billing comments cannot be empty. Use Clear to remove them.')
      return
    }
    await patchBillingComments(trimmed)
  }

  const clearComments = async () => {
    if (!storedText) return
    if (!window.confirm('Clear billing comments?')) return
    await patchBillingComments(null)
  }

  const submitComposer = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = draft.trim()
    if (!trimmed) {
      setSaveError('Enter billing comments.')
      return
    }
    await patchBillingComments(trimmed)
  }

  return (
    <>
      {saveError ? (
        <Alert variant="danger" className="py-2 small mb-3">
          {saveError}
        </Alert>
      ) : null}

      {!storedText && !showComposer && !isEditing ? (
        <div className="text-muted small mb-3">No billing comments yet.</div>
      ) : null}

      {storedText && !isEditing ? (
        <div className="monthly-location-comments-list">
          <div className="monthly-location-comments-entry">
            <div className="small text-muted mb-1">
              <span>Billing note</span>
              <span className="monthly-location-comments-actions">
                <span className="mx-2 text-muted">·</span>
                <button
                  type="button"
                  className="monthly-location-comments-meta-link"
                  disabled={saving || showComposer}
                  onClick={beginEdit}
                >
                  Edit
                </button>
                <span className="mx-1 text-muted">·</span>
                <button
                  type="button"
                  className="monthly-location-comments-meta-link"
                  disabled={saving || showComposer}
                  onClick={() => void clearComments()}
                >
                  Clear
                </button>
              </span>
            </div>
            <div className="text-body small" style={{ whiteSpace: 'pre-wrap' }}>
              {storedText}
            </div>
          </div>
        </div>
      ) : null}

      {isEditing ? (
        <div className="d-flex flex-column gap-2">
          <Form.Control
            as="textarea"
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={saving}
          />
          <div className="d-flex gap-2">
            <Button type="button" variant="primary" size="sm" disabled={saving} onClick={() => void saveEdit()}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button type="button" variant="outline-secondary" size="sm" disabled={saving} onClick={cancelEdit}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {showComposer ? (
        <Form onSubmit={submitComposer} className="mb-3">
          <Form.Group className="mb-2">
            <Form.Control
              as="textarea"
              rows={3}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={saving || isEditing}
              placeholder="Billing note shown on the Monthly Billing page under this address…"
            />
          </Form.Group>
          <div className="d-flex gap-2 flex-wrap">
            <Button type="submit" variant="primary" size="sm" disabled={saving || isEditing}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button
              type="button"
              variant="outline-secondary"
              size="sm"
              disabled={saving}
              onClick={() => {
                setShowComposer(false)
                setSaveError(null)
                setDraft(storedText)
              }}
            >
              Cancel
            </Button>
          </div>
        </Form>
      ) : null}

      {!showComposer && !isEditing && !storedText ? (
        <button
          type="button"
          className="monthly-location-comments-add-bar mt-4"
          disabled={saving}
          onClick={() => {
            setSaveError(null)
            setDraft('')
            setShowComposer(true)
          }}
        >
          + Add billing comment
        </button>
      ) : null}
    </>
  )
}
