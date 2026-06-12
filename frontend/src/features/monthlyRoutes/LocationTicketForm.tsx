import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Form } from 'react-bootstrap'
import TicketStatusStepper from './TicketStatusStepper'
import {
  addTagToList,
  removeTagFromList,
  type CreateLocationTicketInput,
} from './locationTicketsShared'

type Props = {
  initial?: Partial<CreateLocationTicketInput>
  submitLabel?: string
  busy?: boolean
  onSubmit: (input: CreateLocationTicketInput) => void | Promise<void>
  onCancel?: () => void
}

export default function LocationTicketForm({
  initial,
  submitLabel = 'Create ticket',
  busy = false,
  onSubmit,
  onCancel,
}: Props) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [tags, setTags] = useState<string[]>(initial?.tags ?? [])
  const [tagDraft, setTagDraft] = useState('')
  const [tagError, setTagError] = useState<string | null>(null)
  const [tagInputOpen, setTagInputOpen] = useState(false)
  const tagInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (tagInputOpen) tagInputRef.current?.focus()
  }, [tagInputOpen])

  const commitTag = () => {
    const result = addTagToList(tags, tagDraft)
    setTags(result.tags)
    setTagError(result.error)
    if (!result.error) {
      setTagDraft('')
      setTagInputOpen(false)
    }
  }

  const handleSubmit = () => {
    const trimmed = title.trim()
    if (!trimmed) return
    void onSubmit({
      title: trimmed,
      description: description.trim() || null,
      tags,
    })
  }

  return (
    <div className="location-ticket-form">
      {tagError ? (
        <Alert variant="warning" className="py-2 small">
          {tagError}
        </Alert>
      ) : null}

      <Form.Group className="location-ticket-form__group">
        <Form.Label className="location-ticket-form__label">Title</Form.Label>
        <Form.Control
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Update monitoring account number"
        />
      </Form.Group>

      <Form.Group className="location-ticket-form__group">
        <Form.Label className="location-ticket-form__label">Tags</Form.Label>
        <div className="location-ticket-tags">
          {tags.map((tag) => (
            <span key={tag} className="location-ticket-tags__pill">
              {tag}
              <button
                type="button"
                className="location-ticket-tags__remove"
                aria-label={`Remove tag ${tag}`}
                onClick={() => setTags(removeTagFromList(tags, tag))}
              >
                ×
              </button>
            </span>
          ))}
          {tagInputOpen ? (
            <input
              ref={tagInputRef}
              type="text"
              className="location-ticket-tags__input"
              value={tagDraft}
              placeholder="Tag name"
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commitTag()
                } else if (e.key === 'Escape') {
                  setTagDraft('')
                  setTagInputOpen(false)
                }
              }}
              onBlur={() => {
                if (tagDraft.trim()) {
                  commitTag()
                } else {
                  setTagInputOpen(false)
                }
              }}
            />
          ) : (
            <button
              type="button"
              className="location-ticket-tags__add"
              aria-label="Add tag"
              onClick={() => setTagInputOpen(true)}
            >
              +
            </button>
          )}
        </div>
      </Form.Group>

      <TicketStatusStepper status="open" className="location-ticket-form__status" />

      <Form.Group className="location-ticket-form__group">
        <Form.Label className="location-ticket-form__label">Description</Form.Label>
        <Form.Control
          as="textarea"
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What needs to happen and any context from the field or customer."
        />
      </Form.Group>

      <Button
        variant="outline-primary"
        type="button"
        className="location-ticket-form__submit w-100"
        disabled={busy || !title.trim()}
        onClick={handleSubmit}
      >
        {busy ? 'Saving…' : submitLabel}
      </Button>

      {onCancel ? (
        <Button
          variant="link"
          size="sm"
          type="button"
          className="location-ticket-form__cancel w-100 mt-2"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </Button>
      ) : null}
    </div>
  )
}
