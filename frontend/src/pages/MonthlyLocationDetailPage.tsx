import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Accordion, Alert, Badge, Button, Form, Modal, Spinner } from 'react-bootstrap'
import { Link, useNavigate, useParams } from 'react-router-dom'
import MonthlyLibraryCommentsPanel from '../features/monthlyRoutes/MonthlyLibraryCommentsPanel'
import LocationTicketsPanel from '../features/monthlyRoutes/LocationTicketsPanel'
import MonthlyLocationBillingCommentsPanel from '../features/monthlyRoutes/MonthlyLocationBillingCommentsPanel'
import MonthlyLocationEditableFields, {
  type MonthlyLocationEditableFieldsHandle,
} from '../features/monthlyRoutes/MonthlyLocationEditableFields'
import MonthlyLocationKeyLinkPanel from '../features/keys/MonthlyLocationKeyLinkPanel'
import MonthlyLocationServiceTradeLinkPanel, {
  MonthlyLocationServiceTradeHeroActions,
  MonthlyLocationServiceTradeLinkEditModal,
} from '../features/monthlyRoutes/MonthlyLocationServiceTradeLinkPanel'
import ServiceTradeDeficienciesButton from '../features/monthlyRoutes/ServiceTradeDeficienciesButton'
import { notifyPaperworkMasterSiteUpdated } from '../features/monthlyRoutes/paperworkMasterSync'
import { billingStatusLabel } from '../features/monthlyRoutes/officeRunReviewShared'
import {
  STATUS_OPTIONS,
  effectiveRouteTestDayIso,
  formatRouteTestDayLabel,
  isMonthlyTestingHistoryEditable,
  libraryDisplayPricePerMonth,
  libraryRouteDisplay,
  nextUntestedMonthIso,
  normalizeAnnualMonthForSelect,
  parseYearMonth,
  shouldShowTestingHistoryStatus,
  toMonthKey,
  type LibraryLocation,
  type MonthCell,
  type MonthlyLocationComment,
  type MonthlyLocationDetailPayload,
} from '../features/monthlyRoutes/monthlyRoutesShared'
import { apiJson, isAbortError } from '../lib/apiClient'
import { formatCurrencyCad as formatPriceCad } from '../lib/formatCurrencyCad'

function formatMonthHeading(monthIso: string): string {
  const [y, m] = monthIso.split('-').map(Number)
  if (!y || !m) return monthIso
  return new Intl.DateTimeFormat('en-CA', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, 1)))
}

function formatScheduledTestDay(monthIso: string, loc: LibraryLocation): string | null {
  const iso = effectiveRouteTestDayIso(monthIso, loc.monthly_route)
  if (!iso) return null
  return formatRouteTestDayLabel(iso)
}

function monthNameFromKey(monthKey: string): string {
  const ym = parseYearMonth(monthKey)
  if (!ym) return ''
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(ym.year, ym.month - 1, 1)))
}

function monthShortNameFromKey(monthKey: string): string {
  const ym = parseYearMonth(monthKey)
  if (!ym) return monthKey
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(ym.year, ym.month - 1, 1)))
}

function isAnnualMonth(monthKey: string, annualMonth: string | null | undefined): boolean {
  const annual = (annualMonth || '').trim().toLowerCase()
  if (!annual || annual === 'to') return false
  const full = monthNameFromKey(monthKey).toLowerCase()
  const short = full.slice(0, 3)
  return annual === full || annual === short
}

function statusBadgeVariant(status: string): string {
  switch (status) {
    case 'active':
      return 'success'
    case 'cancelled':
      return 'secondary'
    case 'on_hold':
      return 'warning'
    case 'waiting_keys':
      return 'info'
    default:
      return 'secondary'
  }
}

/** Years that have at least one history row, plus the calendar year of the next scheduled test (if any). */
function yearsWithTestingData(monthKeys: string[], nextMonthIso: string | null): number[] {
  const years = new Set<number>()
  for (const k of monthKeys) {
    const ym = parseYearMonth(k)
    if (ym) years.add(ym.year)
  }
  if (nextMonthIso) {
    const ym = parseYearMonth(nextMonthIso)
    if (ym) years.add(ym.year)
  }
  return Array.from(years).sort((a, b) => a - b)
}

function defaultTestingHistoryYear(years: number[]): number | null {
  if (years.length === 0) return null
  const cy = new Date().getFullYear()
  if (years.includes(cy)) return cy
  return years[years.length - 1]
}

function monthIsoKeysForCalendarYear(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => toMonthKey(year, i + 1))
}

type HistoryFieldEdit = { monthIso: string; field: 'result' | 'billing' }

type OfficeBillingStatus = 'bill' | 'do_not_bill' | 'unset' | 'legacy'

function normalizeHistoryBillingStatus(raw: string | null | undefined): OfficeBillingStatus {
  const s = (raw || '').trim().toLowerCase()
  if (s === 'bill' || s === 'do_not_bill' || s === 'legacy') return s
  return 'unset'
}

function testingHistoryWorksheetRouteId(
  cell: MonthCell | undefined,
  location: LibraryLocation,
): number | null {
  if (!cell) return null
  if (typeof cell.worksheet_route_id === 'number') return cell.worksheet_route_id
  if (typeof cell.test_monthly_route?.id === 'number') return cell.test_monthly_route.id
  if (typeof location.monthly_route_id === 'number') return location.monthly_route_id
  return null
}

function historyMonthResultStatus(cell: MonthCell | undefined): 'tested' | 'skipped' | null {
  const rs = (cell?.result_status || '').trim().toLowerCase()
  if (rs === 'tested' || rs === 'skipped') return rs
  return null
}

function testedHistoryChipLabel(
  cell: MonthCell | undefined,
  isNextSlot: boolean,
  isAnnualMonthRow: boolean,
): string {
  if (!cell) {
    if (isAnnualMonthRow) return 'Annual'
    if (isNextSlot) return 'Pending'
    return 'Set result'
  }
  const rs = historyMonthResultStatus(cell)
  if (rs === 'skipped') return 'Skipped'
  if (rs === 'tested') return 'Tested'
  return 'Set result'
}

function testedHistoryChipClass(
  cell: MonthCell | undefined,
  isAnnualMonthRow: boolean,
): string {
  if (isAnnualMonthRow) return 'monthly-location-testing-history-status-chip--annual'
  const rs = historyMonthResultStatus(cell)
  if (rs === 'tested') return 'monthly-location-testing-history-status-chip--tested'
  if (rs === 'skipped') return 'monthly-location-testing-history-status-chip--skipped'
  return ''
}

function billingHistoryChipClass(status: OfficeBillingStatus): string {
  switch (status) {
    case 'bill':
      return 'monthly-location-testing-history-status-chip--bill'
    case 'do_not_bill':
      return 'monthly-location-testing-history-status-chip--do-not-bill'
    case 'legacy':
      return 'monthly-location-testing-history-status-chip--legacy'
    default:
      return 'monthly-location-testing-history-status-chip--unset'
  }
}

function testingHistoryResultCellClass(
  cell: MonthCell | undefined,
  opts: { editing: boolean; editValue?: 'tested' | 'skipped' },
  isAnnualMonthRow: boolean
): string {
  if (isAnnualMonthRow) return 'monthly-location-testing-history-result--annual'
  if (opts.editing && opts.editValue) {
    return opts.editValue === 'tested'
      ? 'monthly-location-testing-history-result--tested'
      : 'monthly-location-testing-history-result--skipped'
  }
  if (!cell) return ''
  const n = historyMonthResultStatus(cell)
  if (n === 'tested') return 'monthly-location-testing-history-result--tested'
  if (n === 'skipped') return 'monthly-location-testing-history-result--skipped'
  return ''
}

function historyMonthHasRecordedTest(cell: MonthCell | undefined): boolean {
  return historyMonthResultStatus(cell) != null
}

function testingHistoryRouteContextLine(cell: MonthCell | undefined): ReactNode {
  if (!historyMonthHasRecordedTest(cell)) return null
  const tr = cell?.test_monthly_route
  if (!tr?.route_number) return null
  const dn = tr.display_name?.trim()
  const label = dn ? `R${tr.route_number} · ${dn}` : tr.label || `R${tr.route_number}`
  return (
    <div className="text-muted small mt-1" title="Route assignment when this month was recorded">
      Recorded on {label}
    </div>
  )
}

function locationStatusLabel(location: LibraryLocation): string {
  return (location.status_raw || location.status_normalized || '').replace(/_/g, ' ') || '—'
}

function normalizeStatusForSelect(value: string | null | undefined): string {
  const normalized = (value || '').trim().toLowerCase().replace(/\s+/g, '_')
  return STATUS_OPTIONS.some((option) => option.value === normalized) ? normalized : ''
}

function detailText(value: string | null | undefined): string {
  return value?.trim() || '—'
}

function MonthlyLocationIdentityHero({ location }: { location: LibraryLocation }) {
  const displayLabel = location.label?.trim() || ''
  const navAddress = (location.address || '').trim()
  const sameIdentity =
    displayLabel !== '' &&
    navAddress !== '' &&
    displayLabel.toLowerCase() === navAddress.toLowerCase()

  if (sameIdentity) {
    return (
      <div className="monthly-location-identity-display">
        <h1 className="monthly-location-detail-title">{displayLabel}</h1>
      </div>
    )
  }

  return (
    <div className="monthly-location-identity-display">
      {displayLabel ? (
        <div className="monthly-location-identity-block">
          <h1 className="monthly-location-detail-title">{displayLabel}</h1>
        </div>
      ) : null}
      {navAddress ? (
        <div
          className={`monthly-location-identity-block${
            displayLabel ? ' monthly-location-identity-block--sub' : ''
          }`}
        >
          <p
            className={
              displayLabel
                ? 'monthly-location-nav-address-line'
                : 'monthly-location-detail-title mb-0'
            }
          >
            {navAddress}
          </p>
        </div>
      ) : (
        <h1 className="monthly-location-detail-title">Untitled location</h1>
      )}
    </div>
  )
}

function DetailMetricCard({
  label,
  value,
  tone,
  onClick,
}: {
  label: string
  value: ReactNode
  tone?: 'success' | 'warning' | 'info'
  onClick?: () => void
}) {
  const className = `monthly-location-metric-card${tone ? ` monthly-location-metric-card--${tone}` : ''}${
    onClick ? ' monthly-location-metric-card--interactive' : ''
  }`

  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick}>
        <div className="monthly-location-metric-label">{label}</div>
        <div className="monthly-location-metric-value">{value}</div>
      </button>
    )
  }

  return (
    <div className={className}>
      <div className="monthly-location-metric-label">{label}</div>
      <div className="monthly-location-metric-value">{value}</div>
    </div>
  )
}

export default function MonthlyLocationDetailPage() {
  const { locationId } = useParams<{ locationId: string }>()
  const navigate = useNavigate()
  const [location, setLocation] = useState<LibraryLocation | null>(null)
  const [comments, setComments] = useState<MonthlyLocationComment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showStatusModal, setShowStatusModal] = useState(false)
  const [statusDraft, setStatusDraft] = useState('')
  const [statusSaving, setStatusSaving] = useState(false)
  const [statusSaveError, setStatusSaveError] = useState<string | null>(null)
  const [routeOptions, setRouteOptions] = useState<string[]>([])
  const [showRouteModal, setShowRouteModal] = useState(false)
  const [routeDraft, setRouteDraft] = useState('')
  const [routeSaving, setRouteSaving] = useState(false)
  const [routeSaveError, setRouteSaveError] = useState<string | null>(null)
  const [showStLinkEditModal, setShowStLinkEditModal] = useState(false)
  const [sessionUsername, setSessionUsername] = useState<string | null>(null)
  /** Selected calendar year for testing-history grid; ``null`` means “use default year” until user picks one. */
  const [historyViewYear, setHistoryViewYear] = useState<number | null>(null)
  const [historyFieldEdit, setHistoryFieldEdit] = useState<HistoryFieldEdit | null>(null)
  const [historySaving, setHistorySaving] = useState(false)
  const [historySaveError, setHistorySaveError] = useState<string | null>(null)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleteSaving, setDeleteSaving] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const idNum = locationId ? parseInt(locationId, 10) : NaN

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!locationId || Number.isNaN(idNum)) return
      setLoading(true)
      setError(null)
      try {
        const data = await apiJson<MonthlyLocationDetailPayload>(`/api/monthly_routes/library/${idNum}`, {
          signal,
        })
        if (signal?.aborted) return
        setLocation(data.location)
        setComments(data.comments || [])
        setRouteOptions(data.route_options ?? [])
      } catch (e) {
        if (isAbortError(e)) return
        setError('Unable to load this location.')
        setLocation(null)
        setComments([])
        setRouteOptions([])
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [locationId, idNum]
  )

  useEffect(() => {
    const c = new AbortController()
    void load(c.signal)
    return () => c.abort()
  }, [load])

  useEffect(() => {
    let active = true
    apiJson<{ username?: string | null }>('/api/auth/me')
      .then((d) => {
        if (active) setSessionUsername(typeof d.username === 'string' ? d.username : null)
      })
      .catch(() => {
        if (active) setSessionUsername(null)
      })
    return () => {
      active = false
    }
  }, [])

  const nextTestingMonthIso = useMemo(() => {
    if (!location?.months) return null
    return nextUntestedMonthIso(Object.keys(location.months))
  }, [location])

  const testingHistoryYears = useMemo(() => {
    if (!location?.months) return []
    return yearsWithTestingData(Object.keys(location.months), nextTestingMonthIso)
  }, [location?.months, nextTestingMonthIso])

  useEffect(() => {
    setHistoryViewYear(null)
  }, [locationId])

  const effectiveTestingHistoryYear = useMemo(() => {
    if (testingHistoryYears.length === 0) return null
    if (historyViewYear != null && testingHistoryYears.includes(historyViewYear)) return historyViewYear
    return defaultTestingHistoryYear(testingHistoryYears)
  }, [testingHistoryYears, historyViewYear])

  const cancelHistoryEdit = useCallback(() => {
    setHistoryFieldEdit(null)
    setHistorySaveError(null)
  }, [])

  const saveHistoryMonth = useCallback(
    async (
      monthIso: string,
      patch: { result_status?: 'tested' | 'skipped'; billing_status?: OfficeBillingStatus },
    ) => {
      if (!location) return
      const existing = location.months[monthIso]
      const monthBody: Record<string, unknown> = {}

      if (patch.result_status !== undefined) {
        monthBody.result_status = patch.result_status
        monthBody.skip_reason =
          patch.result_status === 'skipped' ? (existing?.skip_reason?.trim() || null) : null
        if (existing) {
          monthBody.billing_status = normalizeHistoryBillingStatus(existing.billing_status)
        }
      } else if (patch.billing_status !== undefined) {
        if (!existing) return
        monthBody.billing_status = patch.billing_status
        const rs = historyMonthResultStatus(existing)
        if (rs === 'tested') {
          monthBody.result_status = 'tested'
        } else if (rs === 'skipped') {
          monthBody.result_status = 'skipped'
          monthBody.skip_reason = existing.skip_reason?.trim() || null
        }
      } else {
        return
      }

      setHistorySaving(true)
      setHistorySaveError(null)
      try {
        const res = await apiJson<{ location: LibraryLocation }>(
          `/api/monthly_routes/library/${location.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ months: { [monthIso]: monthBody } }),
          },
        )
        setLocation(res.location)
        setHistoryFieldEdit(null)
      } catch (e) {
        const msg =
          typeof e === 'object' && e && 'error' in e ? String((e as { error: unknown }).error) : null
        setHistorySaveError(msg || 'Unable to save testing history.')
      } finally {
        setHistorySaving(false)
      }
    },
    [location],
  )

  const editableFieldsRef = useRef<MonthlyLocationEditableFieldsHandle>(null)

  const handleLocationUpdated = useCallback((updated: LibraryLocation) => {
    setLocation(updated)
    const routeId = updated.monthly_route?.id ?? updated.monthly_route_id ?? null
    if (routeId != null) notifyPaperworkMasterSiteUpdated(routeId)
  }, [])

  const openAnnualFieldEdit = useCallback(() => {
    editableFieldsRef.current?.beginFieldEdit('annual_month', { openSelect: true })
  }, [])

  const openStatusModal = useCallback(() => {
    if (!location) return
    setStatusDraft(
      normalizeStatusForSelect(location.status_raw) ||
        normalizeStatusForSelect(location.status_normalized)
    )
    setStatusSaveError(null)
    setShowStatusModal(true)
  }, [location])

  const closeStatusModal = useCallback(() => {
    if (statusSaving) return
    setShowStatusModal(false)
    setStatusSaveError(null)
  }, [statusSaving])

  const saveStatusEdit = useCallback(async () => {
    if (!location) return
    setStatusSaving(true)
    setStatusSaveError(null)
    try {
      const res = await apiJson<{ location: LibraryLocation }>(
        `/api/monthly_routes/library/${location.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ status_raw: statusDraft || null }),
        }
      )
      setLocation(res.location)
      setShowStatusModal(false)
    } catch (e) {
      const msg =
        typeof e === 'object' && e && 'error' in e ? String((e as { error: unknown }).error) : null
      setStatusSaveError(msg || 'Unable to save status.')
    } finally {
      setStatusSaving(false)
    }
  }, [location, statusDraft])

  const openRouteModal = useCallback(() => {
    if (!location) return
    setRouteDraft(location.test_day || '')
    setRouteSaveError(null)
    setShowRouteModal(true)
  }, [location])

  const closeRouteModal = useCallback(() => {
    if (routeSaving) return
    setShowRouteModal(false)
    setRouteSaveError(null)
  }, [routeSaving])

  const saveRouteEdit = useCallback(async () => {
    if (!location) return
    const prevRouteId = location.monthly_route?.id ?? location.monthly_route_id ?? null
    setRouteSaving(true)
    setRouteSaveError(null)
    try {
      const res = await apiJson<{ location: LibraryLocation }>(
        `/api/monthly_routes/library/${location.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ test_day: routeDraft }),
        }
      )
      setLocation(res.location)
      setShowRouteModal(false)
      const newRouteId = res.location.monthly_route?.id ?? res.location.monthly_route_id ?? null
      if (prevRouteId != null) notifyPaperworkMasterSiteUpdated(prevRouteId)
      if (newRouteId != null && newRouteId !== prevRouteId) {
        notifyPaperworkMasterSiteUpdated(newRouteId)
      }
    } catch (e) {
      const msg =
        typeof e === 'object' && e && 'error' in e ? String((e as { error: unknown }).error) : null
      setRouteSaveError(msg || 'Unable to save route assignment.')
    } finally {
      setRouteSaving(false)
    }
  }, [location, routeDraft])

  const locationDeleteLabel = useMemo(() => {
    if (!location) return 'this location'
    return location.label?.trim() || location.address?.trim() || `location #${location.id}`
  }, [location])

  const openDeleteModal = useCallback(() => {
    setDeleteError(null)
    setShowDeleteModal(true)
  }, [])

  const closeDeleteModal = useCallback(() => {
    if (deleteSaving) return
    setShowDeleteModal(false)
    setDeleteError(null)
  }, [deleteSaving])

  const confirmDeleteLocation = useCallback(async () => {
    if (!location) return
    const routeId = location.monthly_route?.id ?? location.monthly_route_id ?? null
    setDeleteSaving(true)
    setDeleteError(null)
    try {
      await apiJson(`/api/monthly_routes/library/${location.id}`, { method: 'DELETE' })
      if (routeId != null) notifyPaperworkMasterSiteUpdated(routeId)
      navigate('/monthlies/locations', { replace: true })
    } catch (e) {
      const msg =
        typeof e === 'object' && e && 'error' in e ? String((e as { error: unknown }).error) : null
      setDeleteError(msg || 'Unable to delete this location.')
    } finally {
      setDeleteSaving(false)
    }
  }, [location, navigate])

  useEffect(() => {
    if (!historyFieldEdit || historySaving) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') cancelHistoryEdit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [historyFieldEdit, historySaving, cancelHistoryEdit])

  if (!locationId || Number.isNaN(idNum)) {
    return (
      <div className="container py-4">
        <Alert variant="warning">Invalid location.</Alert>
        <Link to="/monthlies/locations">Back to Monthly Locations</Link>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="monthly-location-detail-page">
        <div className="monthly-location-detail-container monthly-location-detail-container--loading">
          <div className="monthly-location-detail-loading" role="status" aria-live="polite">
            <Spinner animation="border" />
            <span>Loading location…</span>
          </div>
        </div>
      </div>
    )
  }

  if (error || !location) {
    return (
      <div className="container py-4">
        <Alert variant="danger">{error || 'Location not found.'}</Alert>
        <Link to="/monthlies/locations">Back to Monthly Locations</Link>
      </div>
    )
  }

  const routeLabel = libraryRouteDisplay(location)
  const routeLabelText = routeLabel.trim() || 'Unassigned'
  const routeDetailId = location.monthly_route?.id ?? location.monthly_route_id ?? null
  const displayPrice = libraryDisplayPricePerMonth(location)
  const statusLabel = locationStatusLabel(location)
  const keyRecord = location.key
  const keyText = location.keys?.trim() || ''
  const keyValue =
    keyRecord != null ? (
      <Link to={`/keys/${keyRecord.id}`} className="fw-semibold text-decoration-none">
        {keyRecord.keycode}
      </Link>
    ) : (
      keyText || '—'
    )
  const routeValue =
    routeDetailId != null && routeLabel.trim() ? (
      <Link to={`/monthlies/routes/${routeDetailId}`} className="fw-semibold text-decoration-none">
        {routeLabelText}
      </Link>
    ) : (
      <span className="fw-semibold">{routeLabelText}</span>
    )
  const propertyManagementLabel = location.property_management_company?.trim() || '—'
  const annualTrimmed = location.annual_month?.trim() || ''
  const annualValue = annualTrimmed
    ? normalizeAnnualMonthForSelect(annualTrimmed) || annualTrimmed
    : '—'

  const testingHistoryGridYear =
    testingHistoryYears.length === 0
      ? null
      : (effectiveTestingHistoryYear ?? defaultTestingHistoryYear(testingHistoryYears))
  const testingHistoryYearIndex =
    testingHistoryGridYear != null ? testingHistoryYears.indexOf(testingHistoryGridYear) : -1

  const historyYearNavLocked = historySaving || historyFieldEdit != null

  return (
    <div className="monthly-location-detail-page">
      <div className="monthly-location-detail-container">
        <Link to="/monthlies/locations" className="monthly-location-back-link">
          <i className="bi bi-chevron-left" aria-hidden />
          Monthly locations
        </Link>

        <section className="monthly-location-detail-hero monthly-location-detail-surface">
          <div className="monthly-location-detail-hero-main">
            <div className="monthly-location-hero-topline">
              <span className="monthly-location-detail-eyebrow">Monthly location</span>
              <span className="monthly-location-hero-id">#{location.id}</span>
            </div>
            <MonthlyLocationIdentityHero location={location} />
            <div className="monthly-location-hero-meta">
              <Badge
                bg={statusBadgeVariant(location.status_normalized)}
                className="monthly-location-hero-meta-badge text-capitalize"
              >
                {statusLabel}
              </Badge>
              {routeDetailId != null && routeLabel.trim() ? (
                <Link
                  to={`/monthlies/routes/${routeDetailId}`}
                  className="monthly-location-hero-meta-link"
                >
                  <i className="bi bi-signpost-split" aria-hidden />
                  {routeLabelText}
                </Link>
              ) : (
                <span className="monthly-location-hero-meta-muted">{routeLabelText}</span>
              )}
              {propertyManagementLabel !== '—' ? (
                <span className="monthly-location-hero-meta-muted">
                  <i className="bi bi-building" aria-hidden />
                  {propertyManagementLabel}
                </span>
              ) : null}
            </div>
          </div>
          <div className="monthly-location-hero-actions">
            <Button
              type="button"
              variant="outline-secondary"
              size="sm"
              className="monthly-location-detail-action"
              onClick={openRouteModal}
            >
              <i className="bi bi-signpost-split" aria-hidden />
              Change route
            </Button>
            <Button
              type="button"
              variant="outline-secondary"
              size="sm"
              className="monthly-location-detail-action"
              onClick={openStatusModal}
            >
              <i className="bi bi-sliders" aria-hidden />
              Change status
            </Button>
            <MonthlyLocationServiceTradeHeroActions
              location={location}
              onEditLink={() => setShowStLinkEditModal(true)}
            />
            <ServiceTradeDeficienciesButton
              locationId={location.id}
              hasServiceTradeLink={location.service_trade_site_location_id != null}
              locationLabel={(location.label || location.address || '').trim() || undefined}
              className="monthly-location-detail-action"
            />
            <Button
              type="button"
              variant="outline-danger"
              size="sm"
              className="monthly-location-detail-action"
              disabled={
                deleteSaving ||
                statusSaving ||
                routeSaving ||
                historySaving
              }
              onClick={openDeleteModal}
            >
              <i className="bi bi-trash" aria-hidden />
              Delete location
            </Button>
          </div>
        </section>

        <div className="monthly-location-metric-grid" aria-label="Location summary">
          <DetailMetricCard
            label="Status"
            value={
              <Badge bg={statusBadgeVariant(location.status_normalized)} className="text-capitalize">
                {statusLabel}
              </Badge>
            }
            onClick={openStatusModal}
          />
          <DetailMetricCard label="Route" value={routeValue} />
          <DetailMetricCard label="Key" value={keyValue} />
          <DetailMetricCard
            label="Annual"
            value={annualValue}
            tone="info"
            onClick={openAnnualFieldEdit}
          />
          <DetailMetricCard
            label="Monthly Price"
            value={formatPriceCad(displayPrice)}
            tone="success"
          />
          <DetailMetricCard
            label="Start up date"
            value={detailText(location.start_up_date)}
          />
        </div>

        <MonthlyLocationKeyLinkPanel location={location} onLocationUpdated={handleLocationUpdated} />

        <MonthlyLocationServiceTradeLinkPanel
          location={location}
          onLocationUpdated={handleLocationUpdated}
        />

        <MonthlyLocationServiceTradeLinkEditModal
          show={showStLinkEditModal}
          location={location}
          onHide={() => setShowStLinkEditModal(false)}
          onLocationUpdated={handleLocationUpdated}
        />

        <Modal show={showStatusModal} onHide={closeStatusModal} centered size="sm">
          <Modal.Header closeButton={!statusSaving}>
            <Modal.Title>Edit status</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {statusSaveError ? (
              <Alert variant="danger" className="py-2 small">
                {statusSaveError}
              </Alert>
            ) : null}
            <Form.Group>
              <Form.Label>Status</Form.Label>
              <Form.Select
                value={statusDraft}
                disabled={statusSaving}
                onChange={(e) => setStatusDraft(e.target.value)}
              >
                <option value="">No status</option>
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button type="button" variant="outline-secondary" disabled={statusSaving} onClick={closeStatusModal}>
              Cancel
            </Button>
            <Button type="button" variant="primary" disabled={statusSaving} onClick={() => void saveStatusEdit()}>
              {statusSaving ? 'Saving…' : 'Save status'}
            </Button>
          </Modal.Footer>
        </Modal>

        <Modal show={showRouteModal} onHide={closeRouteModal} centered size="sm">
          <Modal.Header closeButton={!routeSaving}>
            <Modal.Title>Edit route</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {routeSaveError ? (
              <Alert variant="danger" className="py-2 small">
                {routeSaveError}
              </Alert>
            ) : null}
            <Form.Group>
              <Form.Label>Route assignment</Form.Label>
              <Form.Select
                value={routeDraft}
                disabled={routeSaving}
                onChange={(e) => setRouteDraft(e.target.value)}
              >
                <option value="">Unassigned</option>
                {routeOptions.map((route) => (
                  <option key={route} value={route}>
                    {route}
                  </option>
                ))}
                {!routeOptions.includes(routeDraft) && routeDraft ? (
                  <option value={routeDraft}>{routeDraft}</option>
                ) : null}
              </Form.Select>
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button type="button" variant="outline-secondary" disabled={routeSaving} onClick={closeRouteModal}>
              Cancel
            </Button>
            <Button type="button" variant="primary" disabled={routeSaving} onClick={() => void saveRouteEdit()}>
              {routeSaving ? 'Saving…' : 'Save route'}
            </Button>
          </Modal.Footer>
        </Modal>

        <Modal
          show={showDeleteModal}
          onHide={closeDeleteModal}
          centered
          backdrop={deleteSaving ? 'static' : true}
        >
          <Modal.Header closeButton={!deleteSaving}>
            <Modal.Title className="h6 mb-0">Delete this location?</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {deleteError ? (
              <Alert variant="danger" className="py-2 small">
                {deleteError}
              </Alert>
            ) : null}
            <p className="mb-2">
              Permanently delete <strong>{locationDeleteLabel}</strong> from the monthly library?
            </p>
            <p className="mb-0 small text-muted">
              This removes testing history, comments, deficiencies, tickets, and billing records for
              this site. It cannot be undone.
            </p>
          </Modal.Body>
          <Modal.Footer>
            <Button
              type="button"
              variant="outline-secondary"
              size="sm"
              disabled={deleteSaving}
              onClick={closeDeleteModal}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              size="sm"
              disabled={deleteSaving}
              onClick={() => void confirmDeleteLocation()}
            >
              {deleteSaving ? (
                <>
                  <Spinner animation="border" size="sm" className="me-1" aria-hidden />
                  Deleting…
                </>
              ) : (
                'Yes, delete location'
              )}
            </Button>
          </Modal.Footer>
        </Modal>

        <div className="monthly-location-detail-body">
          <div className="monthly-location-detail-body__primary">
            <section className="monthly-location-detail-panel monthly-location-details-panel">
              <header className="monthly-location-section-header">
                <div>
                  <h2 className="monthly-location-section-title">Location details</h2>
                </div>
              </header>
              <MonthlyLocationEditableFields
                ref={editableFieldsRef}
                location={location}
                onLocationUpdated={handleLocationUpdated}
              />
            </section>
          </div>

          <div className="monthly-location-detail-body__secondary">
            <Accordion defaultActiveKey="history" className="monthly-location-detail-accordion">
          <Accordion.Item
            eventKey="history"
            className="monthly-location-testing-history-card monthly-location-detail-surface"
          >
            <Accordion.Header className="monthly-location-testing-history-card-header">
              <span className="monthly-location-history-header">
                <span>Testing history</span>
                <span>{testingHistoryGridYear ?? 'No history'}</span>
              </span>
            </Accordion.Header>
            <Accordion.Body className="monthly-location-testing-history-body">
              {testingHistoryYears.length === 0 ? (
                <div className="monthly-location-empty-state">No monthly test outcomes recorded yet.</div>
              ) : (
                <div className="monthly-location-testing-history-compact-wrap">
                  <div className="monthly-location-testing-history-toolbar">
                    <Button
                      type="button"
                      variant="outline-secondary"
                      size="sm"
                      className="monthly-location-testing-history-year-nav-btn"
                      disabled={historyYearNavLocked || testingHistoryYearIndex <= 0}
                      onClick={() => {
                        if (testingHistoryYearIndex > 0) {
                          setHistoryViewYear(testingHistoryYears[testingHistoryYearIndex - 1])
                        }
                      }}
                    >
                      Previous year
                    </Button>
                    <span
                      className="fw-semibold px-1 tabular-nums"
                      aria-live="polite"
                      aria-label={`Testing history year ${testingHistoryGridYear ?? ''}`}
                    >
                      {testingHistoryGridYear}
                    </span>
                    <Button
                      type="button"
                      variant="outline-secondary"
                      size="sm"
                      className="monthly-location-testing-history-year-nav-btn"
                      disabled={
                        historyYearNavLocked ||
                        testingHistoryYearIndex < 0 ||
                        testingHistoryYearIndex >= testingHistoryYears.length - 1
                      }
                      onClick={() => {
                        if (
                          testingHistoryYearIndex >= 0 &&
                          testingHistoryYearIndex < testingHistoryYears.length - 1
                        ) {
                          setHistoryViewYear(testingHistoryYears[testingHistoryYearIndex + 1])
                        }
                      }}
                    >
                      Next year
                    </Button>
                  </div>
                  {historySaveError ? (
                    <Alert variant="danger" className="py-2 small mb-2">
                      {historySaveError}
                    </Alert>
                  ) : null}
                  <div
                    className="monthly-location-testing-history-grid"
                    role="list"
                    aria-label={`Testing history months for ${testingHistoryGridYear ?? ''}`}
                  >
                    {testingHistoryGridYear != null
                      ? monthIsoKeysForCalendarYear(testingHistoryGridYear).map((monthIso) => {
                          const cell = location.months[monthIso]
                          const testDayLabel = formatScheduledTestDay(monthIso, location)
                          const isNextSlot = !cell && monthIso === nextTestingMonthIso
                          const isAnnualMonthRow = isAnnualMonth(monthIso, location.annual_month)
                          const canEditMonth = isMonthlyTestingHistoryEditable(monthIso, location)
                          const billingStatus = normalizeHistoryBillingStatus(cell?.billing_status)
                          const billingLocked = billingStatus === 'legacy'
                          const resultValue = historyMonthResultStatus(cell) ?? ''
                          const showHistoryStatus = shouldShowTestingHistoryStatus(
                            monthIso,
                            nextTestingMonthIso,
                          )
                          const editingResult =
                            historyFieldEdit?.monthIso === monthIso &&
                            historyFieldEdit.field === 'result'
                          const editingBilling =
                            historyFieldEdit?.monthIso === monthIso &&
                            historyFieldEdit.field === 'billing'
                          const canEditHistoryFields =
                            showHistoryStatus && canEditMonth && !isAnnualMonthRow
                          const canEditResultField = canEditHistoryFields
                          const canEditBillingField =
                            canEditHistoryFields && cell != null && !billingLocked
                          const resultClass = showHistoryStatus
                            ? testingHistoryResultCellClass(
                                cell,
                                {
                                  editing: editingResult,
                                  editValue: editingResult
                                    ? resultValue || 'tested'
                                    : undefined,
                                },
                                isAnnualMonthRow
                              )
                            : isAnnualMonthRow
                              ? 'monthly-location-testing-history-result--annual'
                              : ''
                          const worksheetRouteId = testingHistoryWorksheetRouteId(cell, location)
                          const cardClass = [
                            'monthly-location-testing-history-month-card',
                            resultClass,
                            isNextSlot && !cell
                              ? 'monthly-location-testing-history-month-card--next'
                              : null,
                            !cell && !isNextSlot
                              ? 'monthly-location-testing-history-month-card--empty'
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' ')
                          const testedChipLabel = testedHistoryChipLabel(
                            cell,
                            isNextSlot,
                            isAnnualMonthRow,
                          )
                          const testedChipClass = testedHistoryChipClass(cell, isAnnualMonthRow)
                          const billingChipClass = billingHistoryChipClass(
                            cell ? billingStatus : 'unset',
                          )
                          const billingChipLabel = billingStatusLabel(
                            cell ? billingStatus : 'unset',
                          )
                          const monthSaving = historySaving

                          return (
                            <div key={monthIso} className={cardClass} role="listitem">
                              <div className="monthly-location-testing-history-month-topline">
                                <div
                                  className="monthly-location-testing-history-month-name"
                                  title={formatMonthHeading(monthIso)}
                                >
                                  {monthShortNameFromKey(monthIso)}
                                </div>
                                {worksheetRouteId != null ? (
                                  <Link
                                    className="monthly-location-testing-history-worksheet-link"
                                    to={`/monthlies/routes/${worksheetRouteId}/paperwork?month=${encodeURIComponent(monthIso)}`}
                                    title={`Open paperwork for ${formatMonthHeading(monthIso)}`}
                                  >
                                    Worksheet
                                  </Link>
                                ) : null}
                              </div>

                              {showHistoryStatus ? (
                                  <div className="monthly-location-testing-history-fields">
                                    <Form.Group className="mb-1">
                                      <Form.Label className="monthly-location-testing-history-field-label">
                                        Tested
                                      </Form.Label>
                                      {editingResult ? (
                                        <Form.Select
                                          size="sm"
                                          autoFocus
                                          value={resultValue}
                                          disabled={monthSaving}
                                          aria-label={`Test result for ${formatMonthHeading(monthIso)}`}
                                          onBlur={() => {
                                            if (!monthSaving) setHistoryFieldEdit(null)
                                          }}
                                          onChange={(e) => {
                                            const v = e.target.value
                                            if (v !== 'tested' && v !== 'skipped') return
                                            void saveHistoryMonth(monthIso, {
                                              result_status: v,
                                            })
                                          }}
                                        >
                                          {!resultValue ? (
                                            <option value="" disabled>
                                              Choose…
                                            </option>
                                          ) : null}
                                          <option value="tested">Tested</option>
                                          <option value="skipped">Skipped</option>
                                        </Form.Select>
                                      ) : canEditResultField ? (
                                        <button
                                          type="button"
                                          className={[
                                            'monthly-location-testing-history-status-chip',
                                            'monthly-location-testing-history-status-chip--button',
                                            testedChipClass,
                                          ]
                                            .filter(Boolean)
                                            .join(' ')}
                                          disabled={monthSaving}
                                          onClick={() => {
                                            if (monthSaving) return
                                            setHistorySaveError(null)
                                            setHistoryFieldEdit({ monthIso, field: 'result' })
                                          }}
                                        >
                                          {testedChipLabel}
                                        </button>
                                      ) : (
                                        <span
                                          className={[
                                            'monthly-location-testing-history-status-chip',
                                            testedChipClass,
                                          ]
                                            .filter(Boolean)
                                            .join(' ')}
                                        >
                                          {testedChipLabel}
                                        </span>
                                      )}
                                    </Form.Group>
                                    <Form.Group>
                                      <Form.Label className="monthly-location-testing-history-field-label">
                                        Billing
                                      </Form.Label>
                                      {editingBilling ? (
                                        <Form.Select
                                          size="sm"
                                          autoFocus
                                          value={billingStatus}
                                          disabled={monthSaving}
                                          aria-label={`Billing for ${formatMonthHeading(monthIso)}`}
                                          onBlur={() => {
                                            if (!monthSaving) setHistoryFieldEdit(null)
                                          }}
                                          onChange={(e) => {
                                            const next = normalizeHistoryBillingStatus(
                                              e.target.value,
                                            )
                                            if (next === 'legacy') return
                                            void saveHistoryMonth(monthIso, {
                                              billing_status: next,
                                            })
                                          }}
                                        >
                                          <option value="unset">Unset</option>
                                          <option value="bill">Bill</option>
                                          <option value="do_not_bill">Waive</option>
                                        </Form.Select>
                                      ) : canEditBillingField ? (
                                        <button
                                          type="button"
                                          className={[
                                            'monthly-location-testing-history-status-chip',
                                            'monthly-location-testing-history-status-chip--button',
                                            billingChipClass,
                                          ].join(' ')}
                                          disabled={monthSaving}
                                          onClick={() => {
                                            if (monthSaving) return
                                            setHistorySaveError(null)
                                            setHistoryFieldEdit({ monthIso, field: 'billing' })
                                          }}
                                        >
                                          {billingChipLabel}
                                        </button>
                                      ) : (
                                        <span
                                          className={[
                                            'monthly-location-testing-history-status-chip',
                                            billingChipClass,
                                          ].join(' ')}
                                        >
                                          {billingChipLabel}
                                        </span>
                                      )}
                                    </Form.Group>
                                  </div>
                              ) : null}
                              <div className="monthly-location-testing-history-month-meta">
                                {isNextSlot ? (
                                  <div>
                                    Next test{testDayLabel ? `: ${testDayLabel}` : ''}
                                  </div>
                                ) : null}
                                {testingHistoryRouteContextLine(cell)}
                              </div>
                            </div>
                          )
                        })
                      : null}
                  </div>
                </div>
              )}
            </Accordion.Body>
          </Accordion.Item>
        </Accordion>

            <section className="monthly-location-detail-panel monthly-location-billing-comments-panel">
              <header className="monthly-location-section-header">
                <div>
                  <h2 className="monthly-location-section-title">Billing comments</h2>
                </div>
              </header>
              {location ? (
                <MonthlyLocationBillingCommentsPanel
                  locationId={location.id}
                  billingComments={location.billing_comments}
                  onSaved={setLocation}
                />
              ) : null}
            </section>

            {location?.monthly_route_id ? (
              <section className="monthly-location-detail-panel monthly-location-tickets-panel">
                <header className="monthly-location-section-header">
                  <div>
                    <h2 className="monthly-location-section-title">Tickets</h2>
                    <p className="small text-muted mb-0">
                      Office follow-ups for this site (keys, monitoring, deficiencies, route changes).
                    </p>
                  </div>
                </header>
                <LocationTicketsPanel
                  routeId={location.monthly_route_id}
                  locationId={location.id}
                  locationLabel={(location.label || location.address || '').trim() || `Location ${location.id}`}
                  sessionUsername={sessionUsername}
                />
              </section>
            ) : null}

            <section className="monthly-location-detail-panel monthly-location-comments-panel">
              <header className="monthly-location-section-header">
                <div>
                  <h2 className="monthly-location-section-title">Comments</h2>
                </div>
              </header>
              <MonthlyLibraryCommentsPanel
                commentsApiPrefix={`/api/monthly_routes/library/${idNum}`}
                comments={comments}
                setComments={setComments}
                sessionUsername={sessionUsername}
                composerPlaceholder="Write a note for this location…"
              />
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
