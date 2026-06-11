import type { CSSProperties } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { Button, Form, Modal } from 'react-bootstrap'
import { apiJson, isAbortError } from '../../lib/apiClient'
import {
  STATUS_OPTIONS,
  type CreateLocationStep1Form,
  type GeocodeCandidate,
  type LibraryLocation,
  type LocationEditForm,
  type MonthlyLocationDetailPayload,
  type MonthlyLocationWizardStep,
} from './monthlyRoutesShared'

const GEOCODE_DEBOUNCE_MS = 250

const CANDIDATES_STYLE: CSSProperties = {
  maxHeight: '11rem',
  overflowY: 'auto',
}

export type AddMonthlyLocationWizardModalProps = {
  show: boolean
  onHide: () => void
  routeOptions: string[]
  onCreated: (location: LibraryLocation) => void
}

function defaultStep1Form(): CreateLocationStep1Form {
  return {
    label: '',
    property_management_company: '',
    status_raw: 'active',
    test_day: '',
  }
}

function defaultInspectionForm(): LocationEditForm {
  return {
    label: '',
    keys: '',
    barcode: '',
    price_per_month: '',
    ring_detail: '',
    facp_detail: '',
    panel_location: '',
    door_code: '',
    property_management_company: '',
    annual_month: '',
    monitoring_company_id: '',
    monitoring_account_number: '',
    monitoring_password: '',
    monitoring_notes: '',
    testing_procedures: '',
    inspection_tech_notes: '',
  }
}

export default function AddMonthlyLocationWizardModal({
  show,
  onHide,
  routeOptions,
  onCreated,
}: AddMonthlyLocationWizardModalProps) {
  const [step, setStep] = useState<MonthlyLocationWizardStep>(1)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [addressQuery, setAddressQuery] = useState('')
  const [candidates, setCandidates] = useState<GeocodeCandidate[]>([])
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [selectedCandidate, setSelectedCandidate] = useState<GeocodeCandidate | null>(null)

  const [step1Form, setStep1Form] = useState<CreateLocationStep1Form>(defaultStep1Form)
  const [inspectionForm, setInspectionForm] = useState<LocationEditForm>(defaultInspectionForm)

  const resetWizard = useCallback(() => {
    setStep(1)
    setError(null)
    setSaving(false)
    setAddressQuery('')
    setCandidates([])
    setLookupLoading(false)
    setLookupError(null)
    setSelectedCandidate(null)
    setStep1Form(defaultStep1Form())
    setInspectionForm(defaultInspectionForm())
  }, [])

  useEffect(() => {
    if (!show) return
    resetWizard()
  }, [show, resetWizard])

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
  }, [show, addressQuery])

  const validateStep1 = (): string | null => {
    const addressLine = (selectedCandidate?.display_address || addressQuery || '').trim()
    if (!addressLine) return 'Address is required.'
    if (!step1Form.label.trim()) return 'Label is required.'
    if (!step1Form.property_management_company.trim()) {
      return 'Property management company is required.'
    }
    return null
  }

  const handleNext = () => {
    const msg = validateStep1()
    if (msg) {
      setError(msg)
      return
    }
    setError(null)
    setInspectionForm((prev) => ({ ...prev, label: step1Form.label.trim() }))
    setStep(2)
  }

  const handleBack = () => {
    setError(null)
    setStep(1)
  }

  const submitFinish = async () => {
    const step1Err = validateStep1()
    if (step1Err) {
      setError(step1Err)
      setStep(1)
      return
    }

    const addressLine = (selectedCandidate?.display_address || addressQuery || '').trim()

    setSaving(true)
    setError(null)
    try {
      const payload: Record<string, unknown> = {
        address: addressLine,
        label: step1Form.label.trim(),
        property_management_company: step1Form.property_management_company.trim(),
        status_raw: step1Form.status_raw,
        keys: inspectionForm.keys.trim() || null,
        price_per_month: inspectionForm.price_per_month.trim() || null,
        ring_detail: inspectionForm.ring_detail.trim() || null,
        facp_detail: inspectionForm.facp_detail.trim() || null,
        panel_location: inspectionForm.panel_location.trim() || null,
        door_code: inspectionForm.door_code.trim() || null,
        testing_procedures: inspectionForm.testing_procedures.trim() || null,
        inspection_tech_notes: inspectionForm.inspection_tech_notes.trim() || null,
      }
      const routeTrimmed = (step1Form.test_day || '').trim()
      if (routeTrimmed) payload.test_day = routeTrimmed
      if (selectedCandidate) {
        payload.display_address = selectedCandidate.display_address
        payload.latitude = selectedCandidate.latitude
        payload.longitude = selectedCandidate.longitude
      }

      const createRes = await apiJson<{ location: LibraryLocation }>('/api/monthly_routes/library', {
        method: 'POST',
        body: JSON.stringify(payload),
      })

      const detail = await apiJson<MonthlyLocationDetailPayload>(
        `/api/monthly_routes/library/${createRes.location.id}`,
      )
      onCreated(detail.location)
      onHide()
    } catch (err) {
      if (typeof err === 'object' && err && 'error' in err) {
        setError(String((err as { error: unknown }).error))
      } else if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('Unable to create location.')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal show={show} onHide={onHide} centered size="lg">
      <Modal.Header closeButton>
        <Modal.Title className="h6 mb-0">Add location</Modal.Title>
      </Modal.Header>
      <Modal.Body className="small d-flex flex-column gap-3">
        <div
          className="d-flex flex-wrap align-items-center gap-2 text-muted"
          aria-label="Setup steps"
        >
          <span className={step === 1 ? 'fw-semibold text-primary' : ''}>1. Address & label</span>
          <span aria-hidden>→</span>
          <span className={step === 2 ? 'fw-semibold text-primary' : ''}>2. Inspection fields</span>
        </div>

        {error ? <div className="text-danger">{error}</div> : null}

        {step === 1 ? (
          <>
            <Form.Group>
              <Form.Label className="small mb-1">Address</Form.Label>
              <Form.Control
                size="sm"
                type="search"
                value={addressQuery}
                placeholder="Search address (Greater Victoria)"
                onChange={(e) => {
                  setAddressQuery(e.target.value)
                  setSelectedCandidate(null)
                }}
              />
              {!selectedCandidate && lookupLoading ? (
                <div className="text-muted mt-1">Searching addresses...</div>
              ) : null}
              {!selectedCandidate && lookupError ? (
                <div className="text-danger mt-1">{lookupError}</div>
              ) : null}
              {!selectedCandidate &&
              !lookupLoading &&
              addressQuery.trim().length >= 3 &&
              candidates.length === 0 ? (
                <div className="text-muted mt-1">No matching addresses.</div>
              ) : null}
              {!selectedCandidate && candidates.length > 0 ? (
                <div className="d-flex flex-column gap-1 mt-2" style={CANDIDATES_STYLE}>
                  {candidates.map((candidate) => (
                    <Button
                      key={`${candidate.display_address}-${candidate.latitude}-${candidate.longitude}`}
                      variant="outline-secondary"
                      size="sm"
                      className="text-start"
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
              <Form.Label className="small mb-1">Label</Form.Label>
              <Form.Control
                size="sm"
                value={step1Form.label}
                placeholder="Display name for this stop"
                onChange={(e) => setStep1Form((prev) => ({ ...prev, label: e.target.value }))}
              />
            </Form.Group>
            <Form.Group>
              <Form.Label className="small mb-1">Route (optional)</Form.Label>
              <Form.Select
                size="sm"
                value={step1Form.test_day ?? ''}
                onChange={(e) =>
                  setStep1Form((prev) => ({ ...prev, test_day: e.target.value }))
                }
              >
                <option value="">Unassigned</option>
                {routeOptions.map((route) => (
                  <option key={route} value={route}>
                    {route}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
            <Form.Group>
              <Form.Label className="small mb-1">Property Management Company</Form.Label>
              <Form.Control
                size="sm"
                value={step1Form.property_management_company}
                onChange={(e) =>
                  setStep1Form((prev) => ({
                    ...prev,
                    property_management_company: e.target.value,
                  }))
                }
              />
            </Form.Group>
            <Form.Group>
              <Form.Label className="small mb-1">Status</Form.Label>
              <Form.Select
                size="sm"
                value={step1Form.status_raw}
                onChange={(e) =>
                  setStep1Form((prev) => ({ ...prev, status_raw: e.target.value }))
                }
              >
                {STATUS_OPTIONS.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          </>
        ) : (
          <>
            <p className="text-muted mb-0">
              Optional inspection fields for <strong>{step1Form.label.trim()}</strong>.
            </p>
            <Form.Group>
              <Form.Label className="small mb-1">Keys (optional)</Form.Label>
              <Form.Control
                size="sm"
                value={inspectionForm.keys}
                onChange={(e) =>
                  setInspectionForm((prev) => ({ ...prev, keys: e.target.value }))
                }
              />
            </Form.Group>
            <Form.Group>
              <Form.Label className="small mb-1">Price / month (optional)</Form.Label>
              <Form.Control
                size="sm"
                type="text"
                inputMode="decimal"
                value={inspectionForm.price_per_month}
                onChange={(e) =>
                  setInspectionForm((prev) => ({ ...prev, price_per_month: e.target.value }))
                }
              />
            </Form.Group>
            <Form.Group>
              <Form.Label className="small mb-1">Ring (optional)</Form.Label>
              <Form.Control
                size="sm"
                as="textarea"
                rows={2}
                value={inspectionForm.ring_detail}
                onChange={(e) =>
                  setInspectionForm((prev) => ({ ...prev, ring_detail: e.target.value }))
                }
              />
            </Form.Group>
            <Form.Group>
              <Form.Label className="small mb-1">FACP (optional)</Form.Label>
              <Form.Control
                size="sm"
                as="textarea"
                rows={2}
                value={inspectionForm.facp_detail}
                onChange={(e) =>
                  setInspectionForm((prev) => ({ ...prev, facp_detail: e.target.value }))
                }
              />
            </Form.Group>
            <Form.Group>
              <Form.Label className="small mb-1">Testing procedures (optional)</Form.Label>
              <Form.Control
                size="sm"
                as="textarea"
                rows={2}
                value={inspectionForm.testing_procedures}
                onChange={(e) =>
                  setInspectionForm((prev) => ({ ...prev, testing_procedures: e.target.value }))
                }
              />
            </Form.Group>
            <Form.Group>
              <Form.Label className="small mb-1">Location comments (optional)</Form.Label>
              <Form.Control
                size="sm"
                as="textarea"
                rows={2}
                value={inspectionForm.inspection_tech_notes}
                onChange={(e) =>
                  setInspectionForm((prev) => ({ ...prev, inspection_tech_notes: e.target.value }))
                }
              />
            </Form.Group>
          </>
        )}

        <div className="d-flex justify-content-end gap-2 mt-1 flex-wrap">
          {step === 2 ? (
            <Button size="sm" variant="outline-secondary" onClick={handleBack} disabled={saving}>
              Back
            </Button>
          ) : null}
          <Button size="sm" variant="outline-secondary" onClick={onHide} disabled={saving}>
            Cancel
          </Button>
          {step === 1 ? (
            <Button size="sm" variant="primary" onClick={handleNext}>
              Next
            </Button>
          ) : (
            <Button size="sm" variant="primary" onClick={submitFinish} disabled={saving}>
              {saving ? 'Saving…' : 'Finish'}
            </Button>
          )}
        </div>
      </Modal.Body>
    </Modal>
  )
}
