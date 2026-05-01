import type { Dispatch, FormEvent, SetStateAction } from 'react'
import { useState } from 'react'
import { Alert, Button, Form } from 'react-bootstrap'
import { apiFetch } from '../../lib/apiClient'
import {
  formatMonthlyCommentTimestamp,
  monthlyCommentAuthorsMatch,
  monthlyCommentWasEdited,
  type MonthlyLocationComment,
} from './monthlyRoutesShared'

type Props = {
  commentsApiPrefix: string
  comments: MonthlyLocationComment[]
  setComments: Dispatch<SetStateAction<MonthlyLocationComment[]>>
  sessionUsername: string | null
  composerPlaceholder: string
}

export default function MonthlyLibraryCommentsPanel({
  commentsApiPrefix,
  comments,
  setComments,
  sessionUsername,
  composerPlaceholder,
}: Props) {
  const [commentBody, setCommentBody] = useState('')
  const [commentSaving, setCommentSaving] = useState(false)
  const [commentError, setCommentError] = useState<string | null>(null)
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null)
  const [editingCommentBody, setEditingCommentBody] = useState('')
  const [commentMutatingId, setCommentMutatingId] = useState<number | null>(null)
  const [commentRowError, setCommentRowError] = useState<string | null>(null)
  const [showAddCommentComposer, setShowAddCommentComposer] = useState(false)

  const addComment = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = commentBody.trim()
    if (!trimmed) {
      setCommentError('Enter a comment.')
      return
    }
    setCommentSaving(true)
    setCommentError(null)
    try {
      const res = await apiFetch(`${commentsApiPrefix}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ body: trimmed }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        setCommentError((payload as { error?: string }).error || 'Could not save comment.')
        return
      }
      const row = (payload as { comment?: MonthlyLocationComment }).comment
      if (row) setComments((prev) => [row, ...prev])
      setCommentBody('')
      setShowAddCommentComposer(false)
    } finally {
      setCommentSaving(false)
    }
  }

  const beginEditComment = (c: MonthlyLocationComment) => {
    setCommentRowError(null)
    setShowAddCommentComposer(false)
    setEditingCommentId(c.id)
    setEditingCommentBody(c.body)
  }

  const cancelEditComment = () => {
    setEditingCommentId(null)
    setEditingCommentBody('')
    setCommentRowError(null)
  }

  const saveCommentEdit = async () => {
    if (!editingCommentId) return
    const trimmed = editingCommentBody.trim()
    if (!trimmed) {
      setCommentRowError('Comment cannot be empty.')
      return
    }
    setCommentMutatingId(editingCommentId)
    setCommentRowError(null)
    try {
      const res = await apiFetch(`${commentsApiPrefix}/comments/${editingCommentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ body: trimmed }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        setCommentRowError((payload as { error?: string }).error || 'Could not update comment.')
        return
      }
      const updated = (payload as { comment?: MonthlyLocationComment }).comment
      if (updated) {
        setComments((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
      }
      cancelEditComment()
    } finally {
      setCommentMutatingId(null)
    }
  }

  const deleteComment = async (commentId: number) => {
    if (!window.confirm('Delete this comment?')) return
    setCommentMutatingId(commentId)
    setCommentRowError(null)
    try {
      const res = await apiFetch(`${commentsApiPrefix}/comments/${commentId}`, {
        method: 'DELETE',
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        setCommentRowError((payload as { error?: string }).error || 'Could not delete comment.')
        return
      }
      setComments((prev) => prev.filter((x) => x.id !== commentId))
      if (editingCommentId === commentId) cancelEditComment()
    } finally {
      setCommentMutatingId(null)
    }
  }

  return (
    <>
      {commentRowError ? (
        <Alert variant="danger" className="py-2 small mb-3">
          {commentRowError}
        </Alert>
      ) : null}

      {comments.length === 0 && !showAddCommentComposer ? (
        <div className="text-muted small mb-3">No comments yet.</div>
      ) : null}

      <div className="monthly-location-comments-list">
        {comments.map((c, index) => {
          const canModify = monthlyCommentAuthorsMatch(sessionUsername, c.author_username)
          const busy = commentMutatingId === c.id
          const isEditing = editingCommentId === c.id
          return (
            <div key={c.id}>
              {index > 0 ? <hr className="monthly-location-comments-divider my-4" /> : null}
              <div className="monthly-location-comments-entry">
                <div className="small text-muted mb-1">
                  <span>{c.author_username || 'Unknown'}</span>
                  <span className="mx-1">•</span>
                  <span title={c.created_at || undefined}>{formatMonthlyCommentTimestamp(c.created_at)}</span>
                  {monthlyCommentWasEdited(c) ? <span className="ms-1">(edited)</span> : null}
                  {canModify && !isEditing ? (
                    <span className="monthly-location-comments-actions">
                      <span className="mx-2 text-muted">·</span>
                      <button
                        type="button"
                        className="monthly-location-comments-meta-link"
                        disabled={busy || editingCommentId !== null}
                        onClick={() => beginEditComment(c)}
                      >
                        Edit
                      </button>
                      <span className="mx-1 text-muted">·</span>
                      <button
                        type="button"
                        className="monthly-location-comments-meta-link"
                        disabled={busy || editingCommentId !== null}
                        onClick={() => void deleteComment(c.id)}
                      >
                        Delete
                      </button>
                    </span>
                  ) : null}
                </div>
                {isEditing ? (
                  <div className="d-flex flex-column gap-2 mt-2">
                    <Form.Control
                      as="textarea"
                      rows={3}
                      value={editingCommentBody}
                      onChange={(e) => setEditingCommentBody(e.target.value)}
                      disabled={busy}
                    />
                    <div className="d-flex gap-2">
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        disabled={busy}
                        onClick={() => void saveCommentEdit()}
                      >
                        {busy ? 'Saving…' : 'Save'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline-secondary"
                        size="sm"
                        disabled={busy}
                        onClick={cancelEditComment}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="text-body small" style={{ whiteSpace: 'pre-wrap' }}>
                    {c.body}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {showAddCommentComposer ? (
        <Form onSubmit={addComment} className="mt-4 mb-3">
          {commentError ? (
            <Alert variant="danger" className="py-2 small">
              {commentError}
            </Alert>
          ) : null}
          <Form.Group className="mb-2">
            <Form.Control
              as="textarea"
              rows={3}
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              disabled={commentSaving || editingCommentId !== null}
              placeholder={composerPlaceholder}
            />
          </Form.Group>
          <div className="d-flex gap-2 flex-wrap">
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={commentSaving || editingCommentId !== null}
            >
              {commentSaving ? 'Posting…' : 'Post'}
            </Button>
            <Button
              type="button"
              variant="outline-secondary"
              size="sm"
              disabled={commentSaving}
              onClick={() => {
                setShowAddCommentComposer(false)
                setCommentError(null)
                setCommentBody('')
              }}
            >
              Cancel
            </Button>
          </div>
        </Form>
      ) : null}

      {!showAddCommentComposer ? (
        <button
          type="button"
          className="monthly-location-comments-add-bar mt-4"
          disabled={commentSaving || editingCommentId !== null}
          onClick={() => {
            setCommentError(null)
            setShowAddCommentComposer(true)
          }}
        >
          + Add comment
        </button>
      ) : null}
    </>
  )
}
