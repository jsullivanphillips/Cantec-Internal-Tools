import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { CSSProperties, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Accordion, Alert, Badge, Button, Form, Modal, Spinner } from 'react-bootstrap'
import { Link, useParams } from 'react-router-dom'
import MonthlyLibraryCommentsPanel from '../features/monthlyRoutes/MonthlyLibraryCommentsPanel'
import MonthlyLocationBillingCommentsPanel from '../features/monthlyRoutes/MonthlyLocationBillingCommentsPanel'
import TestingSiteFieldsSection from '../features/monthlyRoutes/TestingSiteFieldsSection'
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
  sortedTestingSites,
  testingSitePayloadFromEditForm,
  toMonthKey,
  type TestingSiteEditForm,
  type TestingSiteSummary,
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

type HistoryEdit = { kind: 'skip_reason'; monthIso: string; value: string }

type HistoryFieldEdit = { monthIso: string; field: 'result' | 'billing' }

type OfficeBillingStatus = 'bill' | 'do_not_bill' | 'unset' | 'legacy'

function normalizeHistoryBillingStatus(raw: string | null | undefined): OfficeBillingStatus {
  const s = (raw || '').trim().toLowerCase()
  if (s === 'bill' || s === 'do_not_bill' || s === 'legacy') return s
  return 'unset'
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

function DetailMetricCard({
  label,
  value,
  tone,
}: {
  label: string
  value: ReactNode
  tone?: 'success' | 'warning' | 'info'
}) {
  return (
    <div className={`monthly-location-metric-card${tone ? ` monthly-location-metric-card--${tone}` : ''}`}>
      <div className="monthly-location-metric-label">{label}</div>
      <div className="monthly-location-metric-value">{value}</div>
    </div>
  )
}

function SortableTestingSiteCard({
  site,
  index,
  total,
  location,
  defaultExpanded,
  orderSaving,
  deleting,
  onInlineSave,
  onDelete,
}: {
  site: TestingSiteSummary
  index: number
  total: number
  location: LibraryLocation
  defaultExpanded: boolean
  orderSaving: boolean
  deleting: boolean
  onInlineSave: (form: TestingSiteEditForm) => Promise<void> | void
  onDelete: (site: TestingSiteSummary) => Promise<void> | void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: site.id,
    disabled: orderSaving || total <= 1,
  })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.72 : undefined,
  }
  const label = site.label?.trim() || `Testing location ${index + 1}`

  return (
    <div ref={setNodeRef} style={style} className="monthly-location-testing-site-sortable">
      {total > 1 ? (
        <button
          type="button"
          className="monthly-location-testing-site-drag-handle"
          disabled={orderSaving}
          aria-label={`Drag to reorder ${label}`}
          {...attributes}
          {...listeners}
        >
          <i className="bi bi-grip-vertical" aria-hidden />
          <span>Drag to reorder</span>
        </button>
      ) : null}
      <TestingSiteFieldsSection
        mode="inline"
        site={site}
        index={index}
        total={total}
        location={location}
        collapsible
        defaultExpanded={defaultExpanded}
        onInlineSave={onInlineSave}
        onDelete={onDelete}
        deleting={deleting}
      />
    </div>
  )
}

export default function MonthlyLocationDetailPage() {
  const { locationId } = useParams<{ locationId: string }>()
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
  const [showAddressModal, setShowAddressModal] = useState(false)
  const [addressDraft, setAddressDraft] = useState('')
  const [addressSaving, setAddressSaving] = useState(false)
  const [addressSaveError, setAddressSaveError] = useState<string | null>(null)
  const [sessionUsername, setSessionUsername] = useState<string | null>(null)
  const [addingTestingSite, setAddingTestingSite] = useState(false)
  const [addTestingSiteError, setAddTestingSiteError] = useState<string | null>(null)
  const [lastAddedTestingSiteId, setLastAddedTestingSiteId] = useState<number | null>(null)
  const [deletingTestingSiteId, setDeletingTestingSiteId] = useState<number | null>(null)
  const [testingSiteOrderSaving, setTestingSiteOrderSaving] = useState(false)
  /** Selected calendar year for testing-history grid; ``null`` means “use default year” until user picks one. */
  const [historyViewYear, setHistoryViewYear] = useState<number | null>(null)
  const [historyEdit, setHistoryEdit] = useState<HistoryEdit | null>(null)
  const [historyFieldEdit, setHistoryFieldEdit] = useState<HistoryFieldEdit | null>(null)
  const [historySaving, setHistorySaving] = useState(false)
  const [historySaveError, setHistorySaveError] = useState<string | null>(null)

  const idNum = locationId ? parseInt(locationId, 10) : NaN

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!locationId || Number.isNaN(idNum)) return
      setLoading(true)
      setError(null)
      try {
        const data = await apiJson<MonthlyLocationDetailPayload>(`/api/monthly_sites/library/${idNum}`, {
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
    setLastAddedTestingSiteId(null)
    setAddTestingSiteError(null)
  }, [locationId])

  const effectiveTestingHistoryYear = useMemo(() => {
    if (testingHistoryYears.length === 0) return null
    if (historyViewYear != null && testingHistoryYears.includes(historyViewYear)) return historyViewYear
    return defaultTestingHistoryYear(testingHistoryYears)
  }, [testingHistoryYears, historyViewYear])

  const cancelHistoryEdit = useCallback(() => {
    setHistoryEdit(null)
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
          `/api/monthly_sites/library/${location.id}`,
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

  const saveHistorySkipEdit = useCallback(async () => {
    if (!location || !historyEdit || historyEdit.kind !== 'skip_reason') return
    const { monthIso, value } = historyEdit
    const existing = location.months[monthIso]
    if (!existing) return

    setHistorySaving(true)
    setHistorySaveError(null)
    try {
      const res = await apiJson<{ location: LibraryLocation }>(
        `/api/monthly_sites/library/${location.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            months: {
              [monthIso]: {
                result_status: 'skipped',
                skip_reason: value.trim() || null,
              },
            },
          }),
        }
      )
      setLocation(res.location)
      cancelHistoryEdit()
    } catch (e) {
      const msg =
        typeof e === 'object' && e && 'error' in e ? String((e as { error: unknown }).error) : null
      setHistorySaveError(msg || 'Unable to save skip reason.')
    } finally {
      setHistorySaving(false)
    }
  }, [location, historyEdit, cancelHistoryEdit])

  const saveTestingSiteForm = useCallback(
    async (form: TestingSiteEditForm) => {
      const res = await apiJson<{ testing_site: TestingSiteSummary }>(
        `/api/monthly_sites/testing_sites/${form.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify(testingSitePayloadFromEditForm(form)),
        }
      )

      setLocation((prev) => {
        if (!prev) return prev
        const nextSites = sortedTestingSites(prev).map((site) =>
          site.id === res.testing_site.id ? res.testing_site : site
        )
        const pricedSites = nextSites.filter((site) => site.price_per_month != null)
        const rollup =
          pricedSites.length > 0
            ? pricedSites.reduce((sum, site) => sum + (site.price_per_month ?? 0), 0)
            : null

        const routeId = prev.monthly_route?.id ?? prev.monthly_route_id ?? null
        if (routeId != null) notifyPaperworkMasterSiteUpdated(routeId)

        return {
          ...prev,
          monthly_site_id: res.testing_site.monthly_site_id,
          testing_sites: nextSites,
          rollup_price_per_month: rollup,
        }
      })
    },
    []
  )

  const testingSiteOrderSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const persistTestingSiteOrder = useCallback(
    async (nextSites: TestingSiteSummary[]) => {
      if (!location) return
      setTestingSiteOrderSaving(true)
      setAddTestingSiteError(null)
      try {
        const res = await apiJson<{ testing_sites: TestingSiteSummary[] }>(
          `/api/monthly_sites/library/${location.id}/testing_sites/order`,
          {
            method: 'PUT',
            body: JSON.stringify({ ordered_testing_site_ids: nextSites.map((site) => site.id) }),
          }
        )

        setLocation((prev) => {
          if (!prev) return prev
          const ordered = sortedTestingSites({
            ...prev,
            testing_sites: res.testing_sites ?? nextSites,
          })
          const pricedSites = ordered.filter((site) => site.price_per_month != null)
          const rollup =
            pricedSites.length > 0
              ? pricedSites.reduce((sum, site) => sum + (site.price_per_month ?? 0), 0)
              : null

          return {
            ...prev,
            testing_sites: ordered,
            rollup_price_per_month: rollup,
          }
        })
      } catch {
        setAddTestingSiteError('Unable to save testing site order.')
        void load()
      } finally {
        setTestingSiteOrderSaving(false)
      }
    },
    [load, location]
  )

  const handleTestingSiteDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (!location || testingSiteOrderSaving) return
      const { active, over } = event
      if (!over || active.id === over.id) return
      const activeId = Number(active.id)
      const overId = Number(over.id)
      if (!Number.isFinite(activeId) || !Number.isFinite(overId)) return

      const currentSites = sortedTestingSites(location)
      const oldIndex = currentSites.findIndex((site) => site.id === activeId)
      const newIndex = currentSites.findIndex((site) => site.id === overId)
      if (oldIndex < 0 || newIndex < 0) return

      const nextSites = arrayMove(currentSites, oldIndex, newIndex).map((site, index) => ({
        ...site,
        sort_order: index,
      }))
      setLocation((prev) => (prev ? { ...prev, testing_sites: nextSites } : prev))
      void persistTestingSiteOrder(nextSites)
    },
    [location, persistTestingSiteOrder, testingSiteOrderSaving]
  )

  const addTestingSite = useCallback(async () => {
    if (!location) return

    const nextLabel = `Testing location ${sortedTestingSites(location).length + 1}`
    setAddingTestingSite(true)
    setAddTestingSiteError(null)
    try {
      const res = await apiJson<{ testing_site: TestingSiteSummary }>(
        `/api/monthly_sites/library/${location.id}/testing_sites`,
        {
          method: 'POST',
          body: JSON.stringify({ label: nextLabel }),
        }
      )

      setLocation((prev) => {
        if (!prev) return prev
        const nextSites = sortedTestingSites({
          ...prev,
          testing_sites: [...(prev.testing_sites ?? []), res.testing_site],
        })
        const pricedSites = nextSites.filter((site) => site.price_per_month != null)
        const rollup =
          pricedSites.length > 0
            ? pricedSites.reduce((sum, site) => sum + (site.price_per_month ?? 0), 0)
            : null

        return {
          ...prev,
          monthly_site_id: res.testing_site.monthly_site_id,
          testing_sites: nextSites,
          rollup_price_per_month: rollup,
        }
      })
      setLastAddedTestingSiteId(res.testing_site.id)
    } catch (e) {
      const msg =
        typeof e === 'object' && e && 'error' in e ? String((e as { error: unknown }).error) : null
      setAddTestingSiteError(msg || 'Unable to add testing site.')
    } finally {
      setAddingTestingSite(false)
    }
  }, [location])

  const deleteTestingSite = useCallback(async (site: TestingSiteSummary) => {
    if (!location) return
    const currentSites = sortedTestingSites(location)
    if (currentSites.length <= 1) return

    const siteIndex = currentSites.findIndex((existing) => existing.id === site.id)
    const label = site.label?.trim() || `testing location ${siteIndex >= 0 ? siteIndex + 1 : ''}`.trim()
    const confirmed = window.confirm(`Remove ${label}? This cannot be undone.`)
    if (!confirmed) return

    setDeletingTestingSiteId(site.id)
    setAddTestingSiteError(null)
    try {
      await apiJson<void>(`/api/monthly_sites/testing_sites/${site.id}`, {
        method: 'DELETE',
      })

      setLocation((prev) => {
        if (!prev) return prev
        const nextSites = sortedTestingSites({
          ...prev,
          testing_sites: (prev.testing_sites ?? []).filter((existing) => existing.id !== site.id),
        })
        const pricedSites = nextSites.filter((existing) => existing.price_per_month != null)
        const rollup =
          pricedSites.length > 0
            ? pricedSites.reduce((sum, existing) => sum + (existing.price_per_month ?? 0), 0)
            : null

        return {
          ...prev,
          testing_sites: nextSites,
          rollup_price_per_month: rollup,
        }
      })
      if (lastAddedTestingSiteId === site.id) {
        setLastAddedTestingSiteId(null)
      }
    } catch (e) {
      const msg =
        typeof e === 'object' && e && 'error' in e ? String((e as { error: unknown }).error) : null
      setAddTestingSiteError(msg || 'Unable to remove testing site.')
    } finally {
      setDeletingTestingSiteId(null)
    }
  }, [lastAddedTestingSiteId, location])

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
        `/api/monthly_sites/library/${location.id}`,
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
        `/api/monthly_sites/library/${location.id}`,
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

  const openAddressModal = useCallback(() => {
    if (!location) return
    setAddressDraft(location.address || '')
    setAddressSaveError(null)
    setShowAddressModal(true)
  }, [location])

  const closeAddressModal = useCallback(() => {
    if (addressSaving) return
    setShowAddressModal(false)
    setAddressSaveError(null)
  }, [addressSaving])

  const saveAddressEdit = useCallback(async () => {
    if (!location) return
    const trimmed = addressDraft.trim()
    if (!trimmed) {
      setAddressSaveError('Address is required.')
      return
    }
    setAddressSaving(true)
    setAddressSaveError(null)
    try {
      const res = await apiJson<{ location: LibraryLocation }>(
        `/api/monthly_sites/library/${location.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ address: trimmed }),
        }
      )
      setLocation(res.location)
      setShowAddressModal(false)
    } catch (e) {
      const msg =
        typeof e === 'object' && e && 'error' in e ? String((e as { error: unknown }).error) : null
      setAddressSaveError(msg || 'Unable to save address.')
    } finally {
      setAddressSaving(false)
    }
  }, [location, addressDraft])

  useEffect(() => {
    if ((!historyEdit && !historyFieldEdit) || historySaving) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') cancelHistoryEdit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [historyEdit, historyFieldEdit, historySaving, cancelHistoryEdit])

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
      <div className="d-flex justify-content-center align-items-center py-5">
        <Spinner animation="border" role="status">
          <span className="visually-hidden">Loading…</span>
        </Spinner>
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
  const testingSites = sortedTestingSites(location)
  const primaryStop = testingSites[0]
  const buildingLabel =
    primaryStop?.building_name?.trim() || location.building?.trim() || ''
  const title =
    buildingLabel !== '' ? `${location.address} (${buildingLabel})` : location.address
  const displayPrice = libraryDisplayPricePerMonth(location)
  const statusLabel = locationStatusLabel(location)
  const keyRecord = primaryStop?.key ?? location.key
  const keyText = primaryStop?.keys?.trim() || location.keys?.trim() || ''
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
  const propertyManagementLabel =
    primaryStop?.property_management_company?.trim() ||
    location.property_management_company?.trim() ||
    '—'
  const annualMonthValues = Array.from(
    new Set(
      [
        ...testingSites.map((site) => site.annual_month),
        location.annual_month,
      ]
        .map((value) => {
          const trimmed = value?.trim() || ''
          return trimmed ? normalizeAnnualMonthForSelect(trimmed) || trimmed : ''
        })
        .filter(Boolean)
    )
  )
  const annualValue = annualMonthValues.length > 0 ? annualMonthValues.join(', ') : '—'

  const testingHistoryGridYear =
    testingHistoryYears.length === 0
      ? null
      : (effectiveTestingHistoryYear ?? defaultTestingHistoryYear(testingHistoryYears))
  const testingHistoryYearIndex =
    testingHistoryGridYear != null ? testingHistoryYears.indexOf(testingHistoryGridYear) : -1

  const historyYearNavLocked = historySaving || historyEdit != null || historyFieldEdit != null

  return (
    <div className="monthly-location-detail-page">
      <div className="monthly-location-detail-container">
        <Link to="/monthlies/locations" className="monthly-location-back-link">
          ← Monthly Locations library
        </Link>

        <section className="monthly-location-detail-hero monthly-location-detail-surface">
          <div className="monthly-location-detail-hero-main">
            <div className="monthly-location-detail-eyebrow">Monthly location</div>
            <h1 className="monthly-location-detail-title">{title}</h1>
            <div className="monthly-location-detail-subtitle">{propertyManagementLabel}</div>
          </div>
          <div className="d-flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline-primary"
              size="sm"
              className="monthly-location-detail-action"
              onClick={openAddressModal}
            >
              <i className="bi bi-geo-alt" aria-hidden />
              Edit address
            </Button>
            <Button
              type="button"
              variant="outline-primary"
              size="sm"
              className="monthly-location-detail-action"
              onClick={openRouteModal}
            >
              <i className="bi bi-signpost-split" aria-hidden />
              Edit route
            </Button>
            <Button
              type="button"
              variant="outline-primary"
              size="sm"
              className="monthly-location-detail-action"
              onClick={openStatusModal}
            >
              <i className="bi bi-sliders" aria-hidden />
              Edit status
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
          />
          <DetailMetricCard label="Route" value={routeValue} />
          <DetailMetricCard label="Key" value={keyValue} />
          <DetailMetricCard
            label="Annual"
            value={annualValue}
            tone="info"
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

        <Modal show={showAddressModal} onHide={closeAddressModal} centered>
          <Modal.Header closeButton={!addressSaving}>
            <Modal.Title>Edit address</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {addressSaveError ? (
              <Alert variant="danger" className="py-2 small">
                {addressSaveError}
              </Alert>
            ) : null}
            <Form.Group>
              <Form.Label>Street address</Form.Label>
              <Form.Control
                type="text"
                value={addressDraft}
                disabled={addressSaving}
                onChange={(e) => setAddressDraft(e.target.value)}
                autoFocus
              />
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button
              type="button"
              variant="outline-secondary"
              disabled={addressSaving}
              onClick={closeAddressModal}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={addressSaving || !addressDraft.trim()}
              onClick={() => void saveAddressEdit()}
            >
              {addressSaving ? 'Saving…' : 'Save address'}
            </Button>
          </Modal.Footer>
        </Modal>

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

        <section className="monthly-location-detail-panel monthly-location-testing-locations-panel">
          <div className="monthly-location-section-header">
            <div>
              <h2 className="monthly-location-section-title">Testing locations</h2>
            </div>
            <span className="monthly-location-section-count">{testingSites.length}</span>
          </div>
          {testingSites.length > 0 ? (
            <DndContext
              sensors={testingSiteOrderSensors}
              collisionDetection={closestCenter}
              onDragEnd={handleTestingSiteDragEnd}
            >
              <SortableContext
                items={testingSites.map((site) => site.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="monthly-location-testing-site-list">
                  {testingSites.map((site, index) => (
                    <SortableTestingSiteCard
                      key={site.id}
                      site={site}
                      index={index}
                      total={testingSites.length}
                      location={location}
                      defaultExpanded={index === 0 || site.id === lastAddedTestingSiteId}
                      orderSaving={testingSiteOrderSaving}
                      onInlineSave={saveTestingSiteForm}
                      onDelete={deleteTestingSite}
                      deleting={deletingTestingSiteId === site.id}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          ) : (
            <div className="monthly-location-empty-state">No testing locations have been added.</div>
          )}
          {addTestingSiteError ? (
            <Alert variant="danger" className="py-2 small mt-3 mb-0">
              {addTestingSiteError}
            </Alert>
          ) : null}
          <Button
            type="button"
            variant="outline-primary"
            className="monthly-location-add-testing-site-btn"
            disabled={addingTestingSite || testingSiteOrderSaving}
            onClick={() => void addTestingSite()}
          >
            {addingTestingSite ? 'Adding…' : '+ Add testing site'}
          </Button>
        </section>

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
                          const editingSkip =
                            historyEdit?.kind === 'skip_reason' && historyEdit.monthIso === monthIso
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
                            showHistoryStatus &&
                            canEditMonth &&
                            !isAnnualMonthRow &&
                            !editingSkip
                          const canEditResultField = canEditHistoryFields
                          const canEditBillingField =
                            canEditHistoryFields && cell != null && !billingLocked
                          const canEditSkip =
                            showHistoryStatus &&
                            canEditMonth &&
                            cell != null &&
                            historyMonthResultStatus(cell) === 'skipped'
                          const resultClass = showHistoryStatus
                            ? testingHistoryResultCellClass(
                                cell,
                                {
                                  editing: editingSkip || editingResult,
                                  editValue: editingSkip
                                    ? 'skipped'
                                    : editingResult
                                      ? resultValue || 'tested'
                                      : undefined,
                                },
                                isAnnualMonthRow
                              )
                            : isAnnualMonthRow
                              ? 'monthly-location-testing-history-result--annual'
                              : ''
                          const worksheetRouteId =
                            typeof cell?.worksheet_route_id === 'number' ? cell.worksheet_route_id : null
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
                                    to={`/monthlies/routes/${worksheetRouteId}/worksheet/${encodeURIComponent(monthIso)}`}
                                    title={`Open worksheet for ${formatMonthHeading(monthIso)}`}
                                  >
                                    Worksheet
                                  </Link>
                                ) : null}
                              </div>

                              {editingSkip && historyEdit?.kind === 'skip_reason' ? (
                                <div className="monthly-location-testing-history-edit-stack">
                                  <Form.Control
                                    size="sm"
                                    type="text"
                                    placeholder="Reason (optional)"
                                    value={historyEdit.value}
                                    disabled={historySaving}
                                    onChange={(e) =>
                                      setHistoryEdit({ ...historyEdit, value: e.target.value })
                                    }
                                    aria-label="Skip reason"
                                  />
                                  <div className="d-flex flex-wrap gap-2">
                                    <Button
                                      type="button"
                                      variant="primary"
                                      size="sm"
                                      disabled={historySaving}
                                      onClick={() => void saveHistorySkipEdit()}
                                    >
                                      {historySaving ? 'Saving…' : 'Save'}
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="outline-secondary"
                                      size="sm"
                                      disabled={historySaving}
                                      onClick={cancelHistoryEdit}
                                    >
                                      Cancel
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <>
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
                                          <option value="do_not_bill">Do not bill</option>
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
                                    {canEditSkip && !historyEdit ? (
                                      <button
                                        type="button"
                                        className="btn btn-link btn-sm p-0 text-decoration-none"
                                        disabled={historySaving}
                                        onClick={() => {
                                          if (historySaving) return
                                          setHistorySaveError(null)
                                          setHistoryFieldEdit(null)
                                          setHistoryEdit({
                                            kind: 'skip_reason',
                                            monthIso,
                                            value: cell?.skip_reason ?? '',
                                          })
                                        }}
                                      >
                                        Edit reason
                                      </button>
                                    ) : null}
                                  </div>
                                </>
                              )}
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
          <div className="monthly-location-section-header">
            <div>
              <h2 className="monthly-location-section-title">Billing comments</h2>
            </div>
          </div>
          {location ? (
            <MonthlyLocationBillingCommentsPanel
              locationId={location.id}
              billingComments={location.billing_comments}
              onSaved={setLocation}
            />
          ) : null}
        </section>

        <section className="monthly-location-detail-panel monthly-location-comments-panel monthly-location-comments-panel--full">
          <div className="monthly-location-section-header">
            <div>
              <h2 className="monthly-location-section-title">Comments</h2>
            </div>
          </div>
          <MonthlyLibraryCommentsPanel
            commentsApiPrefix={`/api/monthly_sites/library/${idNum}`}
            comments={comments}
            setComments={setComments}
            sessionUsername={sessionUsername}
            composerPlaceholder="Write a note for this location…"
          />
        </section>
      </div>
    </div>
  )
}
