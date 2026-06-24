import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { Accordion, Alert, Button, Dropdown, Spinner, Table } from 'react-bootstrap'
import { Link, useParams } from 'react-router-dom'
import MonthlyLibraryCommentsPanel from '../features/monthlyRoutes/MonthlyLibraryCommentsPanel'
import EditRouteDisplayNameModal from '../features/monthlyRoutes/EditRouteDisplayNameModal'
import MonthlyRouteDetailHero from '../features/monthlyRoutes/MonthlyRouteDetailHero'
import RouteTechnicianNoteCard from '../features/monthlyRoutes/RouteTechnicianNoteCard'
import RouteTechCountModal from '../features/monthlyRoutes/RouteTechCountModal'
import MonthlyRouteMapCard from '../features/monthlyRoutes/MonthlyRouteMapCard'
import RoutePerformanceBreakdown from '../features/monthlyRoutes/RoutePerformanceBreakdown'
import PortalKeyViewModal from '../features/monthlyRoutes/PortalKeyViewModal'
import OfficeSkipRunModal, {
  type OfficeSkipRunPayload,
} from '../features/monthlyRoutes/OfficeSkipRunModal'
import { fetchRouteKeyViewStops } from '../features/monthlyRoutes/portalKeyViewShared'
import { fetchRouteKeyAudit, type RouteKeyAuditPayload } from '../features/keys/keysAdminShared'
import { clearRouteHeroSummaryCache } from '../features/monthlyRoutes/routeHeroSummaryCache'
import {
  activeRouteLocations,
  libraryLocationHasMapCoordinates,
  mergeVisibleRouteLocationReorder,
  monthFirstIsoPacificToday,
  type MonthlyLocationComment,
  type MonthlyRouteDetailPayload,
  type MonthlyRouteHeaderPayload,
  type MonthlyRouteSpecialistsPayload,
  type MonthlyRouteSummary,
  type MonthlySpecialistTechRow,
  type RouteLocationListItem,
  type ServiceTradeRunJobMonth,
  type TechnicianWorksheetLocation,
  routeDisplayLabel,
} from '../features/monthlyRoutes/monthlyRoutesShared'
import {
  availableRunsCardYears,
  buildRunsCardRowsForYear,
  defaultRunsCardYear,
  findNewestRunMonthAwaitingOfficeReview,
  formatRunDisplayDate,
  formatRunsCardStageLabel,
  formatSitesTestedRatio,
  routeRunSummaryFromApi,
  runMonthIsOfficeSkippable,
  runsCardRowShowsPaperworkLink,
  runsCardRowShowsUploadCsv,
} from '../features/monthlyRoutes/routeRunsDisplay'
import { stopHasMonitoring } from '../features/monthlyRoutes/stopMonitoringDisplay'
import ServiceTradeJobStatusDot from '../features/monthlyRoutes/ServiceTradeJobStatusDot'
import { serviceTradeRunJobDot } from '../features/monthlyRoutes/serviceTradeRunJobDot'
import ViewServiceTradeRunJobButton from '../features/monthlyRoutes/ViewServiceTradeRunJobButton'
import { locationAddressSubline, locationPrimaryLabel } from '../features/monthlyRoutes/locationDisplay'
import {
  KEYS_COLUMN_STYLE,
  LIBRARY_TABLE_HEADER_STICKY_STYLE,
  renderLibraryStatusDot,
} from '../features/monthlyRoutes/monthlyDirectoryTableShared'
import UploadRunFromCsvModal, {
  type UploadRunResponse,
} from '../features/monthlyRoutes/UploadRunFromCsvModal'
import { apiJson, isAbortError } from '../lib/apiClient'
import { formatCurrencyCad } from '../lib/formatCurrencyCad'
import { RouteDetailAccordionSkeleton } from './MonthlyRouteDetailPageSkeleton'

function formatMonthHeading(monthIso: string): string {
  const [y, m] = monthIso.split('-').map(Number)
  if (!y || !m) return monthIso
  return new Intl.DateTimeFormat('en-CA', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, 1)))
}

function specialistTechLabel(t: MonthlySpecialistTechRow): string {
  return (t.tech_name || t.name || '').trim() || '—'
}

function specialistTechJobs(t: MonthlySpecialistTechRow): number {
  return typeof t.jobs === 'number' ? t.jobs : 0
}

function normalizedTechName(name: string): string {
  return name.trim().toLowerCase()
}

function routeSiteLabelSubtext(
  loc: RouteLocationListItem,
  rowLabel: string,
): string | null {
  const { buildingName, navigationAddress } = routeLocationSubtext(loc, rowLabel)
  const parts = [buildingName, navigationAddress].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : null
}

type RouteSiteRow = { id: number; sort_order: number; label: string | null }
function testingSitesForRouteLocation(loc: RouteLocationListItem): RouteSiteRow[] {
  return [{ id: loc.id, sort_order: 0, label: loc.label ?? null }]
}

function routeLocationStopCount(loc: RouteLocationListItem): number {
  return Math.max(1, testingSitesForRouteLocation(loc).length)
}

function routeLocationTitle(
  site: RouteSiteRow,
  index: number,
  total: number,
  loc: RouteLocationListItem,
): string {
  return locationPrimaryLabel(
    {
      label: site.label,
      display_address: loc.display_address ?? loc.address,
      address: loc.address,
    },
    { siteCount: total, siteIndex: index },
  )
}

function routeLocationSubtext(loc: RouteLocationListItem, primaryLabel: string): {
  buildingName: string | null
  navigationAddress: string | null
} {
  const buildingRaw = (loc.building_name ?? '').trim()
  const buildingName =
    buildingRaw && buildingRaw.toLowerCase() !== primaryLabel.trim().toLowerCase()
      ? buildingRaw
      : null
  const navigationAddress = locationAddressSubline(
    {
      label: loc.label,
      display_address: loc.display_address ?? loc.address,
      address: loc.address,
    },
    primaryLabel,
  )
  return { buildingName, navigationAddress }
}

function routeLocationKeyDisplay(loc: RouteLocationListItem): string {
  const fromKey = loc.key?.keycode?.trim()
  if (fromKey) return fromKey
  return (loc.keys ?? '').trim()
}

function SortableRouteSiteRow({
  loc,
  stopStart,
  orderSaving,
}: {
  loc: RouteLocationListItem
  stopStart: number
  orderSaving: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: loc.id,
    disabled: orderSaving,
  })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.72 : undefined,
  }
  const locationLabel = locationPrimaryLabel({
    label: loc.label,
    display_address: loc.display_address ?? loc.address,
    address: loc.address,
  })
  const testingSites = testingSitesForRouteLocation(loc)

  return (
    <>
      {testingSites.map((site, siteIndex) => {
        const isPrimaryRow = siteIndex === 0
        const siteLabel = routeLocationTitle(site, siteIndex, testingSites.length, loc)
        const rowLabel = testingSites.length > 1 ? siteLabel : locationLabel
        const siteRevenue =
          typeof loc.price_per_month === 'number' && Number.isFinite(loc.price_per_month)
            ? loc.price_per_month
            : null
        const keyDisplay = routeLocationKeyDisplay(loc)

        return (
          <tr
            key={`${loc.id}:${site.id}`}
            ref={isPrimaryRow ? setNodeRef : undefined}
            style={isPrimaryRow ? style : undefined}
            className={isPrimaryRow ? undefined : 'monthly-route-site-secondary-row'}
          >
            <td className="text-center monthly-route-sites-table__drag-col">
              <div className="d-flex justify-content-center">
                {isPrimaryRow ? (
                  <button
                    type="button"
                    className="btn btn-link p-0 text-muted monthly-route-site-drag-handle"
                    style={{ cursor: orderSaving ? 'not-allowed' : 'grab' }}
                    disabled={orderSaving}
                    aria-label={`Drag to reorder: ${locationLabel}`}
                    {...attributes}
                    {...listeners}
                  >
                    <i className="bi bi-grip-vertical" aria-hidden />
                  </button>
                ) : null}
              </div>
            </td>
            <td className="text-center monthly-route-sites-table__stop-col tabular-nums fw-semibold">
              {stopStart + siteIndex}
            </td>
            <td className="text-center monthly-route-sites-table__status-col">
              <div className="d-inline-flex align-items-center justify-content-center gap-1">
                {renderLibraryStatusDot(loc.status_normalized)}
                {isPrimaryRow && !libraryLocationHasMapCoordinates(loc) ? (
                  <a
                    href="#route-map"
                    className="monthly-route-site-pin-warning"
                    title="No map pin"
                    aria-label="No map pin"
                  >
                    <i className="bi bi-geo-alt" aria-hidden />
                  </a>
                ) : null}
              </div>
            </td>
            <td className="library-table-cell-clamp text-break monthly-locations-table__label-col monthly-route-sites-table__location-col">
              <div className="library-table-cell-inner">
                <Link className="monthly-locations-table__link" to={`/monthlies/locations/${loc.id}`}>
                  {rowLabel}
                </Link>
                {routeSiteLabelSubtext(loc, rowLabel) ? (
                  <span className="monthly-locations-table__route-meta d-block">
                    {routeSiteLabelSubtext(loc, rowLabel)}
                  </span>
                ) : null}
              </div>
            </td>
            <td className="library-table-cell-clamp text-end tabular-nums monthly-route-sites-table__revenue-col">
              <div className="library-table-cell-inner">
                {isPrimaryRow ? (
                  siteRevenue != null ? (
                    <span>{formatCurrencyCad(siteRevenue)}</span>
                  ) : (
                    <span className="text-muted">—</span>
                  )
                ) : null}
              </div>
            </td>
            <td
              className="library-table-cell-clamp text-center monthly-route-sites-table__key-col"
              style={KEYS_COLUMN_STYLE}
            >
              <div className="library-table-cell-inner">
                {isPrimaryRow ? (
                  loc.key ? (
                    <Link to={`/keys/${loc.key.id}`} className="monthly-locations-table__link">
                      {loc.key.keycode}
                    </Link>
                  ) : keyDisplay ? (
                    <span>{keyDisplay}</span>
                  ) : (
                    <span className="text-muted">—</span>
                  )
                ) : null}
              </div>
            </td>
          </tr>
        )
      })}
    </>
  )
}

function runsStageBadgeClass(stageLabel: string): string {
  const normalized = stageLabel.trim().toLowerCase()
  if (normalized === 'no data') {
    return 'monthly-route-stage-badge monthly-route-stage-badge--empty'
  }
  if (normalized.includes('complete') || normalized.includes('review')) {
    return 'monthly-route-stage-badge monthly-route-stage-badge--success'
  }
  if (normalized.includes('skip')) {
    return 'monthly-route-stage-badge monthly-route-stage-badge--muted'
  }
  return 'monthly-route-stage-badge monthly-route-stage-badge--info'
}

function RouteSectionHeader({
  icon,
  title,
  badge,
}: {
  icon: string
  title: string
  badge?: ReactNode
}) {
  return (
    <div className="monthly-route-section-header">
      <span className="monthly-route-section-icon" aria-hidden>
        <i className={`bi ${icon}`} />
      </span>
      <span className="monthly-route-section-copy">
        <span className="monthly-route-section-title">{title}</span>
      </span>
      {badge ? (
        <span className="monthly-route-section-badge tabular-nums">{badge}</span>
      ) : null}
    </div>
  )
}

function RouteYearToolbar({
  year,
  yearIndex,
  years,
  onChangeYear,
}: {
  year: number | null
  yearIndex: number
  years: number[]
  onChangeYear: (year: number) => void
}) {
  return (
    <div className="monthly-route-year-toolbar monthly-route-year-toolbar--compact" aria-label="Calendar year selector">
      <Button
        type="button"
        variant="outline-secondary"
        size="sm"
        className="monthly-route-year-toolbar__button"
        disabled={yearIndex <= 0}
        aria-label="Previous year"
        onClick={() => {
          if (yearIndex > 0) onChangeYear(years[yearIndex - 1])
        }}
      >
        <i className="bi bi-chevron-left" aria-hidden />
      </Button>
      <span className="monthly-route-year-toolbar__year tabular-nums" aria-live="polite">
        {year ?? '—'}
      </span>
      <Button
        type="button"
        variant="outline-secondary"
        size="sm"
        className="monthly-route-year-toolbar__button"
        disabled={yearIndex < 0 || yearIndex >= years.length - 1}
        aria-label="Next year"
        onClick={() => {
          if (yearIndex >= 0 && yearIndex < years.length - 1) onChangeYear(years[yearIndex + 1])
        }}
      >
        <i className="bi bi-chevron-right" aria-hidden />
      </Button>
    </div>
  )
}

export default function MonthlyRouteDetailPage() {
  const { routeId } = useParams<{ routeId: string }>()
  const idNum = routeId ? parseInt(routeId, 10) : NaN

  const [route, setRoute] = useState<MonthlyRouteSummary | null>(null)
  const [specialists, setSpecialists] = useState<MonthlyRouteSpecialistsPayload | null>(null)
  const [comments, setComments] = useState<MonthlyLocationComment[]>([])
  const [testingByMonth, setTestingByMonth] = useState<MonthlyRouteDetailPayload['testing_by_month']>({})
  const [runsByMonth, setRunsByMonth] = useState<MonthlyRouteDetailPayload['runs_by_month']>({})
  const [serviceTradeRunJobsByMonth, setServiceTradeRunJobsByMonth] = useState<
    Record<string, ServiceTradeRunJobMonth>
  >({})
  const [specialistsByMonth, setSpecialistsByMonth] = useState<MonthlyRouteDetailPayload['specialists_by_month']>(
    {}
  )
  const [detailLoading, setDetailLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [sessionUsername, setSessionUsername] = useState<string | null>(null)
  const [activeTechNames, setActiveTechNames] = useState<Set<string> | null>(null)
  const [performanceHeader, setPerformanceHeader] = useState<{
    monthLabel: string
    revenue: number
    net: number | null
  } | null>(null)
  const [runsViewYear, setRunsViewYear] = useState<number | null>(null)
  const [uploadRunOpen, setUploadRunOpen] = useState(false)
  const [uploadTargetMonthIso, setUploadTargetMonthIso] = useState<string | null>(null)
  const [skipConfirmMonthIso, setSkipConfirmMonthIso] = useState<string | null>(null)
  const [skipSubmitting, setSkipSubmitting] = useState(false)
  const [skipError, setSkipError] = useState<string | null>(null)
  const [orderedSites, setOrderedSites] = useState<RouteLocationListItem[]>([])
  const [orderSaving, setOrderSaving] = useState(false)
  const [orderError, setOrderError] = useState<string | null>(null)
  const [keyViewOpen, setKeyViewOpen] = useState(false)
  const [keyViewStops, setKeyViewStops] = useState<TechnicianWorksheetLocation[]>([])
  const [keyViewLoading, setKeyViewLoading] = useState(false)
  const [keyViewError, setKeyViewError] = useState<string | null>(null)
  const [keyViewAudit, setKeyViewAudit] = useState<RouteKeyAuditPayload | null>(null)
  const [editLabelOpen, setEditLabelOpen] = useState(false)
  const [editTechCountOpen, setEditTechCountOpen] = useState(false)

  const loadHeader = useCallback(
    async (signal?: AbortSignal) => {
      if (!routeId || Number.isNaN(idNum)) return
      setLoadError(null)
      try {
        const data = await apiJson<MonthlyRouteHeaderPayload>(
          `/api/monthly_routes/routes/${idNum}/header`,
          { signal },
        )
        if (signal?.aborted) return
        setRoute(data.route)
      } catch (e) {
        if (isAbortError(e)) return
        setLoadError('Unable to load this route.')
        setRoute(null)
      }
    },
    [routeId, idNum],
  )

  const loadDetail = useCallback(
    async (signal?: AbortSignal) => {
      if (!routeId || Number.isNaN(idNum)) return
      setDetailLoading(true)
      setDetailError(null)
      try {
        const data = await apiJson<MonthlyRouteDetailPayload>(`/api/monthly_routes/routes/${idNum}`, {
          signal,
        })
        if (signal?.aborted) return
        setRoute(data.route)
        setSpecialists(data.specialists ?? null)
        setComments(data.comments || [])
        setTestingByMonth(data.testing_by_month || {})
        setRunsByMonth(data.runs_by_month || {})
        setServiceTradeRunJobsByMonth(data.service_trade_run_jobs_by_month || {})
        setSpecialistsByMonth(data.specialists_by_month || {})
        setOrderedSites(data.locations ?? [])
        setOrderError(null)
      } catch (e) {
        if (isAbortError(e)) return
        setDetailError('Unable to load full route details.')
      } finally {
        if (!signal?.aborted) setDetailLoading(false)
      }
    },
    [routeId, idNum],
  )

  useEffect(() => {
    const c = new AbortController()
    void loadHeader(c.signal)
    void loadDetail(c.signal)
    return () => c.abort()
  }, [loadHeader, loadDetail])

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

  useEffect(() => {
    let active = true
    apiJson<Record<string, Array<{ id: number; name: string }>>>('/api/technicians')
      .then((grouped) => {
        if (!active) return
        const next = new Set<string>()
        for (const group of Object.values(grouped || {})) {
          for (const tech of group || []) {
            if (typeof tech?.name === 'string' && tech.name.trim()) {
              next.add(normalizedTechName(tech.name))
            }
          }
        }
        setActiveTechNames(next)
      })
      .catch(() => {
        if (active) setActiveTechNames(null)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    setRunsViewYear(null)
  }, [routeId])

  const currentMonthIso = monthFirstIsoPacificToday()

  const patchRunsByMonthFromApiRun = useCallback(
    (monthIso: string, apiRun: Record<string, unknown>) => {
      const summary = routeRunSummaryFromApi(apiRun as Parameters<typeof routeRunSummaryFromApi>[0])
      setRunsByMonth((prev) => ({ ...prev, [monthIso]: summary }))
    },
    []
  )

  const handleCsvUploaded = useCallback(
    (result: UploadRunResponse) => {
      if (!result.month_date || !result.run) return
      patchRunsByMonthFromApiRun(result.month_date, result.run as Record<string, unknown>)
    },
    [patchRunsByMonthFromApiRun]
  )

  const openUploadCsv = useCallback((monthIso: string | null = null) => {
    setUploadTargetMonthIso(monthIso)
    setUploadRunOpen(true)
  }, [])

  const closeUploadCsv = useCallback(() => {
    setUploadRunOpen(false)
    setUploadTargetMonthIso(null)
  }, [])

  const openSkipConfirm = useCallback((monthIso: string) => {
    setSkipError(null)
    setSkipConfirmMonthIso(monthIso)
  }, [])

  const closeSkipConfirm = useCallback(() => {
    if (skipSubmitting) return
    setSkipConfirmMonthIso(null)
    setSkipError(null)
  }, [skipSubmitting])

  const confirmSkipRun = useCallback(
    async (payload: OfficeSkipRunPayload) => {
      if (!skipConfirmMonthIso || Number.isNaN(idNum)) return
      setSkipSubmitting(true)
      setSkipError(null)
      try {
        const body = await apiJson<{
          ok: boolean
          run: Record<string, unknown>
          month_date: string
        }>(
          `/api/monthly_routes/routes/${idNum}/runs/skip?month=${encodeURIComponent(skipConfirmMonthIso)}`,
          {
            method: 'POST',
            body: JSON.stringify(payload),
          }
        )
        patchRunsByMonthFromApiRun(body.month_date, body.run)
        setSkipConfirmMonthIso(null)
      } catch (e) {
        const message =
          typeof e === 'object' && e != null && 'error' in e
            ? String((e as { error?: unknown }).error)
            : 'Unable to skip this month.'
        setSkipError(message)
      } finally {
        setSkipSubmitting(false)
      }
    },
    [skipConfirmMonthIso, idNum, patchRunsByMonthFromApiRun]
  )

  const persistRouteOrder = useCallback(
    async (next: RouteLocationListItem[]) => {
      if (Number.isNaN(idNum)) return
      setOrderSaving(true)
      setOrderError(null)
      try {
        const res = await apiJson<{ locations: RouteLocationListItem[] }>(
          `/api/monthly_routes/routes/${idNum}/location_order`,
          {
            method: 'PUT',
            body: JSON.stringify({ ordered_location_ids: next.map((r) => r.id) }),
          }
        )
        setOrderedSites(res.locations ?? next)
      } catch {
        setOrderError('Unable to save stop order.')
        void loadDetail()
      } finally {
        setOrderSaving(false)
      }
    },
    [idNum, loadDetail]
  )

  const routeSitesSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const visibleSites = useMemo(() => activeRouteLocations(orderedSites), [orderedSites])

  const runsCardYears = useMemo(
    () => availableRunsCardYears(currentMonthIso, runsByMonth, testingByMonth),
    [currentMonthIso, runsByMonth, testingByMonth]
  )

  const effectiveRunsYear = useMemo(() => {
    if (runsCardYears.length === 0) return null
    if (runsViewYear != null && runsCardYears.includes(runsViewYear)) return runsViewYear
    return defaultRunsCardYear(runsCardYears, currentMonthIso)
  }, [runsCardYears, runsViewYear, currentMonthIso])

  const runsCardYearIndex =
    effectiveRunsYear != null ? runsCardYears.indexOf(effectiveRunsYear) : -1

  const runsCardRows = useMemo(() => {
    if (effectiveRunsYear == null) return []
    return buildRunsCardRowsForYear(
      effectiveRunsYear,
      currentMonthIso,
      runsByMonth,
      specialistsByMonth
    )
  }, [effectiveRunsYear, currentMonthIso, runsByMonth, specialistsByMonth])

  const runsWithDataCount = useMemo(
    () => runsCardRows.filter((row) => row.hasRunData).length,
    [runsCardRows]
  )

  const hasStRouteLink = route?.service_trade_route_location_id != null

  const reviewPaperworkMonthIso = useMemo(
    () => findNewestRunMonthAwaitingOfficeReview(runsByMonth),
    [runsByMonth],
  )

  const routeStopStartByLocationId = useMemo(() => {
    const out = new Map<number, number>()
    let nextStop = 1
    for (const loc of visibleSites) {
      out.set(loc.id, nextStop)
      nextStop += routeLocationStopCount(loc)
    }
    return out
  }, [visibleSites])

  const handleSitesDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id || orderSaving) return
      const activeId = Number(active.id)
      const overId = Number(over.id)
      if (!Number.isFinite(activeId) || !Number.isFinite(overId)) return
      const oldIndex = visibleSites.findIndex((s) => s.id === activeId)
      const newIndex = visibleSites.findIndex((s) => s.id === overId)
      if (oldIndex < 0 || newIndex < 0) return
      const nextVisible = arrayMove(visibleSites, oldIndex, newIndex)
      const next = mergeVisibleRouteLocationReorder(orderedSites, nextVisible)
      setOrderedSites(next)
      void persistRouteOrder(next)
    },
    [visibleSites, orderedSites, orderSaving, persistRouteOrder]
  )

  const performanceMonthCandidates = useMemo(() => {
    const keys = new Set([...Object.keys(testingByMonth), ...Object.keys(runsByMonth)])
    return Array.from(keys).sort().reverse()
  }, [testingByMonth, runsByMonth])

  const routeStopTotal = useMemo(
    () => visibleSites.reduce((sum, loc) => sum + routeLocationStopCount(loc), 0),
    [visibleSites],
  )

  const monitoringSiteCount = useMemo(
    () =>
      visibleSites.filter((loc) =>
        stopHasMonitoring({
          monitoring_company_id: loc.monitoring_company_id,
          monitoring_company: loc.monitoring_company?.name ?? null,
          monitoring_account_number: loc.monitoring_account_number,
          monitoring_password: loc.monitoring_password,
          monitoring_notes: loc.monitoring_notes,
          monitoring_company_record: loc.monitoring_company,
        }),
      ).length,
    [visibleSites],
  )

  const openKeyView = useCallback(async () => {
    if (Number.isNaN(idNum) || routeStopTotal === 0) return
    setKeyViewLoading(true)
    setKeyViewError(null)
    try {
      const [stops, audit] = await Promise.all([
        fetchRouteKeyViewStops(idNum, monthFirstIsoPacificToday()),
        fetchRouteKeyAudit(idNum),
      ])
      setKeyViewStops(stops)
      setKeyViewAudit(audit)
      setKeyViewOpen(true)
    } catch {
      setKeyViewError('Unable to load keys for this route.')
    } finally {
      setKeyViewLoading(false)
    }
  }, [idNum, routeStopTotal])

  if (!routeId || Number.isNaN(idNum)) {
    return (
      <div className="monthly-route-detail-page">
        <div className="monthly-route-detail-container">
          <Alert variant="warning">Invalid route.</Alert>
          <Link to="/monthlies" className="monthly-location-back-link">
            <i className="bi bi-chevron-left" aria-hidden />
            Monthlies
          </Link>
        </div>
      </div>
    )
  }

  if (loadError && !route) {
    return (
      <div className="monthly-route-detail-page">
        <div className="monthly-route-detail-container">
          <Alert variant="danger">{loadError}</Alert>
          <Link to="/monthlies" className="monthly-location-back-link">
            <i className="bi bi-chevron-left" aria-hidden />
            Monthlies
          </Link>
        </div>
      </div>
    )
  }

  const stUrl = route?.service_trade_route_location_url ?? null
  const routeTitle = route ? routeDisplayLabel(route) : ''
  const heroTopSpecialists = detailLoading
    ? []
    : (specialists?.top_technicians ?? [])
        .filter((t) => specialistTechLabel(t) !== '—')
        .filter((t) => {
          if (!activeTechNames) return true
          return activeTechNames.has(normalizedTechName(specialistTechLabel(t)))
        })
        .sort((a, b) => specialistTechJobs(b) - specialistTechJobs(a))
        .slice(0, 4)
  const routeMapOrderSignature = visibleSites
    .map((loc) => `${loc.id}:${loc.route_stop_order ?? ''}:${loc.latitude ?? ''}:${loc.longitude ?? ''}`)
    .join('|')

  return (
    <div className="monthly-route-detail-page">
      <div className="monthly-route-detail-container">
        <Link to="/monthlies" className="monthly-location-back-link">
          <i className="bi bi-chevron-left" aria-hidden />
          Monthlies
        </Link>

        <MonthlyRouteDetailHero
          routeTitle={routeTitle}
          routeId={idNum}
          techCount={route?.tech_count}
          heroTopSpecialists={heroTopSpecialists}
          routeStopTotal={routeStopTotal}
          monitoringSiteCount={monitoringSiteCount}
          detailLoading={detailLoading}
          actions={
            <>
              {reviewPaperworkMonthIso ? (
                <Link
                  to={`/monthlies/routes/${idNum}/paperwork?month=${encodeURIComponent(reviewPaperworkMonthIso)}`}
                  className="btn btn-success btn-sm monthly-location-detail-action monthly-route-detail-hero__review-paperwork-action"
                >
                  <i className="bi bi-clipboard-check" aria-hidden />
                  Review Run Paperwork
                </Link>
              ) : null}
              <div className="monthly-route-detail-hero__paired-actions">
                <Link
                  to={`/monthlies/routes/${idNum}/paperwork`}
                  className="btn btn-primary btn-sm monthly-location-detail-action"
                >
                  <i className="bi bi-folder2-open" aria-hidden />
                  Paperwork
                </Link>
                <Dropdown
                  align="end"
                  className="monthly-route-detail-hero__more monthly-route-detail-hero-actions-dropdown d-none d-md-block"
                >
                  <Dropdown.Toggle
                    variant="outline-secondary"
                    size="sm"
                    className="monthly-location-detail-action"
                    id="route-detail-more-actions"
                  >
                    <i className="bi bi-three-dots-vertical" aria-hidden />
                    More
                  </Dropdown.Toggle>
                  <Dropdown.Menu>
                    {routeStopTotal > 0 ? (
                      <Dropdown.Item onClick={() => void openKeyView()} disabled={keyViewLoading}>
                        {keyViewLoading ? (
                          <>
                            <Spinner animation="border" size="sm" className="me-2" aria-hidden />
                            Loading keys…
                          </>
                        ) : (
                          <>
                            <i className="bi bi-key me-2" aria-hidden />
                            Key view
                          </>
                        )}
                      </Dropdown.Item>
                    ) : null}
                    {routeStopTotal > 0 ? <Dropdown.Divider /> : null}
                    <Dropdown.Item onClick={() => setEditLabelOpen(true)} disabled={!route}>
                      <i className="bi bi-tag me-2" aria-hidden />
                      Edit label
                    </Dropdown.Item>
                    <Dropdown.Item onClick={() => setEditTechCountOpen(true)} disabled={!route}>
                      <i className="bi bi-people me-2" aria-hidden />
                      Edit tech count
                    </Dropdown.Item>
                    <Dropdown.Divider />
                    <Dropdown.Item onClick={() => openUploadCsv(null)} disabled={detailLoading}>
                      <i className="bi bi-upload me-2" aria-hidden />
                      Upload CSV
                    </Dropdown.Item>
                    {stUrl ? (
                      <>
                        <Dropdown.Divider />
                        <Dropdown.Item href={stUrl} target="_blank" rel="noopener noreferrer">
                          <i className="bi bi-box-arrow-up-right me-2" aria-hidden />
                          Open in Service Trade
                        </Dropdown.Item>
                      </>
                    ) : null}
                  </Dropdown.Menu>
                </Dropdown>
              </div>
              <div className="monthly-route-detail-hero__mobile-actions d-md-none">
                {routeStopTotal > 0 ? (
                  <Button
                    variant="outline-secondary"
                    size="sm"
                    className="monthly-location-detail-action"
                    onClick={() => void openKeyView()}
                    disabled={keyViewLoading}
                    aria-label="Key view"
                  >
                    {keyViewLoading ? (
                      <Spinner animation="border" size="sm" className="me-1" aria-hidden />
                    ) : (
                      <i className="bi bi-key" aria-hidden />
                    )}
                    Key view
                  </Button>
                ) : null}
                <Button
                  variant="outline-secondary"
                  size="sm"
                  className="monthly-location-detail-action"
                  onClick={() => setEditLabelOpen(true)}
                  disabled={!route}
                >
                  <i className="bi bi-tag" aria-hidden />
                  Edit label
                </Button>
                <Button
                  variant="outline-secondary"
                  size="sm"
                  className="monthly-location-detail-action"
                  onClick={() => setEditTechCountOpen(true)}
                  disabled={!route}
                >
                  <i className="bi bi-people" aria-hidden />
                  Edit tech count
                </Button>
                <Button
                  variant="outline-secondary"
                  size="sm"
                  className="monthly-location-detail-action"
                  onClick={() => openUploadCsv(null)}
                  disabled={detailLoading}
                >
                  <i className="bi bi-upload" aria-hidden />
                  Upload CSV
                </Button>
                {stUrl ? (
                  <Button
                    href={stUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    variant="outline-secondary"
                    size="sm"
                    className="monthly-location-detail-action"
                  >
                    <i className="bi bi-box-arrow-up-right" aria-hidden />
                    ServiceTrade
                  </Button>
                ) : null}
              </div>
            </>
          }
        />

        {keyViewError ? (
          <Alert variant="danger" dismissible onClose={() => setKeyViewError(null)} className="mb-0">
            {keyViewError}
          </Alert>
        ) : null}

        {detailError ? (
          <Alert variant="warning" dismissible onClose={() => setDetailError(null)} className="mb-0">
            {detailError}
          </Alert>
        ) : null}

        {detailLoading || !route ? (
          <RouteDetailAccordionSkeleton />
        ) : (
        <Accordion defaultActiveKey={[]} alwaysOpen className="monthly-location-detail-accordion monthly-route-detail-accordion">
        <Accordion.Item
          eventKey="map"
          id="route-map"
          className="monthly-location-testing-history-card monthly-route-detail-section monthly-location-detail-surface"
        >
          <Accordion.Header className="monthly-location-testing-history-card-header">
            <RouteSectionHeader
              icon="bi-map"
              title="Route map"
              badge={`${routeStopTotal} stops`}
            />
          </Accordion.Header>
          <Accordion.Body className="monthly-location-testing-history-body">
            <MonthlyRouteMapCard
              routeId={idNum}
              stops={visibleSites}
              orderSignature={routeMapOrderSignature}
            />
          </Accordion.Body>
        </Accordion.Item>

        <Accordion.Item
          eventKey="sites"
          className="monthly-location-testing-history-card monthly-route-detail-section monthly-location-detail-surface"
        >
          <Accordion.Header className="monthly-location-testing-history-card-header">
            <RouteSectionHeader
              icon="bi-signpost-split"
              title="Sites on this route"
              badge={`${routeStopTotal} stops`}
            />
          </Accordion.Header>
          <Accordion.Body className="monthly-location-testing-history-body">
            {orderError ? (
              <Alert variant="warning" className="py-2 small mb-3">
                {orderError}
              </Alert>
            ) : null}
            {visibleSites.length === 0 ? (
              <p className="monthly-location-empty-state mb-0">No locations are assigned to this route.</p>
            ) : (
              <div className="monthly-locations-table-wrap">
                <DndContext
                  sensors={routeSitesSensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleSitesDragEnd}
                >
                  <Table
                    striped
                    hover
                    className="align-middle monthly-routes-library-table monthly-locations-directory-table monthly-route-sites-directory-table mb-0"
                  >
                    <colgroup>
                      <col className="monthly-route-sites-table__drag-col" />
                      <col className="monthly-route-sites-table__stop-col" />
                      <col className="monthly-route-sites-table__status-col" />
                      <col className="monthly-route-sites-table__location-col" />
                      <col className="monthly-route-sites-table__revenue-col" />
                      <col className="monthly-route-sites-table__key-col" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th
                          className="text-center monthly-route-sites-table__drag-col"
                          style={LIBRARY_TABLE_HEADER_STICKY_STYLE}
                          aria-label="Drag to reorder"
                        >
                          <i className="bi bi-grip-vertical" aria-hidden />
                          <span className="visually-hidden">Reorder</span>
                        </th>
                        <th
                          className="text-center monthly-route-sites-table__stop-col"
                          style={LIBRARY_TABLE_HEADER_STICKY_STYLE}
                        >
                          Stop
                        </th>
                        <th
                          className="text-center monthly-route-sites-table__status-col"
                          style={LIBRARY_TABLE_HEADER_STICKY_STYLE}
                        >
                          Status
                        </th>
                        <th
                          className="monthly-locations-table__label-col monthly-route-sites-table__location-col"
                          style={LIBRARY_TABLE_HEADER_STICKY_STYLE}
                        >
                          Location
                        </th>
                        <th
                          className="text-end monthly-route-sites-table__revenue-col"
                          style={LIBRARY_TABLE_HEADER_STICKY_STYLE}
                        >
                          Price
                        </th>
                        <th
                          className="text-center monthly-route-sites-table__key-col"
                          style={{ ...KEYS_COLUMN_STYLE, ...LIBRARY_TABLE_HEADER_STICKY_STYLE }}
                        >
                          Key
                        </th>
                      </tr>
                    </thead>
                    <SortableContext
                      items={visibleSites.map((s) => s.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <tbody>
                        {visibleSites.map((loc, index) => (
                          <SortableRouteSiteRow
                            key={loc.id}
                            loc={loc}
                            stopStart={routeStopStartByLocationId.get(loc.id) ?? index + 1}
                            orderSaving={orderSaving}
                          />
                        ))}
                      </tbody>
                    </SortableContext>
                  </Table>
                </DndContext>
              </div>
            )}
          </Accordion.Body>
        </Accordion.Item>

        <Accordion.Item
          eventKey="runs"
          className="monthly-location-testing-history-card monthly-route-detail-section monthly-location-detail-surface"
        >
          <Accordion.Header className="monthly-location-testing-history-card-header">
            <RouteSectionHeader
              icon="bi-calendar-check"
              title="Runs"
              badge={runsWithDataCount}
            />
          </Accordion.Header>
          <Accordion.Body className="monthly-location-testing-history-body">
            {runsCardYears.length > 0 ? (
              <div className="monthly-route-detail-section-toolbar">
                <RouteYearToolbar
                  year={effectiveRunsYear}
                  yearIndex={runsCardYearIndex}
                  years={runsCardYears}
                  onChangeYear={setRunsViewYear}
                />
              </div>
            ) : null}
            {runsCardRows.length === 0 ? (
              <p className="monthly-location-empty-state mb-0">No months available for this year.</p>
            ) : (
              <div className="monthly-locations-table-wrap">
                <Table
                  striped
                  hover
                  className="align-middle monthly-routes-library-table monthly-locations-directory-table monthly-route-runs-directory-table mb-0"
                >
                  <colgroup>
                    <col style={{ width: '16%' }} />
                    <col style={{ width: '12%' }} />
                    <col style={{ width: '12%' }} />
                    <col style={{ width: '14%' }} />
                    <col style={{ width: '14%' }} />
                    <col style={{ width: '32%' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th style={LIBRARY_TABLE_HEADER_STICKY_STYLE}>Month</th>
                      <th style={LIBRARY_TABLE_HEADER_STICKY_STYLE}>Date</th>
                      <th className="text-center" style={LIBRARY_TABLE_HEADER_STICKY_STYLE}>
                        Sites tested
                      </th>
                      <th style={LIBRARY_TABLE_HEADER_STICKY_STYLE}>Stage</th>
                      <th style={LIBRARY_TABLE_HEADER_STICKY_STYLE}>ST job</th>
                      <th className="text-end" style={LIBRARY_TABLE_HEADER_STICKY_STYLE}>
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {runsCardRows.map(({ monthIso, run, specialistMonth, hasRunData }) => {
                      const stJobDot = serviceTradeRunJobDot(
                        hasStRouteLink,
                        serviceTradeRunJobsByMonth[monthIso],
                      )
                      return (
                      <tr key={monthIso}>
                        <td className="library-table-cell-clamp fw-semibold">
                          <div className="library-table-cell-inner">{formatMonthHeading(monthIso)}</div>
                        </td>
                        <td className="library-table-cell-clamp text-nowrap">
                          <div className="library-table-cell-inner">
                            {run ? formatRunDisplayDate(run, specialistMonth) : '—'}
                          </div>
                        </td>
                        <td className="library-table-cell-clamp text-center tabular-nums">
                          <div className="library-table-cell-inner">
                            {run ? formatSitesTestedRatio(run) : '—'}
                          </div>
                        </td>
                        <td className="library-table-cell-clamp">
                          <div className="library-table-cell-inner">
                            {(() => {
                              const stageLabel = formatRunsCardStageLabel(
                                {
                                  monthIso,
                                  run,
                                  specialistMonth,
                                  hasRunData,
                                },
                                currentMonthIso,
                              )
                              const stageClass = runsStageBadgeClass(stageLabel)
                              return <span className={stageClass}>{stageLabel}</span>
                            })()}
                          </div>
                        </td>
                        <td className="library-table-cell-clamp">
                          <div className="library-table-cell-inner">
                            <ServiceTradeJobStatusDot
                              dot={stJobDot}
                              label={stJobDot.label}
                              showLabel
                              className="monthly-route-runs-st-status service-trade-job-status-dot-wrap"
                            />
                          </div>
                        </td>
                        <td className="text-end">
                          <div className="monthly-route-detail-runs-actions">
                            <ViewServiceTradeRunJobButton
                              job={serviceTradeRunJobsByMonth[monthIso]}
                              tableAction
                              monthLabel={formatMonthHeading(monthIso)}
                            />
                            {runsCardRowShowsPaperworkLink(
                              { monthIso, run, specialistMonth, hasRunData },
                              currentMonthIso,
                            ) ? (
                              <Link
                                to={`/monthlies/routes/${idNum}/paperwork?month=${encodeURIComponent(monthIso)}`}
                                className="btn btn-light btn-sm monthly-route-detail-runs-actions__btn monthly-route-runs-table-action monthly-route-runs-table-action--paperwork"
                                title="Open paperwork"
                                aria-label={`Open paperwork for ${formatMonthHeading(monthIso)}`}
                              >
                                <i className="bi bi-folder2-open" aria-hidden />
                                <span className="monthly-route-detail-runs-actions__btn-label">Paperwork</span>
                              </Link>
                            ) : null}
                            {(!hasRunData || (run != null && runMonthIsOfficeSkippable(run))) ? (
                              <Button
                                type="button"
                                variant="light"
                                size="sm"
                                className="monthly-route-detail-runs-actions__btn monthly-route-runs-table-action monthly-route-runs-table-action--skip"
                                title="Skip month"
                                aria-label={`Skip ${formatMonthHeading(monthIso)}`}
                                onClick={() => openSkipConfirm(monthIso)}
                              >
                                <i className="bi bi-skip-forward-fill" aria-hidden />
                                <span className="monthly-route-detail-runs-actions__btn-label">Skip</span>
                              </Button>
                            ) : null}
                            {runsCardRowShowsUploadCsv(
                              { monthIso, run, specialistMonth, hasRunData },
                              currentMonthIso,
                            ) ? (
                              <Button
                                type="button"
                                variant="light"
                                size="sm"
                                className="monthly-route-detail-runs-actions__btn monthly-route-runs-table-action monthly-route-runs-table-action--upload"
                                title="Upload CSV"
                                aria-label={`Upload CSV for ${formatMonthHeading(monthIso)}`}
                                onClick={() => openUploadCsv(monthIso)}
                              >
                                <i className="bi bi-upload" aria-hidden />
                                <span className="monthly-route-detail-runs-actions__btn-label">Upload</span>
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                      )
                    })}
                  </tbody>
                </Table>
              </div>
            )}
          </Accordion.Body>
        </Accordion.Item>

        <Accordion.Item
          eventKey="performance"
          className="monthly-location-testing-history-card monthly-route-detail-section monthly-route-detail-performance monthly-location-detail-surface"
        >
          <Accordion.Header className="monthly-location-testing-history-card-header">
            <RouteSectionHeader
              icon="bi-bar-chart"
              title="Performance"
              badge={
                performanceHeader?.net != null
                  ? formatCurrencyCad(performanceHeader.net)
                  : performanceHeader
                    ? formatCurrencyCad(performanceHeader.revenue)
                    : '—'
              }
            />
          </Accordion.Header>
          <Accordion.Body className="monthly-location-testing-history-body">
            <RoutePerformanceBreakdown
              routeId={idNum}
              monthCandidates={performanceMonthCandidates}
              hideTitle
              onSummaryChange={setPerformanceHeader}
            />
          </Accordion.Body>
        </Accordion.Item>

        <Accordion.Item
          eventKey="comments"
          className="monthly-location-comments-card monthly-route-detail-section monthly-location-detail-surface"
        >
          <Accordion.Header className="monthly-location-comments-card-header">
            <RouteSectionHeader
              icon="bi-chat-left-text"
              title="Comments"
              badge={comments.length}
            />
          </Accordion.Header>
          <Accordion.Body className="monthly-location-comments-body">
            <RouteTechnicianNoteCard
              routeId={idNum}
              technicianNote={route.technician_note}
              onTechnicianNotePatched={(technicianNote) =>
                setRoute((prev) => (prev ? { ...prev, technician_note: technicianNote } : prev))
              }
            />
            <hr className="monthly-location-comments-divider" />
            <MonthlyLibraryCommentsPanel
              commentsApiPrefix={`/api/monthly_routes/routes/${idNum}`}
              comments={comments}
              setComments={setComments}
              sessionUsername={sessionUsername}
              composerPlaceholder="Write a note for this route…"
            />
          </Accordion.Body>
        </Accordion.Item>
      </Accordion>
        )}
      </div>
      {route ? (
        <>
      <UploadRunFromCsvModal
        show={uploadRunOpen}
        onClose={closeUploadCsv}
        routeId={idNum}
        routeNumber={route.route_number}
        routeLabel={routeTitle}
        targetMonthIso={uploadTargetMonthIso}
        onUploaded={handleCsvUploaded}
      />
      <OfficeSkipRunModal
        show={skipConfirmMonthIso != null}
        monthIso={skipConfirmMonthIso}
        submitting={skipSubmitting}
        error={skipError}
        onClose={closeSkipConfirm}
        onConfirm={(payload) => void confirmSkipRun(payload)}
      />
      <EditRouteDisplayNameModal
        show={editLabelOpen}
        route={route}
        onClose={() => setEditLabelOpen(false)}
        onSaved={(displayName) =>
          setRoute((prev) => (prev ? { ...prev, display_name: displayName } : prev))
        }
      />
      <RouteTechCountModal
        show={editTechCountOpen}
        onHide={() => setEditTechCountOpen(false)}
        routeId={idNum}
        techCount={route.tech_count}
        onTechCountPatched={(next) => {
          clearRouteHeroSummaryCache(idNum)
          setRoute((prev) => (prev ? { ...prev, tech_count: next } : prev))
        }}
      />
      <PortalKeyViewModal
        show={keyViewOpen}
        onHide={() => setKeyViewOpen(false)}
        stops={keyViewStops}
        activeStopId={null}
        keyAudit={keyViewAudit}
        routeLabel={routeTitle}
        monochrome
      />
        </>
      ) : null}
    </div>
  )
}
