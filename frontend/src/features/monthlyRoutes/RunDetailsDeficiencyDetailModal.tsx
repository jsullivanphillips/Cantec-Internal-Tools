import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Alert, Button, Form, Modal, Spinner } from 'react-bootstrap'
import { apiJson } from '../../lib/apiClient'
import type { MonthlyRunDetailDeficiencySummary } from './monthlyRoutesShared'
import {
  DEFICIENCY_SEVERITIES,
  DEFICIENCY_STATUSES,
} from './portalWorkflowShared'
import {
  deficiencySeverityLabel,
  deficiencyStatusLabel,
  formatDeficiencyTimestamp,
} from './runDetailsDeficiencyDisplay'

export type RunDetailsDeficiencyModalContext = {
  locationLabel?: string
  stopNumber?: number
  siteLabel?: string
}

type PatchDeficiencyResponse = {
  ok: boolean
  deficiency: MonthlyRunDetailDeficiencySummary
}

type Props = {
  show: boolean
  deficiency: MonthlyRunDetailDeficiencySummary | null
  context?: RunDetailsDeficiencyModalContext
  routeId: number
  monthDate: string
  locationId: number
  readOnly?: boolean
  onHide: () => void
  onSaved?: (updated: MonthlyRunDetailDeficiencySummary) => void | Promise<void>
}

function normField(value: string | null | undefined, fallback: string): string {
  const v = (value || '').trim().toLowerCase()
  return v || fallback
}

function InfoPanel({
  label,
  children,
  wide,
}: {
  label: string
  children: ReactNode
  wide?: boolean
}) {
  return (
    <div
      className={`run-details-deficiency-modal__panel${wide ? ' run-details-deficiency-modal__panel--wide' : ''}`}
    >
      <div className="run-details-deficiency-modal__panel-label">{label}</div>
      <div className="run-details-deficiency-modal__panel-value">{children}</div>
    </div>
  )
}

function MetaRow({ label, value }: { label: string; value: ReactNode }) {
  if (value == null || value === '' || value === '—') return null
  return (
    <div className="run-details-deficiency-modal__meta-row">
      <span className="run-details-deficiency-modal__meta-label">{label}</span>
      <span className="run-details-deficiency-modal__meta-value">{value}</span>
    </div>
  )
}

export default function RunDetailsDeficiencyDetailModal({
  show,
  deficiency,
  context,
  routeId,
  monthDate,
  locationId,
  readOnly = false,
  onHide,
  onSaved,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [severity, setSeverity] = useState('deficient')
  const [status, setStatus] = useState('new')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const resetFormFromDeficiency = useCallback((def: MonthlyRunDetailDeficiencySummary) => {
    setSeverity(normField(def.severity, 'deficient'))
    setStatus(normField(def.status, 'new'))
    setDescription((def.description || '').trim())
  }, [])

  useEffect(() => {
    if (!show) {
      setEditing(false)
      setSaveError(null)
      setSaving(false)
    }
  }, [show])

  useEffect(() => {
    if (!deficiency) return
    resetFormFromDeficiency(deficiency)
  }, [deficiency, resetFormFromDeficiency])

  if (!deficiency) return null

  const title = (deficiency.title || '').trim() || 'Deficiency'
  const reportedBy =
    (deficiency.reported_by_tech_name || '').trim() ||
    (deficiency.reported_by_tech_id || '').trim() ||
    null
  const lastEditedBy =
    (deficiency.last_edited_by_tech_name || '').trim() ||
    (deficiency.last_edited_by_tech_id || '').trim() ||
    null
  const viewDescription = (deficiency.description || '').trim()
  const verificationNotes = (deficiency.verification_notes || '').trim()

  const contextParts: string[] = []
  if (context?.locationLabel) contextParts.push(context.locationLabel)
  if (context?.stopNumber != null) contextParts.push(`Stop ${context.stopNumber}`)
  if (context?.siteLabel && context.siteLabel !== 'Primary testing location') {
    contextParts.push(context.siteLabel)
  }

  const hasMeta =
    reportedBy || lastEditedBy || deficiency.created_at || deficiency.updated_at

  const startEditing = () => {
    resetFormFromDeficiency(deficiency)
    setSaveError(null)
    setEditing(true)
  }

  const cancelEditing = () => {
    resetFormFromDeficiency(deficiency)
    setSaveError(null)
    setEditing(false)
  }

  const saveEdits = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      const qs = new URLSearchParams({ month: monthDate })
      const data = await apiJson<PatchDeficiencyResponse>(
        `/api/monthly_routes/routes/${routeId}/worksheet/locations/${locationId}/deficiencies/${deficiency.id}?${qs.toString()}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            severity,
            status,
            description,
          }),
        },
      )
      await onSaved?.(data.deficiency)
      onHide()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save deficiency.')
    } finally {
      setSaving(false)
    }
  }

  const handleModalHide = () => {
    onHide()
  }

  return (
    <Modal
      show={show}
      onHide={handleModalHide}
      centered
      size="lg"
      className="run-details-deficiency-modal"
      contentClassName="run-details-deficiency-modal__content border-0"
      keyboard={!saving}
    >
      <div className="run-details-deficiency-modal__header">
        <h2 className="run-details-deficiency-modal__title">
          <span className="run-details-deficiency-modal__title-prefix">Deficiency:</span> {title}
        </h2>
        <div className="run-details-deficiency-modal__header-actions">
          {!readOnly && !editing ? (
            <button
              type="button"
              className="run-details-deficiency-modal__edit-btn btn"
              onClick={startEditing}
              aria-label="Edit deficiency"
            >
              <i className="bi bi-pencil" aria-hidden />
            </button>
          ) : null}
          <button
            type="button"
            className="run-details-deficiency-modal__close btn btn-link"
            onClick={handleModalHide}
            aria-label="Close"
          >
            <i className="bi bi-x-lg" aria-hidden />
          </button>
        </div>
      </div>

      <Modal.Body className="run-details-deficiency-modal__body">
        {saving ? (
          <div
            className="run-details-deficiency-modal__saving-overlay"
            aria-live="polite"
            aria-busy="true"
          >
            <Spinner animation="border" size="sm" className="me-2" aria-hidden />
            Saving changes…
          </div>
        ) : null}
        {contextParts.length > 0 ? (
          <p className="run-details-deficiency-modal__context">{contextParts.join(' · ')}</p>
        ) : null}

        {saveError ? (
          <Alert variant="danger" className="py-2 small mb-3" role="alert">
            {saveError}
          </Alert>
        ) : null}

        {editing ? (
          <>
            <div className="run-details-deficiency-modal__panel-grid run-details-deficiency-modal__panel-grid--pair">
              <div className="run-details-deficiency-modal__panel">
                <Form.Label className="run-details-deficiency-modal__panel-label">Severity</Form.Label>
                <Form.Select
                  size="sm"
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value)}
                  disabled={saving}
                >
                  {DEFICIENCY_SEVERITIES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </Form.Select>
              </div>
              <div className="run-details-deficiency-modal__panel">
                <Form.Label className="run-details-deficiency-modal__panel-label">Status</Form.Label>
                <Form.Select
                  size="sm"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  disabled={saving}
                >
                  {DEFICIENCY_STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </Form.Select>
              </div>
            </div>
            <div className="run-details-deficiency-modal__panel run-details-deficiency-modal__panel--wide">
              <Form.Label className="run-details-deficiency-modal__panel-label">Description</Form.Label>
              <Form.Control
                as="textarea"
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={saving}
              />
            </div>
          </>
        ) : (
          <>
            <div className="run-details-deficiency-modal__panel-grid run-details-deficiency-modal__panel-grid--pair">
              <InfoPanel label="Severity">{deficiencySeverityLabel(deficiency.severity)}</InfoPanel>
              <InfoPanel label="Status">{deficiencyStatusLabel(deficiency.status)}</InfoPanel>
            </div>
            <InfoPanel label="Description" wide>
              {viewDescription || <span className="text-muted">No description provided.</span>}
            </InfoPanel>
            {verificationNotes ? (
              <InfoPanel label="Verification notes" wide>
                {verificationNotes}
              </InfoPanel>
            ) : null}
          </>
        )}

        {!editing && hasMeta ? (
          <section className="run-details-deficiency-modal__record" aria-label="Record details">
            <h3 className="run-details-deficiency-modal__section-heading">Record details</h3>
            <div className="run-details-deficiency-modal__meta">
              <MetaRow label="Reported by" value={reportedBy} />
              <MetaRow label="Last edited by" value={lastEditedBy} />
              <MetaRow label="Created" value={formatDeficiencyTimestamp(deficiency.created_at)} />
              <MetaRow label="Updated" value={formatDeficiencyTimestamp(deficiency.updated_at)} />
            </div>
          </section>
        ) : null}
      </Modal.Body>

      {editing ? (
        <Modal.Footer className="run-details-deficiency-modal__footer">
          <Button variant="secondary" size="sm" onClick={cancelEditing} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={() => void saveEdits()} disabled={saving}>
            {saving ? (
              <>
                <Spinner animation="border" size="sm" className="me-1" aria-hidden />
                Saving…
              </>
            ) : (
              'Save changes'
            )}
          </Button>
        </Modal.Footer>
      ) : null}
    </Modal>
  )
}
