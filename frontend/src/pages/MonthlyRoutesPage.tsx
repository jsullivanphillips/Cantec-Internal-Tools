import type { CSSProperties } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Form, Modal, OverlayTrigger, Table, Tooltip } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import {
  STATUS_OPTIONS,
  compareYearMonth,
  libraryRouteDisplay,
  libraryKeycodeDisplay,
  parseYearMonth,
  toMonthKey,
  type CreateLocationForm,
  type GeocodeCandidate,
  type LibraryLocation,
  type LibraryPayload,
  type MonthCell,
} from '../features/monthlyRoutes/monthlyRoutesShared'
import { apiJson, isAbortError } from '../lib/apiClient'

type LocationEditForm = {
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

function RouteLibraryLink({ loc }: { loc: LibraryLocation }) {
  const label = libraryRouteDisplay(loc) || '—'
  const url = loc.monthly_route?.service_trade_route_location_url
  if (url && label !== '—') {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="fw-semibold text-decoration-none"
      >
        {label}
      </a>
    )
  }
  return <>{label}</>
}

const LIBRARY_DETAIL_MODAL_TITLE_ID = 'library-detail-modal-title'
const LIBRARY_PAGE_SIZE = 50
const MONTH_NAME_OPTIONS = Array.from({ length: 12 }).map((_, idx) =>
  new Intl.DateTimeFormat('en-US', {
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2000, idx, 1)))
)
/** Keeps month testing columns from stretching wider than the badge content needs. */
const MONTH_TESTING_CELL_STYLE: CSSProperties = {
  width: '3.8rem',
  minWidth: '3.8rem',
  maxWidth: '3.8rem',
  verticalAlign: 'middle',
  textAlign: 'center',
  whiteSpace: 'normal',
  wordBreak: 'break-word',
}

const STATUS_COLUMN_STYLE: CSSProperties = {
  width: '5.0rem',
  minWidth: '5.0rem',
  maxWidth: '5.0rem',
}

const PROPERTY_COLUMN_STYLE: CSSProperties = {
  width: '10rem',
  minWidth: '10rem',
  maxWidth: '10rem',
}

const ADDRESS_COLUMN_STYLE: CSSProperties = {
  width: '11rem',
  minWidth: '11rem',
  maxWidth: '11rem',
}

const ROUTE_COLUMN_STYLE: CSSProperties = {
  width: '6.24rem',
  minWidth: '6.24rem',
  maxWidth: '6.24rem',
}

const KEYS_COLUMN_STYLE: CSSProperties = {
  width: '7.36rem',
  minWidth: '7.36rem',
  maxWidth: '7.36rem',
  textAlign: 'center',
}

const ANNUAL_COLUMN_STYLE: CSSProperties = {
  width: '6.2rem',
  minWidth: '6.2rem',
  maxWidth: '6.2rem',
}

const EDIT_COLUMN_STYLE: CSSProperties = {
  width: '4.25rem',
  minWidth: '4.25rem',
  maxWidth: '4.25rem',
}

const LIBRARY_TABLE_HEADER_STICKY_STYLE: CSSProperties = {
  position: 'sticky',
  top: '0px',
  zIndex: 5,
  backgroundColor: '#fff',
  borderTop: '1px solid #dee2e6',
  boxShadow: 'inset 0 1px 0 #dee2e6, inset 0 -1px 0 rgba(0, 0, 0, 0.12)',
}

const LIBRARY_TABLE_WRAP_STYLE: CSSProperties = {
  maxHeight: '65vh',
  overflowY: 'auto',
  overflowX: 'auto',
}

const LIBRARY_TABLE_STYLE: CSSProperties = {
  width: 'auto',
}

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

const CREATE_LOCATION_GEOCODE_DEBOUNCE_MS = 250

const CREATE_LOCATION_CANDIDATES_STYLE: CSSProperties = {
  maxHeight: '11rem',
  overflowY: 'auto',
}

type YearMonth = { year: number; month: number }

function addMonths(start: YearMonth, offset: number): YearMonth {
  const total = start.year * 12 + (start.month - 1) + offset
  const year = Math.floor(total / 12)
  const month = (total % 12) + 1
  return { year, month }
}

function formatMonthLabel(monthKey: string): string {
  const ym = parseYearMonth(monthKey)
  if (!ym) return monthKey
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(ym.year, ym.month - 1, 1)))
}

function monthNameFromKey(monthKey: string): string {
  const ym = parseYearMonth(monthKey)
  if (!ym) return ''
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(ym.year, ym.month - 1, 1)))
}

function isAnnualMonth(monthKey: string, annualMonth: string | null | undefined): boolean {
  const annual = (annualMonth || '').trim().toLowerCase()
  if (!annual) return false
  const full = monthNameFromKey(monthKey).toLowerCase()
  const short = full.slice(0, 3)
  return annual === full || annual === short
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

export default function MonthlyRoutesPage() {
  const today = new Date()
  const currentYearStart = `${today.getFullYear()}-01-01`
  const currentYearEnd = `${today.getFullYear()}-12-01`

  const [fromMonth, setFromMonth] = useState(currentYearStart)
  const [toMonth, setToMonth] = useState(currentYearEnd)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [payload, setPayload] = useState<LibraryPayload | null>(null)
  const [tableSearch, setTableSearch] = useState('')
  const [showOnlySkipped, setShowOnlySkipped] = useState(false)
  const [showAnnualTestingConflicts, setShowAnnualTestingConflicts] = useState(false)
  const [hideCancelledMbtLocations, setHideCancelledMbtLocations] = useState(true)
  const [newLocationForm, setNewLocationForm] = useState<CreateLocationForm>({
    address: '',
    property_management_company: '',
    status_raw: 'active',
    keys: '',
    test_day: '',
  })
  const [showCreateLocationModal, setShowCreateLocationModal] = useState(false)
  const [createLocationSaving, setCreateLocationSaving] = useState(false)
  const [createLocationError, setCreateLocationError] = useState<string | null>(null)
  const [createLocationAddressQuery, setCreateLocationAddressQuery] = useState('')
  const [createLocationCandidates, setCreateLocationCandidates] = useState<GeocodeCandidate[]>([])
  const [createLocationLookupLoading, setCreateLocationLookupLoading] = useState(false)
  const [createLocationLookupError, setCreateLocationLookupError] = useState<string | null>(null)
  const [createLocationSelectedCandidate, setCreateLocationSelectedCandidate] =
    useState<GeocodeCandidate | null>(null)
  const [page, setPage] = useState(1)
  const [annualEditLocationId, setAnnualEditLocationId] = useState<number | null>(null)
  const [annualSavingLocationId, setAnnualSavingLocationId] = useState<number | null>(null)
  const [selectedLocation, setSelectedLocation] = useState<LibraryLocation | null>(null)
  const [isEditMode, setIsEditMode] = useState(false)
  const [editForm, setEditForm] = useState<LocationEditForm | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const mergeUpdatedLocation = useCallback((updated: LibraryLocation) => {
    setPayload((prev) =>
      prev
        ? {
            ...prev,
            locations: prev.locations.some((loc) => loc.id === updated.id)
              ? prev.locations.map((loc) => (loc.id === updated.id ? { ...loc, ...updated } : loc))
              : [updated, ...prev.locations],
          }
        : prev
    )
    setSelectedLocation((prev) => (prev && prev.id === updated.id ? { ...prev, ...updated } : prev))
  }, [])

  const removeLocationFromState = useCallback((locationId: number) => {
    setPayload((prev) =>
      prev
        ? {
            ...prev,
            locations: prev.locations.filter((loc) => loc.id !== locationId),
          }
        : prev
    )
    setSelectedLocation((prev) => (prev && prev.id === locationId ? null : prev))
  }, [])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setLoading(true)
    setError(null)

    const params = new URLSearchParams()
    const from = parseYearMonth(fromMonth)
    const to = parseYearMonth(toMonth)
    const fallback = parseYearMonth(currentYearStart) ?? { year: today.getFullYear(), month: 1 }
    let start = fallback
    let finish = fallback
    if (from && to) {
      start = compareYearMonth(from, to) <= 0 ? from : to
      finish = compareYearMonth(from, to) <= 0 ? to : from
    } else if (from) {
      start = from
      finish = from
    } else if (to) {
      start = to
      finish = to
    }
    params.set('from_month', toMonthKey(start.year, start.month))
    params.set('to_month', toMonthKey(finish.year, finish.month))
    if (tableSearch.trim()) params.set('q', tableSearch.trim())
    if (showOnlySkipped) params.set('skipped_any', 'true')
    if (showAnnualTestingConflicts) params.set('annual_tested_conflict', 'true')
    params.set('page', String(page))
    params.set('page_size', String(LIBRARY_PAGE_SIZE))

    apiJson<LibraryPayload>(`/api/monthly_routes/library?${params.toString()}`, {
      signal: controller.signal,
    })
      .then((data) => {
        if (active) setPayload(data)
      })
      .catch((err) => {
        if (!isAbortError(err) && active) {
          setError('Unable to load monthly library data.')
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [fromMonth, page, showAnnualTestingConflicts, showOnlySkipped, tableSearch, toMonth])

  const monthColumns = useMemo(() => {
    const from = parseYearMonth(fromMonth)
    const to = parseYearMonth(toMonth)
    const fallback = parseYearMonth(currentYearStart) ?? { year: today.getFullYear(), month: 1 }
    let start = fallback
    let finish = fallback
    if (from && to) {
      start = compareYearMonth(from, to) <= 0 ? from : to
      finish = compareYearMonth(from, to) <= 0 ? to : from
    } else if (from) {
      start = from
      finish = from
    } else if (to) {
      start = to
      finish = to
    }
    const cols: string[] = []
    let cursor = start
    while (compareYearMonth(cursor, finish) <= 0) {
      const month = cursor
      cols.push(toMonthKey(month.year, month.month))
      cursor = addMonths(cursor, 1)
    }
    return cols
  }, [fromMonth, toMonth, currentYearStart, today])
  const locations = payload?.locations ?? []

  const filteredLocations = useMemo(() => {
    if (!hideCancelledMbtLocations) return locations
    return locations.filter((loc) => (loc.status_normalized || '').trim().toLowerCase() !== 'cancelled')
  }, [hideCancelledMbtLocations, locations])
  const pagination = payload?.meta.pagination
  const routeOptions = payload?.meta.routes ?? []

  const openLocationDetail = useCallback((loc: LibraryLocation) => {
    setSelectedLocation(loc)
    setIsEditMode(false)
    setEditForm(null)
    setSaveError(null)
  }, [])

  const saveAnnualForLocation = useCallback(
    async (locationId: number, annualMonth: string) => {
      setAnnualSavingLocationId(locationId)
      try {
        const response = await apiJson<{ location: LibraryLocation }>(
          `/api/monthly_routes/library/${locationId}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              annual_month: annualMonth || null,
            }),
          }
        )
        setPayload((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            locations: prev.locations.map((loc) =>
              loc.id === response.location.id ? response.location : loc
            ),
          }
        })
      } catch {
        setError('Unable to update annual month.')
      } finally {
        setAnnualSavingLocationId(null)
        setAnnualEditLocationId(null)
      }
    },
    []
  )

  function closeLocationDetail() {
    setSelectedLocation(null)
    setIsEditMode(false)
    setEditForm(null)
    setSaveError(null)
    setIsSaving(false)
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
      annual_month: loc.annual_month || '',
    }
  }

  function beginEdit(loc: LibraryLocation) {
    setEditForm(buildEditForm(loc))
    setIsEditMode(true)
    setSaveError(null)
  }

  function updateEditField(field: keyof LocationEditForm, value: string) {
    setEditForm((prev) => (prev ? { ...prev, [field]: value } : prev))
  }

  async function submitEdits() {
    if (!selectedLocation || !editForm) return
    setIsSaving(true)
    setSaveError(null)
    try {
      const response = await apiJson<{ location: LibraryLocation }>(
        `/api/monthly_routes/library/${selectedLocation.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            address: editForm.address,
            property_management_company: editForm.property_management_company,
            building: editForm.building,
            notes: editForm.notes,
            price_per_month: editForm.price_per_month.trim() ? editForm.price_per_month.trim() : null,
            area: editForm.area,
            start_up_date: editForm.start_up_date || null,
            status_raw: editForm.status_raw,
            keys: editForm.keys,
            test_day: editForm.test_day,
            annual_month: editForm.annual_month,
          }),
        }
      )
      setPayload((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          locations: prev.locations.map((loc) =>
            loc.id === response.location.id ? response.location : loc
          ),
        }
      })
      setSelectedLocation(response.location)
      setIsEditMode(false)
      setEditForm(null)
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

  async function deleteLocation(loc: LibraryLocation) {
    const confirmed = window.confirm(`Delete location "${loc.address}"? This cannot be undone.`)
    if (!confirmed) return
    setIsDeleting(true)
    setSaveError(null)
    try {
      await apiJson<unknown>(`/api/monthly_routes/library/${loc.id}`, {
        method: 'DELETE',
      })
      removeLocationFromState(loc.id)
      closeLocationDetail()
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

  const renderMonthCell = useCallback((
    cell: MonthCell | undefined,
    monthKey: string,
    annualMonth: string | null | undefined
  ) => {
    const isAnnual = isAnnualMonth(monthKey, annualMonth)
    if (cell?.result_status === 'tested') {
      if (isAnnual) {
        return (
          <span className="d-inline-flex align-items-center justify-content-center gap-1">
            <i className="bi bi-check-circle-fill text-success" title="Tested" aria-label="Tested" />
            <i
              className="bi bi-exclamation-circle-fill"
              style={{ color: '#6f42c1', fontSize: '0.8rem', lineHeight: 1 }}
              title="Annual month"
              aria-label="Annual month"
            />
          </span>
        )
      }
      return <i className="bi bi-check-circle-fill text-success" title="Tested" aria-label="Tested" />
    }
    if (isAnnual) {
      return (
        <i
          className="bi bi-exclamation-circle-fill"
          style={{ color: '#6f42c1', fontSize: '0.8rem', lineHeight: 1 }}
          title="Annual month"
          aria-label="Annual month"
        />
      )
    }
    if (!cell) return <span className="text-muted">—</span>
    if (cell.result_status === 'skipped') {
      const reason = cell.skip_reason?.trim() || 'Skipped'
      return (
        <OverlayTrigger
          trigger="click"
          rootClose
          placement="top"
          overlay={<Tooltip id={`skip-reason-${monthKey}`}>{reason}</Tooltip>}
        >
          <button
            type="button"
            className="btn p-0 border-0 bg-transparent d-flex align-items-center justify-content-center w-100 h-100"
            style={{ minHeight: '1.35rem' }}
            aria-label={`Skipped: ${reason}. Click to view reason.`}
          >
            <i
              className="bi bi-slash-circle-fill text-warning"
              style={{ fontSize: '0.85rem', lineHeight: 1 }}
              aria-hidden="true"
            />
          </button>
        </OverlayTrigger>
      )
    }
    return <span className="text-muted">—</span>
  }, [])

  const renderStatusDot = useCallback((status: string | null | undefined) => {
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
        <i
          className="bi bi-key-fill text-warning"
          title="waiting keys"
          aria-label="waiting keys"
        />
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
  }, [])

  function detailModal(loc: LibraryLocation) {
    const startup =
      loc.start_up_date != null ? new Date(loc.start_up_date).toLocaleDateString() : '—'
    const price =
      loc.price_per_month != null ? `$${loc.price_per_month.toFixed(2)}` : '—'
    const statusRaw = loc.status_raw?.trim()
    const showRaw =
      statusRaw &&
      statusRaw.toLowerCase() !== (loc.status_normalized || '').toLowerCase()

    return (
      <Modal
        show
        onHide={closeLocationDetail}
        size="lg"
        centered
        aria-labelledby={LIBRARY_DETAIL_MODAL_TITLE_ID}
        contentClassName="border-0 shadow bg-transparent"
        style={ROUTES_MODAL_CONTENT_STYLE}
      >
        <div style={ROUTES_MODAL_SHELL_STYLE}>
        <Modal.Header style={ROUTES_MODAL_HEADER_STYLE}>
          <Modal.Title id={LIBRARY_DETAIL_MODAL_TITLE_ID} className="text-break flex-grow-1 pe-3">
            <span className="d-block" style={ROUTES_MODAL_TITLE_STYLE}>{loc.address}</span>
            {loc.property_management_company ? (
              <span className="d-block mt-1 fw-normal" style={ROUTES_MODAL_SUBTITLE_STYLE}>
                {loc.property_management_company}
              </span>
            ) : null}
          </Modal.Title>
          <div className="d-flex align-items-center gap-2 ms-auto">
          {!isEditMode ? (
            <Button size="sm" style={ROUTES_MODAL_EDIT_BUTTON_STYLE} onClick={() => beginEdit(loc)}>
              Edit
            </Button>
          ) : null}
          {!isEditMode ? (
            <Button
              size="sm"
              variant="danger"
              className="text-white"
              onClick={() => deleteLocation(loc)}
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          ) : null}
          <button
            type="button"
            aria-label="Close"
            style={ROUTES_MODAL_CLOSE_BUTTON_STYLE}
            onClick={closeLocationDetail}
          >
            <i className="bi bi-x-lg" />
          </button>
          </div>
        </Modal.Header>
        <Modal.Body className="small" style={ROUTES_MODAL_BODY_STYLE}>
          {saveError ? <div className="alert alert-danger py-2">{saveError}</div> : null}
          {isEditMode && editForm ? (
            <div className="d-flex flex-column gap-2 mb-3">
              <Form.Group>
                <Form.Label className="small mb-1">Address</Form.Label>
                <Form.Control style={ROUTES_MODAL_INPUT_STYLE} size="sm" value={editForm.address} onChange={(e) => updateEditField('address', e.target.value)} />
              </Form.Group>
              <Form.Group>
                <Form.Label className="small mb-1">Property Management</Form.Label>
                <Form.Control style={ROUTES_MODAL_INPUT_STYLE} size="sm" value={editForm.property_management_company} onChange={(e) => updateEditField('property_management_company', e.target.value)} />
              </Form.Group>
              <Form.Group>
                <Form.Label className="small mb-1">Building</Form.Label>
                <Form.Control style={ROUTES_MODAL_INPUT_STYLE} size="sm" value={editForm.building} onChange={(e) => updateEditField('building', e.target.value)} />
              </Form.Group>
              <Form.Group>
                <Form.Label className="small mb-1">Notes</Form.Label>
                <Form.Control style={ROUTES_MODAL_INPUT_STYLE} as="textarea" rows={2} size="sm" value={editForm.notes} onChange={(e) => updateEditField('notes', e.target.value)} />
              </Form.Group>
              <div className="row g-2">
                <div className="col-sm-6">
                  <Form.Group>
                    <Form.Label className="small mb-1">Price/mo</Form.Label>
                    <Form.Control style={ROUTES_MODAL_INPUT_STYLE} size="sm" value={editForm.price_per_month} onChange={(e) => updateEditField('price_per_month', e.target.value)} />
                  </Form.Group>
                </div>
                <div className="col-sm-6">
                  <Form.Group>
                    <Form.Label className="small mb-1">Area</Form.Label>
                    <Form.Control style={ROUTES_MODAL_INPUT_STYLE} size="sm" value={editForm.area} onChange={(e) => updateEditField('area', e.target.value)} />
                  </Form.Group>
                </div>
              </div>
              <div className="row g-2">
                <div className="col-sm-6">
                  <Form.Group>
                    <Form.Label className="small mb-1">Start up</Form.Label>
                    <Form.Control style={ROUTES_MODAL_INPUT_STYLE} type="date" size="sm" value={editForm.start_up_date} onChange={(e) => updateEditField('start_up_date', e.target.value)} />
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
              <div className="row g-2">
                <div className="col-sm-4">
                  <Form.Group>
                    <Form.Label className="small mb-1">Keys</Form.Label>
                    <Form.Control style={ROUTES_MODAL_INPUT_STYLE} size="sm" value={editForm.keys} onChange={(e) => updateEditField('keys', e.target.value)} />
                  </Form.Group>
                </div>
                <div className="col-sm-4">
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
                </div>
                <div className="col-sm-4">
                  <Form.Group>
                    <Form.Label className="small mb-1">Annual</Form.Label>
                    <Form.Select
                      style={ROUTES_MODAL_INPUT_STYLE}
                      size="sm"
                      value={editForm.annual_month}
                      onChange={(e) => updateEditField('annual_month', e.target.value)}
                    >
                      <option value="">—</option>
                      {MONTH_NAME_OPTIONS.map((monthName) => (
                        <option key={monthName} value={monthName}>
                          {monthName}
                        </option>
                      ))}
                    </Form.Select>
                  </Form.Group>
                </div>
              </div>
            </div>
          ) : (
            <dl className="row mb-4 gy-2">
              <dt className="col-sm-3 text-muted">Building</dt>
              <dd className="col-sm-9">{loc.building || '—'}</dd>
              <dt className="col-sm-3 text-muted">Notes</dt>
              <dd className="col-sm-9 text-break">{loc.notes || '—'}</dd>
              <dt className="col-sm-3 text-muted">Price/mo</dt>
              <dd className="col-sm-9">{price}</dd>
              <dt className="col-sm-3 text-muted">Area</dt>
              <dd className="col-sm-9">{loc.area || '—'}</dd>
              <dt className="col-sm-3 text-muted">Start up</dt>
              <dd className="col-sm-9">{startup}</dd>
              <dt className="col-sm-3 text-muted">Status</dt>
              <dd className="col-sm-9 d-flex flex-wrap align-items-center gap-2">
                {renderStatusDot(loc.status_normalized)}
                <span>{loc.status_normalized || '—'}</span>
                {showRaw ? <span className="text-muted">({statusRaw})</span> : null}
              </dd>
              {loc.barcode ? (
                <>
                  <dt className="col-sm-3 text-muted">Barcode</dt>
                  <dd className="col-sm-9">{loc.barcode}</dd>
                </>
              ) : null}
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
              <dt className="col-sm-3 text-muted">Route</dt>
              <dd className="col-sm-9">
                <RouteLibraryLink loc={loc} />
              </dd>
              <dt className="col-sm-3 text-muted">Annual</dt>
              <dd className="col-sm-9">{loc.annual_month || '—'}</dd>
            </dl>
          )}
        </Modal.Body>
        {isEditMode ? (
          <Modal.Footer style={ROUTES_MODAL_FOOTER_STYLE}>
            <Button className="w-100" style={ROUTES_MODAL_SUBMIT_STYLE} onClick={submitEdits} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Submit Changes'}
            </Button>
          </Modal.Footer>
        ) : null}
        </div>
      </Modal>
    )
  }

  const tableColSpan = 7 + monthColumns.length

  const tableSection = useMemo(() => {
    if (loading || error) return null
    return (
      <div className="monthly-routes-table-wrap" style={LIBRARY_TABLE_WRAP_STYLE}>
        <Table
          striped
          hover
          bordered
          size="sm"
          className="align-middle monthly-routes-library-table"
          style={LIBRARY_TABLE_STYLE}
        >
          <thead>
            <tr>
              <th
                className="text-center"
                style={{
                  ...STATUS_COLUMN_STYLE,
                  ...LIBRARY_TABLE_HEADER_STICKY_STYLE,
                }}
              >
                Status
              </th>
              <th style={{ ...ROUTE_COLUMN_STYLE, ...LIBRARY_TABLE_HEADER_STICKY_STYLE }}>Route</th>
              <th style={{ ...ADDRESS_COLUMN_STYLE, ...LIBRARY_TABLE_HEADER_STICKY_STYLE }}>Address</th>
              <th style={{ ...PROPERTY_COLUMN_STYLE, ...LIBRARY_TABLE_HEADER_STICKY_STYLE }}>Property Management</th>
              <th style={{ ...KEYS_COLUMN_STYLE, ...LIBRARY_TABLE_HEADER_STICKY_STYLE }}>Key</th>
              <th style={{ ...ANNUAL_COLUMN_STYLE, ...LIBRARY_TABLE_HEADER_STICKY_STYLE }}>Annual</th>
              {monthColumns.map((month) => (
                <th
                  key={month}
                  style={{
                    ...MONTH_TESTING_CELL_STYLE,
                    ...LIBRARY_TABLE_HEADER_STICKY_STYLE,
                  }}
                >
                  {formatMonthLabel(month)}
                </th>
              ))}
              <th
                className="text-center"
                style={{
                  ...EDIT_COLUMN_STYLE,
                  ...LIBRARY_TABLE_HEADER_STICKY_STYLE,
                }}
              >
                Edit
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredLocations.length === 0 ? (
              <tr>
                <td colSpan={tableColSpan} className="text-muted">
                  No locations match the current filters.
                </td>
              </tr>
            ) : (
              filteredLocations.map((loc) => (
                <tr
                  key={loc.id}
                >
                  <td className="text-center" style={STATUS_COLUMN_STYLE}>
                    {renderStatusDot(loc.status_normalized)}
                  </td>
                  <td style={ROUTE_COLUMN_STYLE}>
                    <RouteLibraryLink loc={loc} />
                  </td>
                  <td style={ADDRESS_COLUMN_STYLE} className="text-break">
                    {loc.address}
                  </td>
                  <td style={PROPERTY_COLUMN_STYLE}>{loc.property_management_company || '—'}</td>
                  <td style={KEYS_COLUMN_STYLE}>
                    {loc.key ? (
                      <Link
                        to={`/keys/${loc.key.id}`}
                        className="fw-semibold text-decoration-none"
                      >
                        {loc.key.keycode}
                      </Link>
                    ) : (
                      loc.keys || '—'
                    )}
                  </td>
                  <td className="text-center" style={ANNUAL_COLUMN_STYLE}>
                    {annualEditLocationId === loc.id ? (
                      <Form.Select
                        size="sm"
                        value={loc.annual_month || ''}
                        disabled={annualSavingLocationId === loc.id}
                        onChange={(e) => saveAnnualForLocation(loc.id, e.target.value)}
                        onBlur={() => {
                          if (annualSavingLocationId !== loc.id) setAnnualEditLocationId(null)
                        }}
                        autoFocus
                      >
                        <option value="">—</option>
                        {MONTH_NAME_OPTIONS.map((monthName) => (
                          <option key={monthName} value={monthName}>
                            {monthName}
                          </option>
                        ))}
                      </Form.Select>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-link p-0 text-decoration-none text-reset"
                        onClick={() => setAnnualEditLocationId(loc.id)}
                      >
                        {loc.annual_month || '—'}
                      </button>
                    )}
                  </td>
                  {monthColumns.map((month) => {
                    const monthCell = loc.months?.[month]
                    const isAnnualDisplay =
                      isAnnualMonth(month, loc.annual_month) && monthCell?.result_status !== 'tested'
                    const isSkippedSurface =
                      !isAnnualDisplay && monthCell?.result_status === 'skipped'
                    return (
                    <td
                      key={`${loc.id}-${month}`}
                      className={
                        isSkippedSurface
                          ? 'month-testing-cell month-testing-skipped'
                          : 'month-testing-cell'
                      }
                      style={MONTH_TESTING_CELL_STYLE}
                    >
                      {renderMonthCell(monthCell, month, loc.annual_month)}
                    </td>
                    )
                  })}
                  <td className="text-center" style={EDIT_COLUMN_STYLE}>
                    <button
                      type="button"
                      className="btn btn-link btn-sm p-0 text-decoration-none"
                      aria-label={`Edit location ${loc.address}`}
                      onClick={() => openLocationDetail(loc)}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </div>
    )
  }, [
    error,
    filteredLocations,
    loading,
    monthColumns,
    openLocationDetail,
    annualEditLocationId,
    annualSavingLocationId,
    saveAnnualForLocation,
    renderMonthCell,
    renderStatusDot,
    tableColSpan,
  ])

  const canPrevPage = (pagination?.page ?? page) > 1
  const canNextPage = (pagination?.page ?? page) < (pagination?.total_pages ?? 1)

  const openCreateLocationModal = useCallback(() => {
    setCreateLocationError(null)
    setCreateLocationAddressQuery('')
    setCreateLocationCandidates([])
    setCreateLocationLookupLoading(false)
    setCreateLocationLookupError(null)
    setCreateLocationSelectedCandidate(null)
    setNewLocationForm({
      address: '',
      property_management_company: '',
      status_raw: 'active',
      keys: '',
      test_day: '',
    })
    setShowCreateLocationModal(true)
  }, [])

  useEffect(() => {
    if (!showCreateLocationModal) return
    const query = createLocationAddressQuery.trim()
    if (query.length < 3) {
      setCreateLocationCandidates([])
      setCreateLocationLookupLoading(false)
      setCreateLocationLookupError(null)
      return
    }

    let active = true
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setCreateLocationLookupLoading(true)
      setCreateLocationLookupError(null)
      const params = new URLSearchParams({ q: query })
      apiJson<{ candidates: GeocodeCandidate[] }>(
        `/api/monthly_routes/geocode_candidates?${params.toString()}`,
        { signal: controller.signal }
      )
        .then((data) => {
          if (active) setCreateLocationCandidates(data.candidates || [])
        })
        .catch((err) => {
          if (!isAbortError(err) && active) {
            setCreateLocationCandidates([])
            setCreateLocationLookupError('Unable to fetch address suggestions.')
          }
        })
        .finally(() => {
          if (active) setCreateLocationLookupLoading(false)
        })
    }, CREATE_LOCATION_GEOCODE_DEBOUNCE_MS)

    return () => {
      active = false
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [showCreateLocationModal, createLocationAddressQuery])

  const submitCreateLocation = useCallback(async () => {
    const addressLine = (
      createLocationSelectedCandidate?.display_address ||
      createLocationAddressQuery ||
      ''
    ).trim()
    if (!addressLine) {
      setCreateLocationError('Address is required.')
      return
    }
    if (!newLocationForm.property_management_company.trim()) {
      setCreateLocationError('Property management company is required.')
      return
    }

    setCreateLocationSaving(true)
    setCreateLocationError(null)
    try {
      const payload: Record<string, unknown> = {
        address: addressLine,
        property_management_company: newLocationForm.property_management_company.trim(),
        status_raw: newLocationForm.status_raw,
      }
      const keysTrimmed = newLocationForm.keys.trim()
      if (keysTrimmed) payload.keys = keysTrimmed
      const routeTrimmed = (newLocationForm.test_day || '').trim()
      if (routeTrimmed) payload.test_day = routeTrimmed
      if (createLocationSelectedCandidate) {
        payload.display_address = createLocationSelectedCandidate.display_address
        payload.latitude = createLocationSelectedCandidate.latitude
        payload.longitude = createLocationSelectedCandidate.longitude
      }

      const response = await apiJson<{ location: LibraryLocation }>('/api/monthly_routes/library', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      mergeUpdatedLocation(response.location)
      setShowCreateLocationModal(false)
      setCreateLocationAddressQuery('')
      setCreateLocationCandidates([])
      setCreateLocationSelectedCandidate(null)
      setNewLocationForm({
        address: '',
        property_management_company: '',
        status_raw: 'active',
        keys: '',
        test_day: '',
      })
    } catch (err) {
      if (typeof err === 'object' && err && 'error' in err) {
        setCreateLocationError(String((err as { error: unknown }).error))
      } else {
        setCreateLocationError('Unable to create location.')
      }
    } finally {
      setCreateLocationSaving(false)
    }
  }, [
    mergeUpdatedLocation,
    newLocationForm.keys,
    newLocationForm.property_management_company,
    newLocationForm.status_raw,
    newLocationForm.test_day,
    createLocationAddressQuery,
    createLocationSelectedCandidate,
  ])

  return (
    <div className="d-flex flex-column gap-3">
      <Card className="app-surface-card">
        <Card.Body className="p-3">
          <div className="d-flex align-items-center w-100 gap-2">
            <div
              className="d-flex align-items-center gap-2 flex-grow-1 min-w-0 flex-nowrap"
              style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}
            >
              <Form.Control
                type="search"
                value={tableSearch}
                placeholder="Search route, address, property, key, annual"
                onChange={(e) => {
                  setTableSearch(e.target.value)
                  setPage(1)
                }}
                className="flex-grow-1 flex-shrink-1"
                style={{ minWidth: '11rem', maxWidth: '20rem', width: '14rem' }}
              />
              <Form.Control
                type="month"
                value={fromMonth.slice(0, 7)}
                onChange={(e) => {
                  setFromMonth(`${e.target.value}-01`)
                  setPage(1)
                }}
                className="flex-shrink-0"
                style={{ width: '9rem', maxWidth: '9rem' }}
              />
              <Form.Control
                type="month"
                value={toMonth.slice(0, 7)}
                onChange={(e) => {
                  setToMonth(`${e.target.value}-01`)
                  setPage(1)
                }}
                className="flex-shrink-0"
                style={{ width: '9rem', maxWidth: '9rem' }}
              />
              <Form.Check
                id="monthly-routes-skipped-only"
                type="checkbox"
                label="Show only skipped locations"
                checked={showOnlySkipped}
                className="text-nowrap mb-0 flex-shrink-0"
                onChange={(e) => {
                  setShowOnlySkipped(e.target.checked)
                  setPage(1)
                }}
              />
              <Form.Check
                id="monthly-routes-annual-tested-conflicts"
                type="checkbox"
                label="Show annual/testing conflicts"
                checked={showAnnualTestingConflicts}
                className="text-nowrap mb-0 flex-shrink-0"
                onChange={(e) => {
                  setShowAnnualTestingConflicts(e.target.checked)
                  setPage(1)
                }}
              />
              <Form.Check
                id="monthly-routes-hide-cancelled"
                type="checkbox"
                label="Hide cancelled MBT locations"
                checked={hideCancelledMbtLocations}
                className="text-nowrap mb-0 flex-shrink-0"
                onChange={(e) => {
                  setHideCancelledMbtLocations(e.target.checked)
                  setPage(1)
                }}
              />
            </div>
            <Button
              size="sm"
              variant="primary"
              className="flex-shrink-0"
              onClick={openCreateLocationModal}
            >
              Add Location
            </Button>
          </div>
        </Card.Body>
      </Card>

      <Card className="app-surface-card">
        <Card.Header className="bg-white py-2 px-3 d-flex flex-wrap align-items-center gap-2 border-bottom">
          <span className="fw-semibold small">Library</span>
          <div className="ms-auto d-flex align-items-center gap-3">
            <Link to="/monthlies/specialists" className="small text-decoration-none">
              Specialists
            </Link>
            <Link to="/monthlies/map" className="small text-decoration-none">
              Open map
            </Link>
          </div>
        </Card.Header>
        <Card.Body className="p-3">
          {error ? <div className="text-danger">{error}</div> : null}
          {loading ? <div className="text-muted">Loading library data...</div> : null}

          {tableSection}
          {!loading && !error ? (
            <div className="d-flex justify-content-between align-items-center mt-2">
              <div className="small text-muted">
                {pagination
                  ? `Showing page ${pagination.page} of ${pagination.total_pages} (${pagination.total} total)`
                  : null}
              </div>
              <div className="d-flex gap-2">
                <Button
                  variant="outline-secondary"
                  size="sm"
                  disabled={!canPrevPage}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline-secondary"
                  size="sm"
                  disabled={!canNextPage}
                  onClick={() =>
                    setPage((p) => (pagination ? Math.min(pagination.total_pages, p + 1) : p + 1))
                  }
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}

          {selectedLocation ? detailModal(selectedLocation) : null}
        </Card.Body>
      </Card>

      <Modal show={showCreateLocationModal} onHide={() => setShowCreateLocationModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title className="h6 mb-0">Add Location</Modal.Title>
        </Modal.Header>
        <Modal.Body className="small d-flex flex-column gap-2">
          {createLocationError ? <div className="text-danger">{createLocationError}</div> : null}
          <Form.Group>
            <Form.Label className="small mb-1">Address</Form.Label>
            <Form.Control
              size="sm"
              type="search"
              value={createLocationAddressQuery}
              placeholder="Search address (Greater Victoria)"
              onChange={(e) => {
                const v = e.target.value
                setCreateLocationAddressQuery(v)
                setCreateLocationSelectedCandidate(null)
              }}
            />
            {!createLocationSelectedCandidate && createLocationLookupLoading ? (
              <div className="text-muted mt-1">Searching addresses...</div>
            ) : null}
            {!createLocationSelectedCandidate && createLocationLookupError ? (
              <div className="text-danger mt-1">{createLocationLookupError}</div>
            ) : null}
            {!createLocationSelectedCandidate &&
            !createLocationLookupLoading &&
            createLocationAddressQuery.trim().length >= 3 &&
            createLocationCandidates.length === 0 ? (
              <div className="text-muted mt-1">No matching addresses.</div>
            ) : null}
            {!createLocationSelectedCandidate && createLocationCandidates.length > 0 ? (
              <div className="d-flex flex-column gap-1 mt-2" style={CREATE_LOCATION_CANDIDATES_STYLE}>
                {createLocationCandidates.map((candidate) => (
                  <Button
                    key={`${candidate.display_address}-${candidate.latitude}-${candidate.longitude}`}
                    variant="outline-secondary"
                    size="sm"
                    className="text-start"
                    onClick={() => {
                      setCreateLocationSelectedCandidate(candidate)
                      setCreateLocationAddressQuery(candidate.display_address)
                      setCreateLocationCandidates([])
                    }}
                  >
                    {candidate.display_address}
                  </Button>
                ))}
              </div>
            ) : null}
            {createLocationSelectedCandidate ? (
              <div className="text-success small mt-1">Map pin will use the selected address.</div>
            ) : null}
          </Form.Group>
          <Form.Group>
            <Form.Label className="small mb-1">Route (optional)</Form.Label>
            <Form.Select
              size="sm"
              value={newLocationForm.test_day ?? ''}
              onChange={(e) => setNewLocationForm((prev) => ({ ...prev, test_day: e.target.value }))}
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
              value={newLocationForm.property_management_company}
              onChange={(e) =>
                setNewLocationForm((prev) => ({
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
              value={newLocationForm.status_raw}
              onChange={(e) => setNewLocationForm((prev) => ({ ...prev, status_raw: e.target.value }))}
            >
              {STATUS_OPTIONS.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </Form.Select>
          </Form.Group>
          <Form.Group>
            <Form.Label className="small mb-1">Keys (optional)</Form.Label>
            <Form.Control
              size="sm"
              value={newLocationForm.keys}
              onChange={(e) => setNewLocationForm((prev) => ({ ...prev, keys: e.target.value }))}
            />
          </Form.Group>
          <div className="d-flex justify-content-end gap-2 mt-2">
            <Button
              size="sm"
              variant="outline-secondary"
              onClick={() => setShowCreateLocationModal(false)}
              disabled={createLocationSaving}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={submitCreateLocation} disabled={createLocationSaving}>
              {createLocationSaving ? 'Saving...' : 'Create Location'}
            </Button>
          </div>
        </Modal.Body>
      </Modal>
    </div>
  )
}
