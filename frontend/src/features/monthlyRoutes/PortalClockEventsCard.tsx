import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { PortalClockEvent } from './portalWorkflowShared'
import type { TechnicianWorksheetLocation } from './monthlyRoutesShared'
import {
  normalizePortalClockTimeInput,
  PORTAL_CLOCK_TIME_HINT,
  PORTAL_CLOCK_TIME_INVALID_MESSAGE,
} from './visitClockTimes'

type ClockField = 'time_in' | 'time_out'

type EditTarget = {
  eventId: number
  field: ClockField
} | null

type Props = {
  stop: TechnicianWorksheetLocation
  readOnly?: boolean
  onUpdateClockEvent?: (
    eventId: number,
    patch: { time_in?: string; time_out?: string | null },
  ) => void | Promise<void>
}

function editKey(eventId: number, field: ClockField): string {
  return `${eventId}:${field}`
}

function displayTimeOut(ev: PortalClockEvent): string {
  return ev.time_out?.trim() ? ev.time_out : 'Open'
}

export default function PortalClockEventsCard({
  stop,
  readOnly = false,
  onUpdateClockEvent,
}: Props) {
  const events = stop.clock_events ?? []
  const [editing, setEditing] = useState<EditTarget>(null)
  const [draft, setDraft] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useId()

  useEffect(() => {
    if (!editing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing])

  const startEdit = useCallback(
    (ev: PortalClockEvent, field: ClockField) => {
      if (readOnly || !onUpdateClockEvent) return
      setValidationError(null)
      setEditing({ eventId: ev.id, field })
      if (field === 'time_in') {
        setDraft(ev.time_in.trim())
        return
      }
      setDraft(ev.time_out?.trim() ?? '')
    },
    [onUpdateClockEvent, readOnly],
  )

  const cancelEdit = useCallback(() => {
    setEditing(null)
    setDraft('')
    setValidationError(null)
  }, [])

  const commitEdit = useCallback(
    (ev: PortalClockEvent) => {
      if (!editing || editing.eventId !== ev.id || !onUpdateClockEvent) return
      const next = draft.trim()
      if (!next) {
        cancelEdit()
        return
      }

      const normalized = normalizePortalClockTimeInput(next)
      if (!normalized) {
        setValidationError(PORTAL_CLOCK_TIME_INVALID_MESSAGE)
        return
      }

      if (editing.field === 'time_in') {
        if (normalized === ev.time_in.trim()) {
          cancelEdit()
          return
        }
        void onUpdateClockEvent(ev.id, { time_in: normalized })
        cancelEdit()
        return
      }

      const currentOut = ev.time_out?.trim() ?? ''
      if (normalized === currentOut) {
        cancelEdit()
        return
      }
      void onUpdateClockEvent(ev.id, { time_out: normalized })
      cancelEdit()
    },
    [cancelEdit, draft, editing, onUpdateClockEvent],
  )

  if (events.length === 0) return null

  const editable = !readOnly && Boolean(onUpdateClockEvent)

  return (
    <div className="pw-mock-field-group pw-portal-clock-card">
      <div className="pw-mock-field-group-title">Clock events</div>
      <div className="pw-portal-section-body">
        <ul className="list-unstyled mb-0 pw-portal-clock-list">
          {events.map((ev) => {
            const editingIn = editing?.eventId === ev.id && editing.field === 'time_in'
            const editingOut = editing?.eventId === ev.id && editing.field === 'time_out'
            const openOut = !ev.time_out?.trim()

            return (
              <li key={ev.id} className="pw-portal-clock-row">
                {editingIn ? (
                  <div className="pw-portal-clock-edit-wrap">
                    <input
                      ref={inputRef}
                      id={`${inputId}-${editKey(ev.id, 'time_in')}`}
                      className={`pw-portal-clock-input${validationError ? ' pw-portal-clock-input--invalid' : ''}`}
                      value={draft}
                      placeholder={PORTAL_CLOCK_TIME_HINT}
                      aria-label="Clock in time"
                      aria-invalid={validationError ? true : undefined}
                      aria-describedby={
                        validationError ? `${inputId}-${editKey(ev.id, 'time_in')}-error` : undefined
                      }
                      onChange={(e) => {
                        setDraft(e.target.value)
                        setValidationError(null)
                      }}
                      onBlur={() => commitEdit(ev)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          commitEdit(ev)
                        }
                        if (e.key === 'Escape') {
                          e.preventDefault()
                          cancelEdit()
                        }
                      }}
                    />
                    {validationError ? (
                      <div
                        id={`${inputId}-${editKey(ev.id, 'time_in')}-error`}
                        className="pw-portal-clock-input-error"
                        role="alert"
                      >
                        {validationError}
                      </div>
                    ) : null}
                  </div>
                ) : editable ? (
                  <button
                    type="button"
                    className="pw-portal-clock-editable pw-portal-clock-in"
                    onClick={() => startEdit(ev, 'time_in')}
                  >
                    {ev.time_in}
                  </button>
                ) : (
                  <span className="pw-portal-clock-in">{ev.time_in}</span>
                )}

                <span className="pw-portal-clock-arrow" aria-hidden>
                  →
                </span>

                {editingOut ? (
                  <div className="pw-portal-clock-edit-wrap">
                    <input
                      ref={inputRef}
                      id={`${inputId}-${editKey(ev.id, 'time_out')}`}
                      className={`pw-portal-clock-input${validationError ? ' pw-portal-clock-input--invalid' : ''}`}
                      value={draft}
                      placeholder={PORTAL_CLOCK_TIME_HINT}
                      aria-label="Clock out time"
                      aria-invalid={validationError ? true : undefined}
                      aria-describedby={
                        validationError ? `${inputId}-${editKey(ev.id, 'time_out')}-error` : undefined
                      }
                      onChange={(e) => {
                        setDraft(e.target.value)
                        setValidationError(null)
                      }}
                      onBlur={() => commitEdit(ev)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          commitEdit(ev)
                        }
                        if (e.key === 'Escape') {
                          e.preventDefault()
                          cancelEdit()
                        }
                      }}
                    />
                    {validationError ? (
                      <div
                        id={`${inputId}-${editKey(ev.id, 'time_out')}-error`}
                        className="pw-portal-clock-input-error"
                        role="alert"
                      >
                        {validationError}
                      </div>
                    ) : null}
                  </div>
                ) : editable ? (
                  <button
                    type="button"
                    className={`pw-portal-clock-editable pw-portal-clock-out${
                      openOut ? ' pw-portal-clock-out--open' : ''
                    }`}
                    onClick={() => startEdit(ev, 'time_out')}
                  >
                    {displayTimeOut(ev)}
                  </button>
                ) : (
                  <span
                    className={
                      openOut ? 'pw-portal-clock-out pw-portal-clock-out--open' : 'pw-portal-clock-out'
                    }
                  >
                    {displayTimeOut(ev)}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
