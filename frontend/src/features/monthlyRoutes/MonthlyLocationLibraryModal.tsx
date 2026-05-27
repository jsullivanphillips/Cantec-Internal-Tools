import type { CSSProperties } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Form, Modal } from 'react-bootstrap'
import { apiJson } from '../../lib/apiClient'
import RouteLibraryLink from './RouteLibraryLink'
import TestingSiteFieldsSection from './TestingSiteFieldsSection'
import {
  annualMonthDropdownOptions,
  STATUS_OPTIONS,
  buildTestingSiteEditForm,
  libraryKeycodeDisplay,
  normalizeAnnualMonthForSelect,
  sortedTestingSites,
  testingSitePayloadFromEditForm,
  type LibraryLocation,
  type MonthlyLocationDetailPayload,
  type TestingSiteEditForm,
} from './monthlyRoutesShared'

const LIBRARY_DETAIL_MODAL_TITLE_ID = 'library-detail-modal-title'

const ROUTES_MODAL_SHELL_STYLE: CSSProperties = {
  borderRadius: '1.6rem',
  border: '0',
  padding: '1.2rem',
  backgroundColor: '#f9fbff',
}

const ROUTES_MODAL_CONTENT_STYLE = {
  '--bs-modal-border-radius': '2.4rem',
  '--bs-modal-bg': 'transparent',
} as CSSProperties

const ROUTES_MODAL_HEADER_STYLE: CSSProperties = {
  backgroundColor: '#cfd8ec',
  borderBottom: '0',
  borderTopLeftRadius: '1.25rem',
  borderTopRightRadius: '1.25rem',
  padding: '1.05rem 1.35rem',
}

const ROUTES_MODAL_BODY_STYLE: CSSProperties = {
  backgroundColor: '#e9edf5',
  borderBottomLeftRadius: '1.25rem',
  borderBottomRightRadius: '1.25rem',
  padding: '1.15rem 1.35rem',
}

const ROUTES_MODAL_FOOTER_STYLE: CSSProperties = {
  borderTop: '0',
  backgroundColor: '#e9edf5',
  borderBottomLeftRadius: '1.25rem',
  borderBottomRightRadius: '1.25rem',
  paddingTop: 0,
  paddingBottom: '1.25rem',
}

const ROUTES_MODAL_INPUT_STYLE: CSSProperties = {
  backgroundColor: '#f8fafc',
  borderColor: '#c8d0df',
}

const ROUTES_MODAL_SUBMIT_STYLE: CSSProperties = {
  backgroundColor: '#2f63d7',
  borderColor: '#2f63d7',
  fontWeight: 600,
  paddingTop: '0.65rem',
  paddingBottom: '0.65rem',
}

const ROUTES_MODAL_TITLE_STYLE: CSSProperties = {
  fontSize: '2rem',
  fontWeight: 650,
  letterSpacing: '-0.01em',
}

const ROUTES_MODAL_SUBTITLE_STYLE: CSSProperties = {
  fontSize: '1.05rem',
  color: '#384a69',
}

const ROUTES_MODAL_CLOSE_BUTTON_STYLE: CSSProperties = {
  border: 0,
  background: 'transparent',
  color: '#2f63d7',
  fontSize: '1.15rem',
  lineHeight: 1,
  padding: '0.2rem 0.35rem',
}

const ROUTES_MODAL_EDIT_BUTTON_STYLE: CSSProperties = {
  backgroundColor: '#2f63d7',
  borderColor: '#2f63d7',
  color: '#fff',
  fontWeight: 600,
}

export type LocationEditForm = {
  address: string
  property_management_company: string
  building: string
  notes: string
  price_per_month: string
  area: string
  start_up_date: string
  status_raw: string
  keys: string
  test_day: string
  annual_month: string
}

export type MonthlyLocationLibraryModalProps = {
  location: LibraryLocation | null
  routeOptions: string[]
  onHide: () => void
  onSaved: (loc: LibraryLocation) => void
  onDeleted?: (locationId: number) => void
  /** When true, the edit form is shown as soon as the modal opens (not after parent PATCH refreshes). */
  openInEditMode?: boolean
}

function normalizeStatusOption(value: string | null | undefined): string {
  const normalized = (value || '').trim().toLowerCase().replace(/\s+/g, '_')
  return ['active', 'cancelled', 'on_hold', 'waiting_keys'].includes(normalized) ? normalized : ''
}

function toDateInputValue(value: string | null | undefined): string {
  if (!value) return ''
  const trimmed = value.trim()
  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : ''
}

function buildEditForm(loc: LibraryLocation): LocationEditForm {
  return {
    address: loc.address || '',
    property_management_company: loc.property_management_company || '',
    building: loc.building || '',
    notes: loc.notes || '',
    price_per_month: loc.price_per_month != null ? String(loc.price_per_month) : '',
    area: loc.area || '',
    start_up_date: toDateInputValue(loc.start_up_date),
    status_raw: normalizeStatusOption(loc.status_raw || loc.status_normalized || ''),
    keys: loc.keys || '',
    test_day: loc.test_day || '',
    annual_month: normalizeAnnualMonthForSelect(loc.annual_month),
  }
}

function ModalLocationStatusDot({ status }: { status: string | null | undefined }) {
  const normalized = (status || '').toLowerCase()
  let colorClass = 'bg-secondary'
  let label = status || 'unknown'

  if (normalized === 'active') {
    colorClass = 'bg-success'
    label = 'active'
  } else if (normalized === 'cancelled') {
    colorClass = 'bg-danger'
    label = 'cancelled'
  } else if (normalized === 'on_hold' || normalized === 'on hold') {
    colorClass = 'bg-warning'
    label = 'on hold'
  } else if (normalized === 'waiting_keys' || normalized === 'waiting keys') {
    return (
      <i className="bi bi-key-fill text-warning" title="waiting keys" aria-label="waiting keys" />
    )
  }

  return (
    <span
      className={`d-inline-block rounded-circle ${colorClass}`}
      style={{ width: 10, height: 10 }}
      title={label}
      aria-label={label}
    />
  )
}

export default function MonthlyLocationLibraryModal({
  location,
  routeOptions,
  onHide,
  onSaved,
  onDeleted,
  openInEditMode = false,
}: MonthlyLocationLibraryModalProps) {
  const [workingLoc, setWorkingLoc] = useState<LibraryLocation | null>(location)
  const [isEditMode, setIsEditMode] = useState(false)
  const [editForm, setEditForm] = useState<LocationEditForm | null>(null)
  const [testingSiteForms, setTestingSiteForms] = useState<TestingSiteEditForm[]>([])
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  /** Tracks prior ``location`` prop so we only apply ``openInEditMode`` on open, not when parent refreshes after save. */
  const hadLocationPropRef = useRef(false)

  useEffect(() => {
    setWorkingLoc(location)
    setSaveError(null)
    setIsSaving(false)
    setIsDeleting(false)

    if (!location) {
      setIsEditMode(false)
      setEditForm(null)
      setTestingSiteForms([])
      hadLocationPropRef.current = false
      return
    }

    const justOpened = !hadLocationPropRef.current
    hadLocationPropRef.current = true

    if (justOpened) {
      if (openInEditMode) {
        setIsEditMode(true)
        setEditForm(buildEditForm(location))
        setTestingSiteForms(
          sortedTestingSites(location).map((site) => buildTestingSiteEditForm(site, location))
        )
      } else {
        setIsEditMode(false)
        setEditForm(null)
        setTestingSiteForms([])
      }
    }
  }, [location, openInEditMode])

  if (!location || !workingLoc) return null

  const loc = workingLoc

  const testingSites = sortedTestingSites(loc)
  const usesV2Stops = testingSites.length > 0

  function closeModal() {
    setIsEditMode(false)
    setEditForm(null)
    setTestingSiteForms([])
    setSaveError(null)
    setIsSaving(false)
    onHide()
  }

  function beginEdit() {
    setEditForm(buildEditForm(loc))
    setTestingSiteForms(testingSites.map((site) => buildTestingSiteEditForm(site, loc)))
    setIsEditMode(true)
    setSaveError(null)
  }

  function updateTestingSiteForm(siteId: number, patch: Partial<TestingSiteEditForm>) {
    setTestingSiteForms((prev) =>
      prev.map((row) => (row.id === siteId ? { ...row, ...patch } : row))
    )
  }

  function updateEditField(field: keyof LocationEditForm, value: string) {
    setEditForm((prev) => (prev ? { ...prev, [field]: value } : prev))
  }

  async function submitEdits() {
    if (!editForm) return
    setIsSaving(true)
    setSaveError(null)
    try {
      const locationBody: Record<string, unknown> = {
        address: editForm.address,
        notes: editForm.notes,
        area: editForm.area,
        start_up_date: editForm.start_up_date || null,
        status_raw: editForm.status_raw,
        test_day: editForm.test_day,
      }
      if (!usesV2Stops) {
        Object.assign(locationBody, {
          property_management_company: editForm.property_management_company,
          building: editForm.building,
          price_per_month: editForm.price_per_month.trim() ? editForm.price_per_month.trim() : null,
          keys: editForm.keys,
          annual_month: editForm.annual_month,
        })
      }

      await apiJson<{ location: LibraryLocation }>(`/api/monthly_sites/library/${loc.id}`, {
        method: 'PATCH',
        body: JSON.stringify(locationBody),
      })

      for (const tsForm of testingSiteForms) {
        await apiJson(`/api/monthly_sites/testing_sites/${tsForm.id}`, {
          method: 'PATCH',
          body: JSON.stringify(testingSitePayloadFromEditForm(tsForm)),
        })
      }

      const detail = await apiJson<MonthlyLocationDetailPayload>(
        `/api/monthly_sites/library/${loc.id}`
      )
      setWorkingLoc(detail.location)
      setIsEditMode(false)
      setEditForm(null)
      setTestingSiteForms([])
      onSaved(detail.location)
    } catch (err) {
      if (typeof err === 'object' && err && 'error' in err) {
        setSaveError(String((err as { error: unknown }).error))
      } else {
        setSaveError('Unable to save changes.')
      }
    } finally {
      setIsSaving(false)
    }
  }

  async function deleteLocation() {
    const confirmed = window.confirm(`Delete location "${loc.address}"? This cannot be undone.`)
    if (!confirmed) return
    setIsDeleting(true)
    setSaveError(null)
    try {
      await apiJson<unknown>(`/api/monthly_sites/library/${loc.id}`, {
        method: 'DELETE',
      })
      onDeleted?.(loc.id)
      closeModal()
    } catch (err) {
      if (typeof err === 'object' && err && 'error' in err) {
        setSaveError(String((err as { error: unknown }).error))
      } else {
        setSaveError('Unable to delete location.')
      }
    } finally {
      setIsDeleting(false)
    }
  }

  const startup =
    loc.start_up_date != null ? new Date(loc.start_up_date).toLocaleDateString() : '—'
  const price = loc.price_per_month != null ? `$${loc.price_per_month.toFixed(2)}` : '—'
  const statusRaw = loc.status_raw?.trim()
  const showRaw =
    statusRaw && statusRaw.toLowerCase() !== (loc.status_normalized || '').toLowerCase()

  return (
    <Modal
      show
      onHide={closeModal}
      size="xl"
      centered
      dialogClassName="monthly-library-location-modal"
      aria-labelledby={LIBRARY_DETAIL_MODAL_TITLE_ID}
      contentClassName="border-0 shadow bg-transparent monthly-library-location-modal__content"
      style={ROUTES_MODAL_CONTENT_STYLE}
    >
      <div
        className="monthly-library-location-modal__shell"
        style={ROUTES_MODAL_SHELL_STYLE}
      >
        <Modal.Header style={ROUTES_MODAL_HEADER_STYLE}>
          <Modal.Title id={LIBRARY_DETAIL_MODAL_TITLE_ID} className="text-break flex-grow-1 pe-3">
            <span className="d-block" style={ROUTES_MODAL_TITLE_STYLE}>
              {loc.address}
            </span>
            {loc.property_management_company ? (
              <span className="d-block mt-1 fw-normal" style={ROUTES_MODAL_SUBTITLE_STYLE}>
                {loc.property_management_company}
              </span>
            ) : null}
          </Modal.Title>
          <div className="d-flex align-items-center gap-2 ms-auto">
            {!isEditMode ? (
              <Button size="sm" style={ROUTES_MODAL_EDIT_BUTTON_STYLE} onClick={beginEdit}>
                Edit
              </Button>
            ) : null}
            {!isEditMode ? (
              <Button
                size="sm"
                variant="danger"
                className="text-white"
                onClick={deleteLocation}
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </Button>
            ) : null}
            <button
              type="button"
              aria-label="Close"
              style={ROUTES_MODAL_CLOSE_BUTTON_STYLE}
              onClick={closeModal}
            >
              <i className="bi bi-x-lg" />
            </button>
          </div>
        </Modal.Header>
        <Modal.Body
          className="small monthly-library-location-modal__body"
          style={ROUTES_MODAL_BODY_STYLE}
        >
          {saveError ? <div className="alert alert-danger py-2">{saveError}</div> : null}
          {isEditMode && editForm ? (
            <div className="d-flex flex-column gap-2 mb-3">
              <div className="small fw-semibold text-uppercase text-muted">Billing location</div>
              <Form.Group>
                <Form.Label className="small mb-1">Address</Form.Label>
                <Form.Control
                  style={ROUTES_MODAL_INPUT_STYLE}
                  size="sm"
                  value={editForm.address}
                  onChange={(e) => updateEditField('address', e.target.value)}
                />
              </Form.Group>
              {!usesV2Stops ? (
                <>
                  <Form.Group>
                    <Form.Label className="small mb-1">Property Management</Form.Label>
                    <Form.Control
                      style={ROUTES_MODAL_INPUT_STYLE}
                      size="sm"
                      value={editForm.property_management_company}
                      onChange={(e) =>
                        updateEditField('property_management_company', e.target.value)
                      }
                    />
                  </Form.Group>
                  <Form.Group>
                    <Form.Label className="small mb-1">Building</Form.Label>
                    <Form.Control
                      style={ROUTES_MODAL_INPUT_STYLE}
                      size="sm"
                      value={editForm.building}
                      onChange={(e) => updateEditField('building', e.target.value)}
                    />
                  </Form.Group>
                </>
              ) : null}
              <Form.Group>
                <Form.Label className="small mb-1">Notes</Form.Label>
                <Form.Control
                  style={ROUTES_MODAL_INPUT_STYLE}
                  as="textarea"
                  rows={2}
                  size="sm"
                  value={editForm.notes}
                  onChange={(e) => updateEditField('notes', e.target.value)}
                />
              </Form.Group>
              <Form.Group>
                <Form.Label className="small mb-1">Area</Form.Label>
                <Form.Control
                  style={ROUTES_MODAL_INPUT_STYLE}
                  size="sm"
                  value={editForm.area}
                  onChange={(e) => updateEditField('area', e.target.value)}
                />
              </Form.Group>
              {!usesV2Stops ? (
                <Form.Group>
                  <Form.Label className="small mb-1">Price/mo</Form.Label>
                  <Form.Control
                    style={ROUTES_MODAL_INPUT_STYLE}
                    size="sm"
                    value={editForm.price_per_month}
                    onChange={(e) => updateEditField('price_per_month', e.target.value)}
                  />
                </Form.Group>
              ) : null}
              <div className="row g-2">
                <div className="col-sm-6">
                  <Form.Group>
                    <Form.Label className="small mb-1">Start up</Form.Label>
                    <Form.Control
                      style={ROUTES_MODAL_INPUT_STYLE}
                      type="date"
                      size="sm"
                      value={editForm.start_up_date}
                      onChange={(e) => updateEditField('start_up_date', e.target.value)}
                    />
                  </Form.Group>
                </div>
                <div className="col-sm-6">
                  <Form.Group>
                    <Form.Label className="small mb-1">Status</Form.Label>
                    <Form.Select
                      style={ROUTES_MODAL_INPUT_STYLE}
                      size="sm"
                      value={editForm.status_raw}
                      onChange={(e) => updateEditField('status_raw', e.target.value)}
                    >
                      <option value="">Unknown</option>
                      {STATUS_OPTIONS.map((status) => (
                        <option key={status.value} value={status.value}>
                          {status.label}
                        </option>
                      ))}
                    </Form.Select>
                  </Form.Group>
                </div>
              </div>
              <Form.Group>
                <Form.Label className="small mb-1">Route</Form.Label>
                <Form.Select
                  style={ROUTES_MODAL_INPUT_STYLE}
                  size="sm"
                  value={editForm.test_day}
                  onChange={(e) => updateEditField('test_day', e.target.value)}
                >
                  <option value="">—</option>
                  {routeOptions.map((route) => (
                    <option key={route} value={route}>
                      {route}
                    </option>
                  ))}
                  {!routeOptions.includes(editForm.test_day) && editForm.test_day ? (
                    <option value={editForm.test_day}>{editForm.test_day}</option>
                  ) : null}
                </Form.Select>
              </Form.Group>
              {!usesV2Stops ? (
                <>
                  <Form.Group>
                    <Form.Label className="small mb-1">Keys</Form.Label>
                    <Form.Control
                      style={ROUTES_MODAL_INPUT_STYLE}
                      size="sm"
                      value={editForm.keys}
                      onChange={(e) => updateEditField('keys', e.target.value)}
                    />
                  </Form.Group>
                  <Form.Group>
                    <Form.Label className="small mb-1">Annual</Form.Label>
                    <Form.Select
                      style={ROUTES_MODAL_INPUT_STYLE}
                      size="sm"
                      value={editForm.annual_month}
                      onChange={(e) => updateEditField('annual_month', e.target.value)}
                    >
                      {annualMonthDropdownOptions(editForm.annual_month).map((opt) => (
                        <option key={opt.value || '__empty'} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </Form.Select>
                  </Form.Group>
                </>
              ) : null}
              {usesV2Stops ? (
                <>
                  <div className="small fw-semibold text-uppercase text-muted mt-2">
                    Testing locations ({testingSiteForms.length})
                  </div>
                  {testingSites.map((site, index) => {
                    const form = testingSiteForms.find((f) => f.id === site.id)
                    return (
                      <TestingSiteFieldsSection
                        key={site.id}
                        mode="edit"
                        site={site}
                        index={index}
                        total={testingSites.length}
                        form={form}
                        onFormChange={(patch) => updateTestingSiteForm(site.id, patch)}
                      />
                    )
                  })}
                </>
              ) : null}
            </div>
          ) : (
            <>
            <dl className="row mb-3 gy-2">
              {!usesV2Stops ? (
                <>
              <dt className="col-sm-3 text-muted">Building</dt>
              <dd className="col-sm-9">{loc.building || '—'}</dd>
                </>
              ) : null}
              <dt className="col-sm-3 text-muted">Notes</dt>
              <dd className="col-sm-9 text-break">{loc.notes || '—'}</dd>
              {!usesV2Stops ? (
                <>
              <dt className="col-sm-3 text-muted">Price/mo</dt>
              <dd className="col-sm-9">{price}</dd>
                </>
              ) : null}
              <dt className="col-sm-3 text-muted">Area</dt>
              <dd className="col-sm-9">{loc.area || '—'}</dd>
              <dt className="col-sm-3 text-muted">Start up</dt>
              <dd className="col-sm-9">{startup}</dd>
              <dt className="col-sm-3 text-muted">Status</dt>
              <dd className="col-sm-9 d-flex flex-wrap align-items-center gap-2">
                <ModalLocationStatusDot status={loc.status_normalized} />
                <span>{loc.status_normalized || '—'}</span>
                {showRaw ? <span className="text-muted">({statusRaw})</span> : null}
              </dd>
              {loc.barcode ? (
                <>
                  <dt className="col-sm-3 text-muted">Barcode</dt>
                  <dd className="col-sm-9">{loc.barcode}</dd>
                </>
              ) : null}
              {!usesV2Stops ? (
                <>
              <dt className="col-sm-3 text-muted">Key</dt>
              <dd className="col-sm-9">
                {loc.key ? (
                  <Link to={`/keys/${loc.key.id}`}>{loc.key.keycode}</Link>
                ) : (
                  libraryKeycodeDisplay(loc) || '—'
                )}
              </dd>
              {!loc.key ? (
                <>
                  <dt className="col-sm-3 text-muted">Spreadsheet KEYS</dt>
                  <dd className="col-sm-9 text-break small text-muted">{loc.keys || '—'}</dd>
                </>
              ) : null}
              <dt className="col-sm-3 text-muted">Annual</dt>
              <dd className="col-sm-9">{loc.annual_month || '—'}</dd>
                </>
              ) : null}
              <dt className="col-sm-3 text-muted">Route</dt>
              <dd className="col-sm-9">
                <RouteLibraryLink loc={loc} />
              </dd>
            </dl>
            {usesV2Stops ? (
              <>
                <div className="small fw-semibold text-uppercase text-muted mb-2">
                  Testing locations ({testingSites.length})
                </div>
                {testingSites.map((site, index) => (
                  <TestingSiteFieldsSection
                    key={site.id}
                    mode="view"
                    site={site}
                    index={index}
                    total={testingSites.length}
                  />
                ))}
              </>
            ) : null}
            </>
          )}
        </Modal.Body>
        {isEditMode ? (
          <Modal.Footer style={ROUTES_MODAL_FOOTER_STYLE}>
            <Button
              className="w-100 text-white"
              style={ROUTES_MODAL_SUBMIT_STYLE}
              onClick={submitEdits}
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : 'Submit Changes'}
            </Button>
          </Modal.Footer>
        ) : null}
      </div>
    </Modal>
  )
}
