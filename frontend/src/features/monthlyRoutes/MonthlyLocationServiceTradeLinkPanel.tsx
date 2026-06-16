import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Form, Modal } from 'react-bootstrap'
import type { LibraryLocation } from './monthlyRoutesShared'
import { apiJson } from '../../lib/apiClient'

type ServiceTradeLinkPatchResponse = {
  location: LibraryLocation
}

function formatLinkError(err: unknown): string {
  if (err && typeof err === 'object') {
    const o = err as { error?: unknown; code?: unknown }
    if (typeof o.error === 'string' && o.error.trim()) return o.error
    if (o.code === 'service_trade_site_id_taken') {
      return 'That ServiceTrade location is already linked to another monthly site.'
    }
    if (o.code === 'service_trade_location_not_found') {
      return 'ServiceTrade location not found. Check the id and try again.'
    }
  }
  if (typeof err === 'string' && err.trim()) return err
  return 'Could not update ServiceTrade link.'
}

function useServiceTradeLinkPatch(
  locationId: number,
  onLocationUpdated: (loc: LibraryLocation) => void,
) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const patchLink = useCallback(
    async (serviceTradeSiteLocationId: number | null) => {
      setSaving(true)
      setError(null)
      try {
        const res = await apiJson<ServiceTradeLinkPatchResponse>(
          `/api/monthly_routes/library/${locationId}/service_trade_link`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ service_trade_site_location_id: serviceTradeSiteLocationId }),
          },
        )
        onLocationUpdated(res.location)
        return res.location
      } catch (err) {
        setError(formatLinkError(err))
        throw err
      } finally {
        setSaving(false)
      }
    },
    [locationId, onLocationUpdated],
  )

  const clearError = useCallback(() => setError(null), [])

  return { saving, error, patchLink, clearError, setError }
}

function ServiceTradeLinkForm({
  linkedId,
  saving,
  error,
  draftId,
  onDraftIdChange,
  onSave,
  onClear,
  onCancel,
  showClear,
}: {
  linkedId: number | null
  saving: boolean
  error: string | null
  draftId: string
  onDraftIdChange: (value: string) => void
  onSave: () => void
  onClear?: () => void
  onCancel?: () => void
  showClear?: boolean
}) {
  return (
    <>
      {error ? (
        <Alert variant="danger" className="py-2 small mb-3">
          {error}
        </Alert>
      ) : null}
      <p className="small text-muted mb-2">
        {linkedId == null
          ? 'No ServiceTrade link yet. Enter the location id from ServiceTrade to link this site.'
          : 'Update the ServiceTrade location id for this monthly site.'}
      </p>
      <Form.Group className="mb-2">
        <Form.Label className="small mb-1">ServiceTrade location id</Form.Label>
        <Form.Control
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={draftId}
          disabled={saving}
          placeholder="e.g. 1234567"
          onChange={(e) => onDraftIdChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onSave()
            }
          }}
        />
      </Form.Group>
      <div className="d-flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="primary" disabled={saving} onClick={onSave}>
          {saving ? 'Saving…' : linkedId == null ? 'Link location' : 'Save link'}
        </Button>
        {showClear && onClear ? (
          <Button type="button" size="sm" variant="outline-danger" disabled={saving} onClick={onClear}>
            Clear link
          </Button>
        ) : null}
        {onCancel ? (
          <Button type="button" size="sm" variant="outline-secondary" disabled={saving} onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </>
  )
}

/** Unmatched sites only — inline integrations card. */
export default function MonthlyLocationServiceTradeLinkPanel({
  location,
  onLocationUpdated,
}: {
  location: LibraryLocation
  onLocationUpdated: (loc: LibraryLocation) => void
}) {
  const linkedId = location.service_trade_site_location_id ?? null
  if (linkedId != null) {
    return null
  }

  const [draftId, setDraftId] = useState('')
  const { saving, error, patchLink, clearError, setError } = useServiceTradeLinkPatch(
    location.id,
    onLocationUpdated,
  )

  const onSave = () => {
    const trimmed = draftId.trim()
    if (!trimmed) {
      setError('Enter a ServiceTrade location id.')
      return
    }
    const parsed = Number(trimmed)
    if (!Number.isInteger(parsed) || parsed <= 0) {
      setError('ServiceTrade location id must be a positive whole number.')
      return
    }
    void patchLink(parsed)
  }

  return (
    <section
      className="monthly-location-detail-surface monthly-location-st-link-panel p-3"
      aria-label="ServiceTrade location link"
    >
      <div className="monthly-location-st-link-panel__header">
        <div>
          <p className="monthly-location-st-link-panel__eyebrow mb-1">Integrations</p>
          <h2 className="monthly-location-st-link-panel__title h6 mb-0">ServiceTrade location</h2>
        </div>
      </div>
      <div className="mt-3">
        <ServiceTradeLinkForm
          linkedId={null}
          saving={saving}
          error={error}
          draftId={draftId}
          onDraftIdChange={(value) => {
            clearError()
            setDraftId(value)
          }}
          onSave={onSave}
        />
      </div>
    </section>
  )
}

export function MonthlyLocationServiceTradeLinkEditModal({
  show,
  location,
  onHide,
  onLocationUpdated,
}: {
  show: boolean
  location: LibraryLocation
  onHide: () => void
  onLocationUpdated: (loc: LibraryLocation) => void
}) {
  const linkedId = location.service_trade_site_location_id ?? null
  const [draftId, setDraftId] = useState(linkedId != null ? String(linkedId) : '')
  const { saving, error, patchLink, clearError, setError } = useServiceTradeLinkPatch(
    location.id,
    (loc) => {
      onLocationUpdated(loc)
      onHide()
    },
  )

  useEffect(() => {
    if (show) {
      setDraftId(linkedId != null ? String(linkedId) : '')
      clearError()
    }
  }, [show, linkedId, clearError])

  const onSave = async () => {
    const trimmed = draftId.trim()
    if (!trimmed) {
      setError('Enter a ServiceTrade location id.')
      return
    }
    const parsed = Number(trimmed)
    if (!Number.isInteger(parsed) || parsed <= 0) {
      setError('ServiceTrade location id must be a positive whole number.')
      return
    }
    try {
      await patchLink(parsed)
    } catch {
      // error shown in form
    }
  }

  const onClear = async () => {
    try {
      await patchLink(null)
    } catch {
      // error shown in form
    }
  }

  return (
    <Modal show={show} onHide={onHide} centered size="sm">
      <Modal.Header closeButton={!saving}>
        <Modal.Title className="h6 mb-0">Edit ServiceTrade link</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <ServiceTradeLinkForm
          linkedId={linkedId}
          saving={saving}
          error={error}
          draftId={draftId}
          onDraftIdChange={(value) => {
            clearError()
            setDraftId(value)
          }}
          onSave={() => void onSave()}
          onClear={() => void onClear()}
          onCancel={onHide}
          showClear={linkedId != null}
        />
      </Modal.Body>
    </Modal>
  )
}
