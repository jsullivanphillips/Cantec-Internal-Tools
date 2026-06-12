import { useEffect, useState } from 'react'
import { Alert, Button, Form, Modal, Spinner } from 'react-bootstrap'
import {
  DEFAULT_OFFICE_DEFICIENCY_SERVICE_LINE,
  OFFICE_DEFICIENCY_SERVICE_LINES,
  type OfficeDeficiencyServiceLine,
} from './officeDeficiencyServiceLines'
import {
  DEFICIENCY_SEVERITIES,
  DEFICIENCY_STATUSES,
  type PortalDeficiencySummary,
} from './portalWorkflowShared'

export type DeficiencyFormValues = {
  title: string
  severity: string
  status: string
  description: string
  serviceLine?: OfficeDeficiencyServiceLine
  createOnServiceTrade?: boolean
}

type Props = {
  show: boolean
  mode: 'add' | 'edit'
  deficiency?: PortalDeficiencySummary | null
  onHide: () => void
  onSave: (values: DeficiencyFormValues) => void | Promise<void>
  officeServiceTrade?: {
    hasServiceTradeLink: boolean
  } | null
}

function saveSuccessMessage(
  values: DeficiencyFormValues,
  showOfficeServiceTradeFields: boolean,
): string {
  if (showOfficeServiceTradeFields && values.createOnServiceTrade) {
    return 'Deficiency saved and created in ServiceTrade.'
  }
  return 'Deficiency saved successfully.'
}

export default function PortalDeficiencyModal({
  show,
  mode,
  deficiency,
  onHide,
  onSave,
  officeServiceTrade = null,
}: Props) {
  const [title, setTitle] = useState('')
  const [severity, setSeverity] = useState('deficient')
  const [status, setStatus] = useState('new')
  const [description, setDescription] = useState('')
  const [serviceLine, setServiceLine] = useState<OfficeDeficiencyServiceLine>(
    DEFAULT_OFFICE_DEFICIENCY_SERVICE_LINE,
  )
  const [createOnServiceTrade, setCreateOnServiceTrade] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null)

  const showOfficeServiceTradeFields = officeServiceTrade != null && mode === 'add'
  const canCreateOnServiceTrade = officeServiceTrade?.hasServiceTradeLink ?? false

  useEffect(() => {
    if (!show) {
      setSaving(false)
      setSaveError(null)
      setSaveSuccess(null)
      return
    }
    if (mode === 'edit' && deficiency) {
      setTitle(deficiency.title)
      setSeverity(deficiency.severity)
      setStatus(deficiency.status)
      setDescription(deficiency.description ?? '')
      setServiceLine(DEFAULT_OFFICE_DEFICIENCY_SERVICE_LINE)
      setCreateOnServiceTrade(false)
    } else {
      setTitle('')
      setSeverity('deficient')
      setStatus('new')
      setDescription('')
      setServiceLine(DEFAULT_OFFICE_DEFICIENCY_SERVICE_LINE)
      setCreateOnServiceTrade(false)
    }
    setSaveError(null)
    setSaveSuccess(null)
  }, [show, mode, deficiency])

  const canSave = title.trim().length > 0 && !saving && saveSuccess == null
  const formDisabled = saving || saveSuccess != null

  const handleHide = () => {
    if (saving) return
    onHide()
  }

  const handleSave = async () => {
    if (!canSave) return
    const values: DeficiencyFormValues = {
      title: title.trim(),
      severity,
      status,
      description: description.trim(),
      ...(showOfficeServiceTradeFields
        ? {
            serviceLine,
            createOnServiceTrade: createOnServiceTrade && canCreateOnServiceTrade,
          }
        : {}),
    }

    setSaving(true)
    setSaveError(null)
    setSaveSuccess(null)
    try {
      const result = onSave(values)
      if (result != null && typeof (result as Promise<void>).then === 'function') {
        await result
        const message = saveSuccessMessage(values, showOfficeServiceTradeFields)
        setSaveSuccess(message)
        window.setTimeout(() => {
          setSaveSuccess(null)
          onHide()
        }, 1400)
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save deficiency.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      show={show}
      onHide={handleHide}
      centered
      size="lg"
      className="portal-deficiency-modal"
      contentClassName="portal-deficiency-modal__content"
      backdrop={saving ? 'static' : true}
      keyboard={!saving}
    >
      <Modal.Header closeButton={!saving} className="portal-deficiency-modal__header">
        <Modal.Title>{mode === 'add' ? 'Add deficiency' : 'Edit deficiency'}</Modal.Title>
      </Modal.Header>
      <Modal.Body className="portal-deficiency-modal__body">
        {saveSuccess ? (
          <Alert variant="success" className="py-2 small mb-3" role="status">
            {saveSuccess}
          </Alert>
        ) : null}
        {saveError ? (
          <Alert variant="danger" className="py-2 small mb-3" role="alert">
            {saveError}
          </Alert>
        ) : null}
        <Form.Group className="mb-3">
          <Form.Label className="small">Title</Form.Label>
          <Form.Control
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={formDisabled}
          />
        </Form.Group>
        <div className="row g-2 mb-3">
          <div className="col-6">
            <Form.Label className="small">Severity</Form.Label>
            <Form.Select
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
              disabled={formDisabled}
            >
              {DEFICIENCY_SEVERITIES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Form.Select>
          </div>
          <div className="col-6">
            <Form.Label className="small">Status</Form.Label>
            <Form.Select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              disabled={formDisabled}
            >
              {DEFICIENCY_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Form.Select>
          </div>
        </div>
        {showOfficeServiceTradeFields ? (
          <Form.Group className="mb-3">
            <Form.Label className="small">Service line</Form.Label>
            <Form.Select
              value={serviceLine}
              onChange={(e) => setServiceLine(e.target.value as OfficeDeficiencyServiceLine)}
              disabled={formDisabled}
            >
              {OFFICE_DEFICIENCY_SERVICE_LINES.map((line) => (
                <option key={line.value} value={line.value}>
                  {line.label}
                </option>
              ))}
            </Form.Select>
          </Form.Group>
        ) : null}
        <Form.Group className="mb-3">
          <Form.Label className="small">Description</Form.Label>
          <textarea
            className="form-control"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={formDisabled}
          />
        </Form.Group>
        {showOfficeServiceTradeFields ? (
          <Form.Check
            type="checkbox"
            id="portal-def-create-on-service-trade"
            className="portal-def-create-on-st"
            label="Create on ServiceTrade"
            checked={createOnServiceTrade}
            disabled={!canCreateOnServiceTrade || formDisabled}
            title={
              canCreateOnServiceTrade
                ? undefined
                : 'Link this site to ServiceTrade to create deficiencies there.'
            }
            onChange={(e) => setCreateOnServiceTrade(e.target.checked)}
          />
        ) : null}
      </Modal.Body>
      <Modal.Footer className="portal-deficiency-modal__footer">
        <Button variant="secondary" onClick={handleHide} disabled={saving}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!canSave} onClick={() => void handleSave()}>
          {saving ? (
            <>
              <Spinner animation="border" size="sm" className="me-1" aria-hidden />
              Saving…
            </>
          ) : (
            'Save'
          )}
        </Button>
      </Modal.Footer>
    </Modal>
  )
}
