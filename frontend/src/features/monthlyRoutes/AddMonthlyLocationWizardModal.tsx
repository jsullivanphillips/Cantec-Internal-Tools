import type { CSSProperties } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Form, Modal } from 'react-bootstrap'
import { apiJson, isAbortError } from '../../lib/apiClient'
import {
  STATUS_OPTIONS,
  createEmptyTestingSiteDraft,
  testingSitePayloadFromDraft,
  type CreateLocationStep1Form,
  type GeocodeCandidate,
  type LibraryLocation,
  type MonthlyLocationDetailPayload,
  type MonthlyLocationWizardStep,
  type TestingSiteDraft,
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
    property_management_company: '',
    status_raw: 'active',
    test_day: '',
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
  const [testingDrafts, setTestingDrafts] = useState<TestingSiteDraft[]>([createEmptyTestingSiteDraft()])

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
    setTestingDrafts([createEmptyTestingSiteDraft()])
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
        `/api/monthly_sites/geocode_candidates?${params.toString()}`,
        { signal: controller.signal }
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
    if (!step1Form.property_management_company.trim()) {
      return 'Property management company is required.'
    }
    return null
  }

  const validateStep2 = (): string | null => {
    if (testingDrafts.length < 1) return 'Add at least one testing location.'
    for (let i = 0; i < testingDrafts.length; i += 1) {
      if (!testingDrafts[i].label.trim()) {
        return `Testing location ${i + 1}: label is required.`
      }
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
    setStep(2)
  }

  const handleBack = () => {
    setError(null)
    setStep(1)
  }

  const updateDraft = (clientId: string, patch: Partial<TestingSiteDraft>) => {
    setTestingDrafts((prev) =>
      prev.map((d) => (d.clientId === clientId ? { ...d, ...patch } : d))
    )
  }

  const addTestingDraft = () => {
    setTestingDrafts((prev) => [...prev, createEmptyTestingSiteDraft()])
  }

  const removeTestingDraft = (clientId: string) => {
    setTestingDrafts((prev) => {
      if (prev.length <= 1) return prev
      return prev.filter((d) => d.clientId !== clientId)
    })
  }

  const submitFinish = async () => {
    const step2Err = validateStep2()
    if (step2Err) {
      setError(step2Err)
      return
    }
    const step1Err = validateStep1()
    if (step1Err) {
      setError(step1Err)
      setStep(1)
      return
    }

    const addressLine = (
      selectedCandidate?.display_address ||
      addressQuery ||
      ''
    ).trim()

    setSaving(true)
    setError(null)
    try {
      const payload: Record<string, unknown> = {
        address: addressLine,
        property_management_company: step1Form.property_management_company.trim(),
        status_raw: step1Form.status_raw,
      }
      const routeTrimmed = (step1Form.test_day || '').trim()
      if (routeTrimmed) payload.test_day = routeTrimmed
      if (selectedCandidate) {
        payload.display_address = selectedCandidate.display_address
        payload.latitude = selectedCandidate.latitude
        payload.longitude = selectedCandidate.longitude
      }

      const createRes = await apiJson<{ location: LibraryLocation }>('/api/monthly_sites/library', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      const locationId = createRes.location.id
      const primaryId = createRes.location.testing_sites?.[0]?.id

      if (primaryId == null) {
        throw new Error('Server did not return a primary testing location.')
      }

      const [firstDraft, ...extraDrafts] = testingDrafts

      await apiJson(`/api/monthly_sites/testing_sites/${primaryId}`, {
        method: 'PATCH',
        body: JSON.stringify(testingSitePayloadFromDraft(firstDraft)),
      })

      for (const draft of extraDrafts) {
        await apiJson(`/api/monthly_sites/library/${locationId}/testing_sites`, {
          method: 'POST',
          body: JSON.stringify(testingSitePayloadFromDraft(draft)),
        })
      }

      const detail = await apiJson<MonthlyLocationDetailPayload>(
        `/api/monthly_sites/library/${locationId}`
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
          <span className={step === 1 ? 'fw-semibold text-primary' : ''}>
            1. Monthly location
          </span>
          <span aria-hidden>→</span>
          <span className={step === 2 ? 'fw-semibold text-primary' : ''}>
            2. Testing locations
          </span>
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
              Add one or more testing stops for this monthly location. Each stop needs a label.
            </p>
            {testingDrafts.map((draft, index) => (
              <Card key={draft.clientId} className="border shadow-sm">
                <Card.Header className="py-2 d-flex justify-content-between align-items-center bg-white">
                  <span className="fw-semibold">Testing location {index + 1}</span>
                  {testingDrafts.length > 1 ? (
                    <Button
                      type="button"
                      variant="outline-danger"
                      size="sm"
                      onClick={() => removeTestingDraft(draft.clientId)}
                      disabled={saving}
                    >
                      Remove
                    </Button>
                  ) : null}
                </Card.Header>
                <Card.Body className="d-flex flex-column gap-2 py-2">
                  <Form.Group>
                    <Form.Label className="small mb-1">Label</Form.Label>
                    <Form.Control
                      size="sm"
                      value={draft.label}
                      placeholder="e.g. Main panel, Suite 200"
                      onChange={(e) => updateDraft(draft.clientId, { label: e.target.value })}
                    />
                  </Form.Group>
                  <Form.Group>
                    <Form.Label className="small mb-1">Keys (optional)</Form.Label>
                    <Form.Control
                      size="sm"
                      value={draft.keys}
                      onChange={(e) => updateDraft(draft.clientId, { keys: e.target.value })}
                    />
                  </Form.Group>
                  <Form.Group>
                    <Form.Label className="small mb-1">Price / month (optional)</Form.Label>
                    <Form.Control
                      size="sm"
                      type="text"
                      inputMode="decimal"
                      value={draft.price_per_month}
                      onChange={(e) =>
                        updateDraft(draft.clientId, { price_per_month: e.target.value })
                      }
                    />
                  </Form.Group>
                  <Form.Group>
                    <Form.Label className="small mb-1">Ring (optional)</Form.Label>
                    <Form.Control
                      size="sm"
                      as="textarea"
                      rows={2}
                      value={draft.ring_detail}
                      onChange={(e) =>
                        updateDraft(draft.clientId, { ring_detail: e.target.value })
                      }
                    />
                  </Form.Group>
                  <Form.Group>
                    <Form.Label className="small mb-1">FACP (optional)</Form.Label>
                    <Form.Control
                      size="sm"
                      as="textarea"
                      rows={2}
                      value={draft.facp_detail}
                      onChange={(e) =>
                        updateDraft(draft.clientId, { facp_detail: e.target.value })
                      }
                    />
                  </Form.Group>
                  <Form.Group>
                    <Form.Label className="small mb-1">Testing procedures (optional)</Form.Label>
                    <Form.Control
                      size="sm"
                      as="textarea"
                      rows={2}
                      value={draft.testing_procedures}
                      onChange={(e) =>
                        updateDraft(draft.clientId, { testing_procedures: e.target.value })
                      }
                    />
                  </Form.Group>
                  <Form.Group>
                    <Form.Label className="small mb-1">Tech notes (optional)</Form.Label>
                    <Form.Control
                      size="sm"
                      as="textarea"
                      rows={2}
                      value={draft.inspection_tech_notes}
                      onChange={(e) =>
                        updateDraft(draft.clientId, { inspection_tech_notes: e.target.value })
                      }
                    />
                  </Form.Group>
                </Card.Body>
              </Card>
            ))}
            <Button
              type="button"
              variant="outline-primary"
              size="sm"
              className="align-self-start"
              onClick={addTestingDraft}
              disabled={saving}
            >
              Add another testing location
            </Button>
          </>
        )}

        <div className="d-flex justify-content-end gap-2 mt-1 flex-wrap">
          {step === 2 ? (
            <Button
              size="sm"
              variant="outline-secondary"
              onClick={handleBack}
              disabled={saving}
            >
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
