import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Form, Modal } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import { apiJson } from '../../lib/apiClient'
import type { GeocodeCandidate, LibraryLocation, LibraryLocationGeocodeResult } from './monthlyRoutesShared'

export type MonthlyLocationMapPinModalProps = {
  show: boolean
  locationId: number
  title: string
  address: string
  displayAddress?: string | null
  onHide: () => void
  onSaved: () => void
}

export default function MonthlyLocationMapPinModal({
  show,
  locationId,
  title,
  address,
  displayAddress,
  onHide,
  onSaved,
}: MonthlyLocationMapPinModalProps) {
  const [placementQuery, setPlacementQuery] = useState('')
  const [placementCandidates, setPlacementCandidates] = useState<GeocodeCandidate[]>([])
  const [placementLoading, setPlacementLoading] = useState(false)
  const [placementSaving, setPlacementSaving] = useState(false)
  const [placementError, setPlacementError] = useState<string | null>(null)
  const [autoGeocoding, setAutoGeocoding] = useState(false)
  const [autoGeocodeMessage, setAutoGeocodeMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!show) return
    setPlacementQuery((displayAddress || address || '').trim())
    setPlacementCandidates([])
    setPlacementError(null)
    setAutoGeocodeMessage(null)
    setPlacementLoading(false)
    setPlacementSaving(false)
    setAutoGeocoding(false)
  }, [show, locationId, address, displayAddress])

  useEffect(() => {
    if (!show) return
    const query = placementQuery.trim()
    if (query.length < 3) {
      setPlacementCandidates([])
      setPlacementLoading(false)
      return
    }

    let active = true
    const controller = new AbortController()
    setPlacementLoading(true)
    setPlacementError(null)
    const params = new URLSearchParams({ q: query })
    apiJson<{ candidates: GeocodeCandidate[] }>(
      `/api/monthly_sites/geocode_candidates?${params.toString()}`,
      { signal: controller.signal }
    )
      .then((data) => {
        if (active) setPlacementCandidates(data.candidates || [])
      })
      .catch(() => {
        if (active) {
          setPlacementCandidates([])
          setPlacementError('Unable to fetch address candidates.')
        }
      })
      .finally(() => {
        if (active) setPlacementLoading(false)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [show, placementQuery])

  const applyPlacementCandidate = useCallback(
    async (candidate: GeocodeCandidate) => {
      setPlacementSaving(true)
      setPlacementError(null)
      try {
        await apiJson<{ location: LibraryLocation }>(
          `/api/monthly_sites/library/${locationId}/placement`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              display_address: candidate.display_address,
              latitude: candidate.latitude,
              longitude: candidate.longitude,
            }),
          }
        )
        onSaved()
        onHide()
      } catch (err) {
        if (typeof err === 'object' && err && 'error' in err) {
          setPlacementError(String((err as { error: unknown }).error))
        } else {
          setPlacementError('Unable to save map pin.')
        }
      } finally {
        setPlacementSaving(false)
      }
    },
    [locationId, onHide, onSaved]
  )

  const tryAutoGeocode = useCallback(async () => {
    setAutoGeocoding(true)
    setAutoGeocodeMessage(null)
    setPlacementError(null)
    try {
      const res = await apiJson<LibraryLocationGeocodeResult>(
        `/api/monthly_sites/library/${locationId}/geocode`,
        { method: 'POST' }
      )
      if (res.geocoded) {
        onSaved()
        onHide()
        return
      }
      setAutoGeocodeMessage(
        res.error ||
          'Could not geocode this address automatically. Search for the correct pin below.'
      )
    } catch (err) {
      if (typeof err === 'object' && err && 'error' in err) {
        setAutoGeocodeMessage(String((err as { error: unknown }).error))
      } else {
        setAutoGeocodeMessage('Unable to run automatic geocoding.')
      }
    } finally {
      setAutoGeocoding(false)
    }
  }, [locationId, onHide, onSaved])

  const busy = placementSaving || autoGeocoding

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton={!busy}>
        <Modal.Title className="h6 mb-0">Set map pin</Modal.Title>
      </Modal.Header>
      <Modal.Body className="small">
        <div className="d-flex flex-column gap-3">
          <div>
            <div className="text-muted">Location</div>
            <div className="fw-semibold">{title}</div>
            <div className="text-muted">{address}</div>
            <Link to={`/monthlies/locations/${locationId}`} className="small d-inline-block mt-1">
              Edit street address
            </Link>
          </div>

          {autoGeocodeMessage ? (
            <Alert variant="warning" className="py-2 small mb-0">
              {autoGeocodeMessage}
            </Alert>
          ) : null}
          {placementError ? (
            <Alert variant="danger" className="py-2 small mb-0">
              {placementError}
            </Alert>
          ) : null}

          <div className="d-flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="primary"
              disabled={busy}
              onClick={() => void tryAutoGeocode()}
            >
              {autoGeocoding ? 'Geocoding…' : 'Try automatic geocode'}
            </Button>
          </div>

          <div>
            <div className="fw-semibold mb-1">Or pick pin from Mapbox search</div>
            <Form.Control
              type="search"
              value={placementQuery}
              placeholder="Search address in Greater Victoria"
              onChange={(e) => setPlacementQuery(e.target.value)}
              disabled={busy}
            />
            {placementLoading ? <div className="text-muted mt-2">Searching addresses…</div> : null}
            {!placementLoading && placementQuery.trim().length >= 3 && placementCandidates.length === 0 ? (
              <div className="text-muted mt-2">No candidate addresses found.</div>
            ) : null}
            <div className="d-flex flex-column gap-2 mt-2" style={{ maxHeight: '14rem', overflowY: 'auto' }}>
              {placementCandidates.map((candidate) => (
                <Button
                  key={`${candidate.display_address}-${candidate.latitude}-${candidate.longitude}`}
                  type="button"
                  variant="outline-primary"
                  className="text-start"
                  disabled={busy}
                  onClick={() => void applyPlacementCandidate(candidate)}
                >
                  {candidate.display_address}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button type="button" variant="outline-secondary" size="sm" disabled={busy} onClick={onHide}>
          Cancel
        </Button>
      </Modal.Footer>
    </Modal>
  )
}
