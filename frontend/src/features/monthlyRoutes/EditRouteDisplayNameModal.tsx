import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Form, Modal, Spinner } from 'react-bootstrap'
import { apiJson } from '../../lib/apiClient'
import { routeDisplayLabel, type MonthlyRouteSummary } from './monthlyRoutesShared'

type Props = {
  show: boolean
  route: MonthlyRouteSummary
  onClose: () => void
  onSaved: (displayName: string | null) => void
}

export default function EditRouteDisplayNameModal({ show, route, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState(route.display_name ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (show) {
      setDraft(route.display_name ?? '')
      setError(null)
    }
  }, [show, route.display_name])

  const previewRoute = useMemo(
    (): MonthlyRouteSummary => ({
      ...route,
      display_name: draft.trim() || null,
    }),
    [route, draft],
  )

  const previewLabel = routeDisplayLabel(previewRoute)

  const onSave = useCallback(async () => {
    const next = draft.trim()
    const prev = (route.display_name ?? '').trim()
    if (next === prev) {
      onClose()
      return
    }

    const optimistic = next.length > 0 ? next : null
    const rollback = (route.display_name ?? '').trim() || null

    onSaved(optimistic)
    setSubmitting(true)
    setError(null)
    try {
      const body = await apiJson<{ ok: boolean; route: MonthlyRouteSummary }>(
        `/api/monthly_routes/routes/${route.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ display_name: optimistic }),
        },
      )
      onSaved(body.route.display_name ?? null)
      onClose()
    } catch (e) {
      onSaved(rollback)
      setError(e instanceof Error ? e.message : 'Could not save route label.')
    } finally {
      setSubmitting(false)
    }
  }, [draft, onClose, onSaved, route.display_name, route.id])

  const onClear = useCallback(async () => {
    if (!(route.display_name ?? '').trim()) {
      setDraft('')
      return
    }

    const rollback = (route.display_name ?? '').trim() || null
    onSaved(null)
    setSubmitting(true)
    setError(null)
    try {
      const body = await apiJson<{ ok: boolean; route: MonthlyRouteSummary }>(
        `/api/monthly_routes/routes/${route.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ display_name: null }),
        },
      )
      onSaved(body.route.display_name ?? null)
      setDraft('')
      onClose()
    } catch (e) {
      onSaved(rollback)
      setError(e instanceof Error ? e.message : 'Could not clear route label.')
    } finally {
      setSubmitting(false)
    }
  }, [onClose, onSaved, route.display_name, route.id])

  return (
    <Modal show={show} onHide={onClose} centered backdrop={submitting ? 'static' : true}>
      <Modal.Header closeButton={!submitting}>
        <Modal.Title className="h6 mb-0">Edit route label</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="small text-muted mb-3">
          Add a short name after the route schedule. Leave blank to show the schedule only.
        </p>
        {error ? (
          <Alert variant="danger" className="py-2 small mb-3">
            {error}
          </Alert>
        ) : null}
        <Form.Group controlId="route-display-name">
          <Form.Label className="small fw-semibold">Label suffix</Form.Label>
          <Form.Control
            type="text"
            value={draft}
            maxLength={255}
            disabled={submitting}
            placeholder="e.g. Thrifty's 2"
            onChange={(e) => setDraft(e.target.value)}
          />
        </Form.Group>
        <div className="small text-muted mt-3 mb-1">Preview</div>
        <div className="fw-semibold">{previewLabel}</div>
      </Modal.Body>
      <Modal.Footer>
        <Button
          variant="outline-secondary"
          size="sm"
          disabled={submitting || !(route.display_name ?? '').trim()}
          onClick={() => void onClear()}
        >
          Clear label
        </Button>
        <Button variant="secondary" size="sm" disabled={submitting} onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" disabled={submitting} onClick={() => void onSave()}>
          {submitting ? (
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
