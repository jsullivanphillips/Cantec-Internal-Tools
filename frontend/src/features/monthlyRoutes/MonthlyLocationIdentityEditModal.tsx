import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { Alert, Button, Form, Modal, Spinner } from 'react-bootstrap'
import { apiJson, isAbortError } from '../../lib/apiClient'
import type { GeocodeCandidate, LibraryLocation } from './monthlyRoutesShared'

const GEOCODE_DEBOUNCE_MS = 250

const CANDIDATES_STYLE: CSSProperties = {
  maxHeight: '11rem',
  overflowY: 'auto',
}

type IdentityForm = {
  label: string
  building_name: string
  property_management_company: string
}

type Props = {
  show: boolean
  location: LibraryLocation
  onHide: () => void
  onLocationUpdated: (location: LibraryLocation) => void
}

function formFromLocation(location: LibraryLocation): IdentityForm {
  return {
    label: location.label ?? '',
    building_name: location.building_name ?? '',
    property_management_company: location.property_management_company ?? '',
  }
}

export default function MonthlyLocationIdentityEditModal({
  show,
  location,
  onHide,
  onLocationUpdated,
}: Props) {
  const [form, setForm] = useState<IdentityForm>(() => formFromLocation(location))
  const [addressQuery, setAddressQuery] = useState('')
  const [candidates, setCandidates] = useState<GeocodeCandidate[]>([])
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [selectedCandidate, setSelectedCandidate] = useState<GeocodeCandidate | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const committedAddress = (location.address ?? '').trim()

  const resetForm = useCallback(() => {
    setForm(formFromLocation(location))
    setAddressQuery(committedAddress)
    setCandidates([])
    setLookupLoading(false)
    setLookupError(null)
    setSelectedCandidate(null)
    setSaveError(null)
    setSaving(false)
  }, [committedAddress, location])

  useEffect(() => {
    if (show) resetForm()
  }, [show, resetForm])

  useEffect(() => {
    if (!show) return
    const query = addressQuery.trim()
    if (query.length < 3) {
      setCandidates([])
      setLookupLoading(false)
      setLookupError(null)
      return
    }

    let active = true
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLookupLoading(true)
      setLookupError(null)
      const params = new URLSearchParams({ q: query })
      apiJson<{ candidates: GeocodeCandidate[] }>(
        `/api/monthly_routes/geocode_candidates?${params.toString()}`,
        { signal: controller.signal },
      )
        .then((data) => {
          if (active) setCandidates(data.candidates || [])
        })
        .catch((err) => {
          if (!isAbortError(err) && active) {
            setCandidates([])
            setLookupError('Unable to fetch address suggestions.')
          }
        })
        .finally(() => {
          if (active) setLookupLoading(false)
        })
    }, GEOCODE_DEBOUNCE_MS)

    return () => {
      active = false
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [addressQuery, show])

  const addressChanged =
    addressQuery.trim().toLowerCase() !== committedAddress.toLowerCase() || selectedCandidate != null

  const close = useCallback(() => {
    if (saving) return
    onHide()
  }, [onHide, saving])

  const save = useCallback(async () => {
    setSaveError(null)

    if (addressChanged && !selectedCandidate) {
      setSaveError('Select an address from the suggestions to update the navigation address.')
      return
    }

    const payload: Record<string, unknown> = {
      label: form.label.trim() || null,
      building_name: form.building_name.trim() || null,
      property_management_company: form.property_management_company.trim() || null,
    }

    if (addressChanged && selectedCandidate) {
      const addressLine = selectedCandidate.display_address.trim()
      if (!addressLine) {
        setSaveError('Navigation address is required.')
        return
      }
      payload.address = addressLine
      payload.display_address = selectedCandidate.display_address
      payload.latitude = selectedCandidate.latitude
      payload.longitude = selectedCandidate.longitude
    }

    setSaving(true)
    try {
      const res = await apiJson<{ location: LibraryLocation }>(
        `/api/monthly_routes/library/${location.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify(payload),
        },
      )
      onLocationUpdated(res.location)
      onHide()
    } catch (e) {
      const msg =
        typeof e === 'object' && e && 'error' in e ? String((e as { error: unknown }).error) : null
      setSaveError(msg || 'Unable to save location details.')
    } finally {
      setSaving(false)
    }
  }, [
    addressChanged,
    form.building_name,
    form.label,
    form.property_management_company,
    location.id,
    onHide,
    onLocationUpdated,
    selectedCandidate,
  ])

  return (
    <Modal show={show} onHide={close} centered size="lg" className="monthly-location-identity-edit-modal">
      <Modal.Header closeButton={!saving}>
        <Modal.Title className="h6 mb-0">Edit location</Modal.Title>
      </Modal.Header>
      <Modal.Body className="d-flex flex-column gap-3">
        {saveError ? (
          <Alert variant="danger" className="py-2 small mb-0">
            {saveError}
          </Alert>
        ) : null}
        <Form.Group>
          <Form.Label>Label</Form.Label>
          <Form.Control
            value={form.label}
            disabled={saving}
            placeholder="Display name for this stop"
            onChange={(e) => setForm((prev) => ({ ...prev, label: e.target.value }))}
          />
          <Form.Text muted>Shown in lists, worksheets, and paperwork.</Form.Text>
        </Form.Group>
        <Form.Group>
          <Form.Label>Building name</Form.Label>
          <Form.Control
            value={form.building_name}
            disabled={saving}
            onChange={(e) => setForm((prev) => ({ ...prev, building_name: e.target.value }))}
          />
        </Form.Group>
        <Form.Group>
          <Form.Label>Address</Form.Label>
          <Form.Control
            type="search"
            value={addressQuery}
            disabled={saving}
            placeholder="Search address (Greater Victoria)"
            onChange={(e) => {
              setAddressQuery(e.target.value)
              setSelectedCandidate(null)
            }}
          />
          <Form.Text muted>Navigation address for maps and directions.</Form.Text>
          {!selectedCandidate && lookupLoading ? (
            <div className="text-muted small mt-1">Searching addresses…</div>
          ) : null}
          {!selectedCandidate && lookupError ? (
            <div className="text-danger small mt-1">{lookupError}</div>
          ) : null}
          {!selectedCandidate &&
          !lookupLoading &&
          addressQuery.trim().length >= 3 &&
          candidates.length === 0 ? (
            <div className="text-muted small mt-1">No matching addresses.</div>
          ) : null}
          {!selectedCandidate && candidates.length > 0 ? (
            <div className="d-flex flex-column gap-1 mt-2" style={CANDIDATES_STYLE}>
              {candidates.map((candidate) => (
                <Button
                  key={`${candidate.display_address}-${candidate.latitude}-${candidate.longitude}`}
                  type="button"
                  variant="outline-secondary"
                  size="sm"
                  className="text-start"
                  disabled={saving}
                  onClick={() => {
                    setSelectedCandidate(candidate)
                    setAddressQuery(candidate.display_address)
                    setCandidates([])
                  }}
                >
                  {candidate.display_address}
                </Button>
              ))}
            </div>
          ) : null}
          {selectedCandidate ? (
            <div className="text-success small mt-1">Map pin will use the selected address.</div>
          ) : null}
        </Form.Group>
        <Form.Group>
          <Form.Label>Property management</Form.Label>
          <Form.Control
            value={form.property_management_company}
            disabled={saving}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, property_management_company: e.target.value }))
            }
          />
        </Form.Group>
      </Modal.Body>
      <Modal.Footer>
        <Button type="button" variant="outline-secondary" disabled={saving} onClick={close}>
          Cancel
        </Button>
        <Button type="button" variant="primary" disabled={saving} onClick={() => void save()}>
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
    </Modal>
  )
}
