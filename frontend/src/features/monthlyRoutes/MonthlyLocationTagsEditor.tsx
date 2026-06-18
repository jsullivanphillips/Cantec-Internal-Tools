import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert } from 'react-bootstrap'
import { apiJson } from '../../lib/apiClient'
import {
  addMonthlyLocationTag,
  removeMonthlyLocationTag,
} from './monthlyLocationTagsShared'
import type { LibraryLocation } from './monthlyRoutesShared'

type Props = {
  location: LibraryLocation
  onLocationUpdated: (location: LibraryLocation) => void
}

export default function MonthlyLocationTagsEditor({ location, onLocationUpdated }: Props) {
  const [editing, setEditing] = useState(false)
  const [tags, setTags] = useState<string[]>(location.tags ?? [])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const tagsRef = useRef(tags)
  const persistVersionRef = useRef(0)

  tagsRef.current = tags

  useEffect(() => {
    setTags(location.tags ?? [])
  }, [location.id, location.tags])

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
    }
  }, [editing])

  const persistTags = useCallback(
    async (nextTags: string[]) => {
      const previous = tagsRef.current
      const version = ++persistVersionRef.current
      setError(null)
      setTags(nextTags)
      onLocationUpdated({ ...location, tags: nextTags })

      try {
        const res = await apiJson<{ location: LibraryLocation }>(
          `/api/monthly_routes/library/${location.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tags: nextTags }),
          },
        )
        if (version !== persistVersionRef.current) return
        onLocationUpdated(res.location)
        setTags(res.location.tags ?? nextTags)
      } catch {
        if (version !== persistVersionRef.current) return
        setTags(previous)
        onLocationUpdated({ ...location, tags: previous })
        setError('Unable to save tags.')
      }
    },
    [location, onLocationUpdated],
  )

  const addTag = useCallback(() => {
    const result = addMonthlyLocationTag(tags, draft)
    if (result.error) {
      setError(result.error)
      return
    }
    setDraft('')
    setError(null)
    if (result.tags.length !== tags.length) {
      void persistTags(result.tags)
    }
  }, [draft, persistTags, tags])

  const removeTag = useCallback(
    (tag: string) => {
      const next = removeMonthlyLocationTag(tags, tag)
      if (next.length === tags.length) return
      void persistTags(next)
    },
    [persistTags, tags],
  )

  const exitEdit = useCallback(() => {
    setEditing(false)
    setDraft('')
    setError(null)
  }, [])

  const editTagsButton = (
    <button
      type="button"
      className="monthly-location-detail-hero-tags__edit"
      onClick={() => setEditing(true)}
    >
      Edit tags
    </button>
  )

  return (
    <div className="monthly-location-detail-hero-tags">
      <div
        className={[
          'monthly-location-detail-hero-tags__row',
          tags.length > 0 ? 'monthly-location-detail-hero-tags__row--has-tags' : null,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {!editing && tags.length === 0 ? editTagsButton : null}
        <div className="monthly-location-detail-hero-tags__pills" role="list">
          {tags.map((tag) => (
            <span key={tag} className="monthly-location-tag-pill" role="listitem">
              {tag}
              {editing ? (
                <button
                  type="button"
                  className="monthly-location-detail-hero-tags__remove"
                  aria-label={`Remove tag ${tag}`}
                  onClick={() => removeTag(tag)}
                >
                  ×
                </button>
              ) : null}
            </span>
          ))}
          {editing ? (
            <span className="monthly-location-detail-hero-tags__compose">
              <input
                ref={inputRef}
                type="text"
                className="monthly-location-detail-hero-tags__input"
                value={draft}
                placeholder="Add tag"
                aria-label="Add tag"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addTag()
                  }
                }}
              />
              <button
                type="button"
                className="monthly-location-detail-hero-tags__done"
                onMouseDown={(e) => e.preventDefault()}
                onClick={exitEdit}
              >
                Done
              </button>
            </span>
          ) : null}
        </div>
        {!editing && tags.length > 0 ? editTagsButton : null}
      </div>
      {error ? (
        <Alert variant="danger" className="py-1 px-2 small mb-0 mt-2">
          {error}
        </Alert>
      ) : null}
    </div>
  )
}
