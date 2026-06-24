import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Accordion, Alert, Button, Form, Modal, OverlayTrigger, Spinner, Table, Tooltip } from 'react-bootstrap'
import { Link, useNavigate, useParams } from 'react-router-dom'
import MonthlyLibraryCommentsPanel from '../features/monthlyRoutes/MonthlyLibraryCommentsPanel'
import MonthlyLocationBillingPanel from '../features/monthlyRoutes/MonthlyLocationBillingPanel'
import BillingBoardPaperworkModal, {
  type BillingBoardPaperworkModalContext,
} from '../features/monthlyRoutes/BillingBoardPaperworkModal'
import { billingBoardLocationTitle } from '../features/monthlyRoutes/locationDisplay'
import MonthlyLocationEditableFields, {
  type MonthlyLocationEditableFieldsHandle,
} from '../features/monthlyRoutes/MonthlyLocationEditableFields'
import MonthlyLocationDetailHero from '../features/monthlyRoutes/MonthlyLocationDetailHero'
import MonthlyLocationIdentityEditModal from '../features/monthlyRoutes/MonthlyLocationIdentityEditModal'
import MonthlyLocationServiceTradeLinkPanel, {
  MonthlyLocationServiceTradeLinkEditModal,
} from '../features/monthlyRoutes/MonthlyLocationServiceTradeLinkPanel'
import ServiceTradeDeficienciesModal from '../features/monthlyRoutes/ServiceTradeDeficienciesModal'
import { notifyPaperworkMasterSiteUpdated } from '../features/monthlyRoutes/paperworkMasterSync'
import {
  SITE_FIELD_SUBMISSION_NO_RUN_MESSAGE,
  SITE_FIELD_SUBMISSION_NO_SITE_ROW_MESSAGE,
} from '../features/monthlyRoutes/useSiteFieldSubmission'
import { billingStatusLabel } from '../features/monthlyRoutes/officeRunReviewShared'
import { formatSkipReasonDisplayText } from '../features/monthlyRoutes/portalWorkflowShared'
import {
  STATUS_OPTIONS,
  effectiveRouteTestDayIso,
  formatRouteTestDayLabel,
  isMonthlyTestingHistoryEditable,
  monthHasRecordedTestOutcome,
  nextUntestedMonthIso,
  parseYearMonth,
  shouldShowTestingHistoryStatus,
  siteUpcomingAnnualDue,
  testingHistoryChipLabel,
  testingHistoryIsNextSlot,
  testingHistoryShowRouteContext,
  toMonthKey,
  type AnnualScheduleCheckLocation,
  type AnnualScheduleCheckResponse,
  type LibraryLocation,
  type MonthCell,
  type MonthlyLocationComment,
  type MonthlyLocationDetailPayload,
  routeDisplayLabel,
} from '../features/monthlyRoutes/monthlyRoutesShared'
import { apiJson, isAbortError } from '../lib/apiClient'
import MonthlyLocationDetailPageSkeleton from './MonthlyLocationDetailPageSkeleton'

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

function monthShortNameFromKey(monthKey: string): string {
  const ym = parseYearMonth(monthKey)
  if (!ym) return monthKey
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(ym.year, ym.month - 1, 1)))
}

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

function testedHistoryChipClass(
  cell: MonthCell | undefined,
  annualDueOnSchedule: boolean,
  chipLabel: string,
): string {
  if (chipLabel === 'Annual' || annualDueOnSchedule) {
    return 'monthly-location-testing-history-status-chip--annual'
  }
  const rs = historyMonthResultStatus(cell)
  if (rs === 'tested') return 'monthly-location-testing-history-status-chip--tested'
  if (rs === 'skipped') return 'monthly-location-testing-history-status-chip--skipped'
  return ''
}

function testingHistorySkippedTooltip(chipLabel: string, cell: MonthCell | undefined): string | null {
  if (chipLabel !== 'Skipped') return null
  return formatSkipReasonDisplayText(cell?.skip_reason)
}

function wrapTestingHistoryResultChip(node: ReactNode, skipTooltip: string | null): ReactNode {
  if (!skipTooltip) return node
  return (
    <OverlayTrigger
      trigger={['hover', 'focus']}
      overlay={
        <Tooltip className="monthly-location-testing-history-skip-tooltip">{skipTooltip}</Tooltip>
      }
    >
      <span className="monthly-location-testing-history-skip-tooltip-wrap d-inline-flex">
        {node}
      </span>
    </OverlayTrigger>
  )
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
  annualDueOnSchedule: boolean,
): string {
  if (annualDueOnSchedule) return 'monthly-location-testing-history-result--annual'
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

function testingHistoryViewResultsInlineMessage(
  cell: MonthCell | undefined,
  monthIso: string,
  worksheetRouteId: number | null,
): string | null {
  if (worksheetRouteId == null || !cell) return null
  if (!monthHasRecordedTestOutcome(cell, monthIso)) return null
  if (cell.has_site_field_submission) return null
  if (cell.has_field_submission) return SITE_FIELD_SUBMISSION_NO_SITE_ROW_MESSAGE
  return SITE_FIELD_SUBMISSION_NO_RUN_MESSAGE
}

function testingHistoryCanViewResults(
  cell: MonthCell | undefined,
  worksheetRouteId: number | null,
): boolean {
  return worksheetRouteId != null && Boolean(cell?.has_site_field_submission)
}

function testingHistoryRouteContextLine(
  cell: MonthCell | undefined,
  monthIso: string,
): ReactNode {
  if (!testingHistoryShowRouteContext(cell, monthIso)) return null
  const tr = cell?.test_monthly_route
  if (!tr?.route_number) return null
  const label = routeDisplayLabel(tr)
  return (
    <div className="text-muted small mt-1" title="Route assignment when this month was recorded">
      Recorded on {label}
    </div>
  )
}

function normalizeStatusForSelect(value: string | null | undefined): string {
  const normalized = (value || '').trim().toLowerCase().replace(/\s+/g, '_')
  return STATUS_OPTIONS.some((option) => option.value === normalized) ? normalized : ''
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
  const [showStDeficienciesModal, setShowStDeficienciesModal] = useState(false)
  const [showIdentityEditModal, setShowIdentityEditModal] = useState(false)
  const [sessionUsername, setSessionUsername] = useState<string | null>(null)
  /** Selected calendar year for testing-history grid; ``null`` means “use default year” until user picks one. */
  const [historyViewYear, setHistoryViewYear] = useState<number | null>(null)
  const [historyFieldEdit, setHistoryFieldEdit] = useState<HistoryFieldEdit | null>(null)
  const [historySaving, setHistorySaving] = useState(false)
  const [historySaveError, setHistorySaveError] = useState<string | null>(null)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleteSaving, setDeleteSaving] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [viewResultsModalContext, setViewResultsModalContext] =
    useState<BillingBoardPaperworkModalContext | null>(null)
  const [annualScheduleByMonth, setAnnualScheduleByMonth] = useState<
    Record<string, AnnualScheduleCheckLocation | null>
  >({})
  const [savedAnnualMonthLabel, setSavedAnnualMonthLabel] = useState<string | null>(null)
  const [savedAnnualMonthSyncing, setSavedAnnualMonthSyncing] = useState(false)

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
    return nextUntestedMonthIso(location.months, new Date())
  }, [location])

  useEffect(() => {
    if (!locationId || Number.isNaN(idNum) || !location) {
      setSavedAnnualMonthLabel(null)
      setSavedAnnualMonthSyncing(false)
      return
    }

    const ac = new AbortController()
    setSavedAnnualMonthSyncing(true)
    void (async () => {
      try {
        const data = await apiJson<{
          saved_annual_month?: string | null
        }>(`/api/monthly_routes/library/${idNum}/saved_annual_month?sync=1`, {
          signal: ac.signal,
        })
        if (ac.signal.aborted) return
        const label = data.saved_annual_month?.trim() || null
        setSavedAnnualMonthLabel(label)
      } catch (e) {
        if (isAbortError(e)) return
        if (!ac.signal.aborted) setSavedAnnualMonthLabel(null)
      } finally {
        if (!ac.signal.aborted) setSavedAnnualMonthSyncing(false)
      }
    })()

    return () => ac.abort()
  }, [location, locationId, idNum])

  useEffect(() => {
    const routeId = location?.monthly_route?.id ?? location?.monthly_route_id ?? null
    const monthIso = nextTestingMonthIso
    if (routeId == null || monthIso == null || !location) {
      setAnnualScheduleByMonth({})
      return
    }

    const ac = new AbortController()
    void (async () => {
      try {
        const data = await apiJson<AnnualScheduleCheckResponse>(
          `/api/monthly_routes/routes/${routeId}/runs/annual_schedule_check?month_date=${encodeURIComponent(monthIso)}&sync=1`,
          { signal: ac.signal },
        )
        if (ac.signal.aborted) return
        const row = data.locations?.[String(location.id)] ?? null
        setAnnualScheduleByMonth({ [monthIso]: row })
      } catch (e) {
        if (isAbortError(e)) return
        if (!ac.signal.aborted) setAnnualScheduleByMonth({ [monthIso]: null })
      }
    })()

    return () => ac.abort()
  }, [location, nextTestingMonthIso])

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
    return <MonthlyLocationDetailPageSkeleton />
  }

  if (error || !location) {
    return (
      <div className="container py-4">
        <Alert variant="danger">{error || 'Location not found.'}</Alert>
        <Link to="/monthlies/locations">Back to Monthly Locations</Link>
      </div>
    )
  }

  const serviceTradeLinkedUrl = location.service_trade_site_location_url?.trim() || null
  const hasServiceTradeLink = location.service_trade_site_location_id != null
  const heroActionsBusy = deleteSaving || statusSaving || routeSaving || historySaving

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

        <MonthlyLocationDetailHero
          location={location}
          heroActionsBusy={heroActionsBusy}
          serviceTradeLinkedUrl={serviceTradeLinkedUrl}
          hasServiceTradeLink={hasServiceTradeLink}
          savedAnnualMonthLabel={savedAnnualMonthLabel}
          savedAnnualMonthSyncing={savedAnnualMonthSyncing}
          onOpenStatusModal={openStatusModal}
          onOpenIdentityEdit={() => setShowIdentityEditModal(true)}
          onOpenRouteModal={openRouteModal}
          onOpenDeleteModal={openDeleteModal}
          onOpenStDeficiencies={() => setShowStDeficienciesModal(true)}
          onOpenStLinkEdit={() => setShowStLinkEditModal(true)}
          onLocationUpdated={handleLocationUpdated}
          sessionUsername={sessionUsername}
        />

        <MonthlyLocationIdentityEditModal
          show={showIdentityEditModal}
          location={location}
          onHide={() => setShowIdentityEditModal(false)}
          onLocationUpdated={handleLocationUpdated}
        />

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

        {hasServiceTradeLink ? (
          <ServiceTradeDeficienciesModal
            show={showStDeficienciesModal}
            onHide={() => setShowStDeficienciesModal(false)}
            locationId={location.id}
            locationLabel={(location.label || location.address || '').trim() || undefined}
          />
        ) : null}

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
          <Accordion
            defaultActiveKey={[]}
            alwaysOpen
            className="monthly-location-detail-accordion"
          >
            <Accordion.Item
              eventKey="technician"
              className="monthly-location-detail-section monthly-location-technician-details-panel monthly-location-details-panel monthly-location-detail-surface"
            >
              <Accordion.Header className="monthly-location-detail-section-header">
                <span className="monthly-location-section-accordion-title">Technician details</span>
              </Accordion.Header>
              <Accordion.Body className="monthly-location-detail-section-body">
                <MonthlyLocationEditableFields
                  ref={editableFieldsRef}
                  location={location}
                  onLocationUpdated={handleLocationUpdated}
                />
              </Accordion.Body>
            </Accordion.Item>

            <Accordion.Item
              eventKey="billing"
              className="monthly-location-detail-section monthly-location-billing-panel-section monthly-location-detail-surface"
            >
              <Accordion.Header className="monthly-location-detail-section-header">
                <span className="monthly-location-section-accordion-title">Billing</span>
              </Accordion.Header>
              <Accordion.Body className="monthly-location-detail-section-body">
                {location ? (
                  <MonthlyLocationBillingPanel location={location} onLocationUpdated={setLocation} />
                ) : null}
              </Accordion.Body>
            </Accordion.Item>

            <Accordion.Item
              eventKey="history"
              className="monthly-location-detail-section monthly-location-testing-history-card monthly-location-detail-surface"
            >
              <Accordion.Header className="monthly-location-detail-section-header monthly-location-testing-history-card-header">
                <span className="monthly-location-history-header">
                  <span className="monthly-location-section-accordion-title">Testing history</span>
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
                  <div className="monthly-location-testing-history-table-wrap">
                    <Table
                      className="monthly-location-testing-history-table align-middle mb-0"
                      aria-label={`Testing history months for ${testingHistoryGridYear ?? ''}`}
                    >
                      <colgroup>
                        <col className="monthly-location-testing-history-table__month-col" />
                        <col className="monthly-location-testing-history-table__tested-col" />
                        <col className="monthly-location-testing-history-table__billing-col" />
                        <col className="monthly-location-testing-history-table__details-col" />
                      </colgroup>
                      <thead>
                        <tr>
                          <th scope="col">Month</th>
                          <th scope="col">Tested</th>
                          <th scope="col">Billing</th>
                          <th scope="col">Details</th>
                        </tr>
                      </thead>
                      <tbody>
                    {testingHistoryGridYear != null
                      ? monthIsoKeysForCalendarYear(testingHistoryGridYear).map((monthIso) => {
                          const cell = location.months[monthIso]
                          const testDayLabel = formatScheduledTestDay(monthIso, location)
                          const isNextSlot = testingHistoryIsNextSlot(
                            monthIso,
                            nextTestingMonthIso,
                            cell,
                          )
                          const annualDueOnSchedule = siteUpcomingAnnualDue(
                            monthIso,
                            annualScheduleByMonth[monthIso] ?? null,
                          )
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
                          const canEditHistoryBase = showHistoryStatus && canEditMonth
                          const canEditResultField =
                            canEditHistoryBase && !(isNextSlot && annualDueOnSchedule)
                          const canEditBillingField =
                            canEditHistoryBase && cell != null && !billingLocked
                          const resultClass = showHistoryStatus
                            ? testingHistoryResultCellClass(
                                cell,
                                {
                                  editing: editingResult,
                                  editValue: editingResult
                                    ? resultValue || 'tested'
                                    : undefined,
                                },
                                isNextSlot && annualDueOnSchedule,
                              )
                            : isNextSlot && annualDueOnSchedule
                              ? 'monthly-location-testing-history-result--annual'
                              : ''
                          const worksheetRouteId = testingHistoryWorksheetRouteId(cell, location)
                          const canViewResults = testingHistoryCanViewResults(cell, worksheetRouteId)
                          const viewResultsInlineMessage = testingHistoryViewResultsInlineMessage(
                            cell,
                            monthIso,
                            worksheetRouteId,
                          )
                          const rowClass = [
                            'monthly-location-testing-history-row',
                            resultClass,
                            isNextSlot ? 'monthly-location-testing-history-row--next' : null,
                            !cell && !isNextSlot
                              ? 'monthly-location-testing-history-row--empty'
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' ')
                          const testedChipLabel = testingHistoryChipLabel(cell, monthIso, {
                            isNextSlot,
                            annualDueOnSchedule,
                          })
                          const testedChipClass = testedHistoryChipClass(
                            cell,
                            isNextSlot && annualDueOnSchedule,
                            testedChipLabel,
                          )
                          const skippedTooltip = testingHistorySkippedTooltip(testedChipLabel, cell)
                          const billingChipClass = billingHistoryChipClass(
                            cell ? billingStatus : 'unset',
                          )
                          const billingChipLabel = billingStatusLabel(
                            cell ? billingStatus : 'unset',
                          )
                          const monthSaving = historySaving

                          return (
                            <tr key={monthIso} className={rowClass}>
                              <td className="monthly-location-testing-history-table__month-col">
                                <span
                                  className="monthly-location-testing-history-month-name"
                                  title={formatMonthHeading(monthIso)}
                                >
                                  {monthShortNameFromKey(monthIso)}
                                </span>
                              </td>

                              <td className="monthly-location-testing-history-table__tested-col">
                                {showHistoryStatus ? (
                                  editingResult ? (
                                    <Form.Select
                                      size="sm"
                                      autoFocus
                                      className="monthly-location-testing-history-row-select"
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
                                    wrapTestingHistoryResultChip(
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
                                        aria-label={
                                          skippedTooltip
                                            ? `Skipped: ${skippedTooltip}. Edit test result for ${formatMonthHeading(monthIso)}.`
                                            : `Edit test result for ${formatMonthHeading(monthIso)}`
                                        }
                                        onClick={() => {
                                          if (monthSaving) return
                                          setHistorySaveError(null)
                                          setHistoryFieldEdit({ monthIso, field: 'result' })
                                        }}
                                      >
                                        {testedChipLabel}
                                      </button>,
                                      skippedTooltip,
                                    )
                                  ) : (
                                    wrapTestingHistoryResultChip(
                                      <span
                                        className={[
                                          'monthly-location-testing-history-status-chip',
                                          testedChipClass,
                                        ]
                                          .filter(Boolean)
                                          .join(' ')}
                                      >
                                        {testedChipLabel}
                                      </span>,
                                      skippedTooltip,
                                    )
                                  )
                                ) : (
                                  <span className="monthly-location-testing-history-row-empty">—</span>
                                )}
                              </td>

                              <td className="monthly-location-testing-history-table__billing-col">
                                {showHistoryStatus ? (
                                  editingBilling ? (
                                    <Form.Select
                                      size="sm"
                                      autoFocus
                                      className="monthly-location-testing-history-row-select"
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
                                  )
                                ) : (
                                  <span className="monthly-location-testing-history-row-empty">—</span>
                                )}
                              </td>

                              <td className="monthly-location-testing-history-table__details-col">
                                <div className="monthly-location-testing-history-row-meta">
                                  {canViewResults ? (
                                    <button
                                      type="button"
                                      className="monthly-location-testing-history-view-results-btn"
                                      title={`View test results for ${formatMonthHeading(monthIso)}`}
                                      onClick={() => {
                                        if (worksheetRouteId == null) return
                                        setViewResultsModalContext({
                                          locationId: location.id,
                                          locationLabel: billingBoardLocationTitle({
                                            building: location.building_name,
                                            label: location.label,
                                          }),
                                          monthIso,
                                          routeId: worksheetRouteId,
                                          billingStatus: billingStatus === 'legacy' ? 'legacy' : billingStatus,
                                        })
                                      }}
                                    >
                                      View results
                                    </button>
                                  ) : viewResultsInlineMessage ? (
                                    <span className="monthly-location-testing-history-no-results">
                                      {viewResultsInlineMessage}
                                    </span>
                                  ) : null}
                                  {isNextSlot ? (
                                    <span className="monthly-location-testing-history-row-next">
                                      Next test{testDayLabel ? `: ${testDayLabel}` : ''}
                                    </span>
                                  ) : null}
                                  {testingHistoryRouteContextLine(cell, monthIso)}
                                </div>
                              </td>
                            </tr>
                          )
                        })
                      : null}
                      </tbody>
                    </Table>
                  </div>
                </div>
              )}
            </Accordion.Body>
            </Accordion.Item>

            <Accordion.Item
              eventKey="comments"
              className="monthly-location-detail-section monthly-location-comments-panel monthly-location-comments-card monthly-location-detail-surface"
            >
              <Accordion.Header className="monthly-location-detail-section-header">
                <span className="monthly-location-section-accordion-title">Comments</span>
              </Accordion.Header>
              <Accordion.Body className="monthly-location-detail-section-body monthly-location-comments-body">
                <MonthlyLibraryCommentsPanel
                  commentsApiPrefix={`/api/monthly_routes/library/${idNum}`}
                  comments={comments}
                  setComments={setComments}
                  sessionUsername={sessionUsername}
                  composerPlaceholder="Write a note for this location…"
                />
              </Accordion.Body>
            </Accordion.Item>
          </Accordion>
        </div>
      </div>

      <BillingBoardPaperworkModal
        show={viewResultsModalContext != null}
        context={viewResultsModalContext}
        onHide={() => setViewResultsModalContext(null)}
      />
    </div>
  )
}
