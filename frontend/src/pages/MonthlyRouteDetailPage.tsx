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
import { Chart } from 'react-chartjs-2'
import { Accordion, Alert, Badge, Button, Card, Col, Form, Modal, Row, Spinner, Table } from 'react-bootstrap'
import { Link, useParams } from 'react-router-dom'
import MonthlyLibraryCommentsPanel from '../features/monthlyRoutes/MonthlyLibraryCommentsPanel'
import MonthlyRouteMapCard from '../features/monthlyRoutes/MonthlyRouteMapCard'
import {
  libraryLocationHasMapCoordinates,
  parseYearMonth,
  toMonthKey,
  type MonthlyLocationComment,
  type MonthlyRouteDetailPayload,
  type MonthlyRouteSpecialistsPayload,
  type MonthlyRouteSummary,
  type MonthlySpecialistTechRow,
  type RouteLocationListItem,
  type RouteLocationTestingSiteListItem,
} from '../features/monthlyRoutes/monthlyRoutesShared'
import { testingSitePrimaryLabel } from '../features/monthlyRoutes/testingSiteDisplay'
import { apiJson, apiPostFormData, isAbortError } from '../lib/apiClient'
import { formatCurrencyCad } from '../lib/formatCurrencyCad'

function formatMonthHeading(monthIso: string): string {
  const [y, m] = monthIso.split('-').map(Number)
  if (!y || !m) return monthIso
  return new Intl.DateTimeFormat('en-CA', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, 1)))
}

function monthIsoKeysForCalendarYear(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => toMonthKey(year, i + 1))
}

function yearsFromTestingKeys(monthKeys: string[]): number[] {
  const years = new Set<number>()
  for (const k of monthKeys) {
    const ym = parseYearMonth(k)
    if (ym) years.add(ym.year)
  }
  return Array.from(years).sort((a, b) => a - b)
}

function defaultTestingYear(years: number[]): number | null {
  if (years.length === 0) return null
  const cy = new Date().getFullYear()
  if (years.includes(cy)) return cy
  return years[years.length - 1]
}

function specialistTechLabel(t: MonthlySpecialistTechRow): string {
  return (t.tech_name || t.name || '').trim() || '—'
}

function specialistTechJobs(t: MonthlySpecialistTechRow): number {
  return typeof t.jobs === 'number' ? t.jobs : 0
}

function specialistBadgeClass(jobs: number) {
  if (jobs >= 15) return 'monthly-tech-badge--diamond'
  if (jobs > 10) return 'monthly-tech-badge--gold'
  if (jobs > 5) return 'monthly-tech-badge--silver'
  return 'monthly-tech-badge--bronze'
}

function specialistBadgeTier(jobs: number) {
  if (jobs >= 15) return 'Diamond'
  if (jobs > 10) return 'Gold'
  if (jobs > 5) return 'Silver'
  return 'Bronze'
}

function normalizedTechName(name: string): string {
  return name.trim().toLowerCase()
}

function siteStatusBadgeVariant(status: string): string {
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

function testingSitesForRouteLocation(loc: RouteLocationListItem): RouteLocationTestingSiteListItem[] {
  const sites = [...(loc.testing_sites ?? [])].sort((a, b) => a.sort_order - b.sort_order)
  if (sites.length > 0) return sites
  return [
    {
      id: -loc.id,
      sort_order: 0,
      label: null,
      annual_month: loc.annual_month ?? null,
    },
  ]
}

function routeLocationStopCount(loc: RouteLocationListItem): number {
  return Math.max(1, testingSitesForRouteLocation(loc).length)
}

function routeTestingSiteTitle(
  site: RouteLocationTestingSiteListItem,
  index: number,
  total: number,
  locLabel: string
): string {
  return testingSitePrimaryLabel(
    { label: site.label, display_address: locLabel },
    { siteCount: total, siteIndex: index },
  )
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
  const line1 = (loc.display_address || loc.address || '').trim() || `Location ${loc.id}`
  const blockLine = (loc.building || '').trim()
  const testingSites = testingSitesForRouteLocation(loc)

  return (
    <>
      {testingSites.map((site, siteIndex) => {
        const isPrimaryRow = siteIndex === 0
        const siteTitle = routeTestingSiteTitle(site, siteIndex, testingSites.length, line1)
        const annual = site.annual_month?.trim() || loc.annual_month?.trim() || ''

        return (
          <tr
            key={`${loc.id}:${site.id}`}
            ref={isPrimaryRow ? setNodeRef : undefined}
            style={isPrimaryRow ? style : undefined}
            className={isPrimaryRow ? undefined : 'monthly-route-site-secondary-row'}
          >
            <td className="text-center px-1 align-middle">
              {isPrimaryRow ? (
                <button
                  type="button"
                  className="btn btn-link p-0 text-muted monthly-route-site-drag-handle"
                  style={{ cursor: orderSaving ? 'not-allowed' : 'grab' }}
                  disabled={orderSaving}
                  aria-label={`Drag to reorder: ${line1}`}
                  {...attributes}
                  {...listeners}
                >
                  <i className="bi bi-grip-vertical fs-5" aria-hidden />
                </button>
              ) : null}
            </td>
            <td className="text-center tabular-nums fw-semibold">{stopStart + siteIndex}</td>
            <td>
              {isPrimaryRow ? (
                <>
                  <Link className="link-primary text-break fw-semibold" to={`/monthlies/locations/${loc.id}`}>
                    {line1}
                  </Link>
                  {blockLine ? <div className="small text-muted text-break">{blockLine}</div> : null}
                  {testingSites.length > 1 || site.label?.trim() ? (
                    <div className="small text-muted text-break">{siteTitle}</div>
                  ) : null}
                </>
              ) : (
                <>
                  <div className="fw-semibold text-break">{siteTitle}</div>
                  <Link className="small text-muted text-decoration-none text-break" to={`/monthlies/locations/${loc.id}`}>
                    {line1}
                  </Link>
                </>
              )}
            </td>
            <td className="small text-nowrap">
              {annual ? <span className="text-body">{annual}</span> : <span className="text-muted">—</span>}
            </td>
            <td>
              <div className="d-flex flex-column align-items-start gap-1">
                <Badge bg={siteStatusBadgeVariant(loc.status_normalized)} className="text-capitalize">
                  {(loc.status_normalized || '').replace(/_/g, ' ') || '—'}
                </Badge>
                {isPrimaryRow && !libraryLocationHasMapCoordinates(loc) ? (
                  <a href="#route-map" className="badge rounded-pill text-bg-warning text-decoration-none">
                    No map pin
                  </a>
                ) : null}
              </div>
            </td>
          </tr>
        )
      })}
    </>
  )
}

/** Issue surfaced by the route-inspection CSV importer for a single CSV row. */
type UploadRunIssue = {
  kind: string
  csv_row: number
  detail: string
}

/** ``POST /api/monthly_routes/routes/:id/runs/import_csv`` success payload. */
type UploadRunResponse = {
  ok: true
  route: { id: number; route_number: number; label: string }
  month_date: string
  run: {
    id: number
    monthly_route_id: number
    month_date: string
    status: string
    started_at: string | null
    completed_at: string | null
    source: string
  } | null
  sheet_label: string | null
  locations_updated: number
  history_upserts: number
  rows_without_history_signal: number
  existing_status_preserved?: number
  sync_stop_order?: boolean
  stop_order_applied?: number
  stop_order_skipped_not_on_sheet_route?: number
  session_stop_order_applied?: number
  issues: UploadRunIssue[]
}

type UploadRunFromCsvModalProps = {
  show: boolean
  onClose: () => void
  routeId: number
  routeNumber: number
  routeLabel: string
}

function UploadRunFromCsvModal({
  show,
  onClose,
  routeId,
  routeNumber,
  routeLabel,
}: UploadRunFromCsvModalProps) {
  const [file, setFile] = useState<File | null>(null)
  const [syncStopOrder, setSyncStopOrder] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [blockedMonthIso, setBlockedMonthIso] = useState<string | null>(null)
  const [result, setResult] = useState<UploadRunResponse | null>(null)
  const [issuesExpanded, setIssuesExpanded] = useState(false)

  // Reset everything when the modal closes so a fresh open starts clean.
  useEffect(() => {
    if (!show) {
      setFile(null)
      setSyncStopOrder(false)
      setSubmitting(false)
      setError(null)
      setBlockedMonthIso(null)
      setResult(null)
      setIssuesExpanded(false)
    }
  }, [show])

  const onSubmit = useCallback(async () => {
    if (!file) {
      setError('Choose a CSV file first.')
      return
    }
    setSubmitting(true)
    setError(null)
    setBlockedMonthIso(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      if (syncStopOrder) {
        fd.append('sync_stop_order', '1')
      }
      const res = await apiPostFormData<UploadRunResponse>(
        `/api/monthly_routes/routes/${routeId}/runs/import_csv`,
        fd
      )
      setResult(res)
    } catch (e) {
      const body = typeof e === 'object' && e != null ? (e as Record<string, unknown>) : null
      const message =
        body && 'error' in body
          ? String(body.error)
          : typeof e === 'string'
            ? e
            : 'Upload failed.'
      setError(message)
      const code = body && typeof body.code === 'string' ? body.code : ''
      const monthDate =
        body && typeof body.month_date === 'string' ? body.month_date.trim() : ''
      if (code === 'run_completed_csv_blocked' && monthDate) {
        setBlockedMonthIso(monthDate)
      }
    } finally {
      setSubmitting(false)
    }
  }, [file, routeId, syncStopOrder])

  const formattedMonth = result?.month_date
    ? formatMonthHeading(result.month_date)
    : null
  const monthIso = result?.month_date ?? null

  return (
    <Modal show={show} onHide={onClose} size="lg" backdrop={submitting ? 'static' : true}>
      <Modal.Header closeButton={!submitting}>
        <Modal.Title>Upload run from CSV</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {result ? (
          <>
            <Alert variant="success" className="mb-3">
              Run materialized for <strong>{result.route.label}</strong> ·{' '}
              <strong>{formattedMonth}</strong>.
            </Alert>
            <Row className="g-3 mb-3">
              <Col xs={6} md={3}>
                <div className="text-muted small text-uppercase fw-semibold">Stops updated</div>
                <div className="h4 mb-0 tabular-nums">{result.locations_updated}</div>
              </Col>
              <Col xs={6} md={3}>
                <div className="text-muted small text-uppercase fw-semibold">History upserts</div>
                <div className="h4 mb-0 tabular-nums">{result.history_upserts}</div>
              </Col>
              <Col xs={6} md={3}>
                <div className="text-muted small text-uppercase fw-semibold">Untimed rows</div>
                <div className="h4 mb-0 tabular-nums">
                  {result.rows_without_history_signal}
                </div>
              </Col>
              <Col xs={6} md={3}>
                <div className="text-muted small text-uppercase fw-semibold">Issues</div>
                <div className="h4 mb-0 tabular-nums">{result.issues.length}</div>
              </Col>
            </Row>
            {result.sync_stop_order ? (
              <p className="small text-muted mb-3">
                Stop order updated for{' '}
                <strong className="tabular-nums">{result.stop_order_applied ?? 0}</strong> location
                {(result.stop_order_applied ?? 0) === 1 ? '' : 's'} on this route
                {(result.session_stop_order_applied ?? 0) > 0 ? (
                  <>
                    {' '}
                    (<strong className="tabular-nums">{result.session_stop_order_applied}</strong>{' '}
                    worksheet stop
                    {(result.session_stop_order_applied ?? 0) === 1 ? '' : 's'} reordered for this
                    month)
                  </>
                ) : null}
                .
                {(result.stop_order_skipped_not_on_sheet_route ?? 0) > 0 ? (
                  <>
                    {' '}
                    {result.stop_order_skipped_not_on_sheet_route} CSV row
                    {(result.stop_order_skipped_not_on_sheet_route ?? 0) === 1 ? ' was' : 's were'}{' '}
                    skipped because the site is not assigned to this route.
                  </>
                ) : null}
              </p>
            ) : null}
            {result.issues.length > 0 ? (
              <div className="mb-3">
                <Button
                  variant="link"
                  size="sm"
                  className="px-0"
                  onClick={() => setIssuesExpanded((v) => !v)}
                >
                  {issuesExpanded ? 'Hide' : 'Show'} {result.issues.length} issue
                  {result.issues.length === 1 ? '' : 's'}
                </Button>
                {issuesExpanded ? (
                  <div className="border rounded mt-2 small" style={{ maxHeight: '14rem', overflow: 'auto' }}>
                    <Table size="sm" className="mb-0">
                      <thead>
                        <tr>
                          <th style={{ width: '7rem' }}>Kind</th>
                          <th style={{ width: '5rem' }}>Row</th>
                          <th>Detail</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.issues.map((iss, i) => (
                          <tr key={`${iss.kind}-${iss.csv_row}-${i}`}>
                            <td>
                              <Badge
                                bg={
                                  iss.kind === 'route_mismatch'
                                    ? 'warning'
                                    : 'danger'
                                }
                              >
                                {iss.kind}
                              </Badge>
                            </td>
                            <td className="tabular-nums">{iss.csv_row}</td>
                            <td className="text-break">{iss.detail}</td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        ) : (
          <>
            <p className="text-muted mb-3">
              Upload the technician inspection sheet (the same CSV you use on the route).
              The page detects the route and month from the preamble; you'll get an error if the CSV is for a
              different route. If that month&apos;s run is marked{' '}
              <span className="fw-semibold text-body">completed</span> on Paperwork, use{' '}
              <span className="fw-semibold text-body">Reopen job</span> there before uploading again.
            </p>
            <Form.Group controlId="upload-run-csv-file" className="mb-3">
              <Form.Label>CSV file</Form.Label>
              <Form.Control
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  const t = e.target as HTMLInputElement
                  setFile(t.files && t.files.length > 0 ? t.files[0] : null)
                  setError(null)
                }}
                disabled={submitting}
              />
              <Form.Text className="text-muted">
                Page route: <strong>R{routeNumber}</strong> — {routeLabel}
              </Form.Text>
            </Form.Group>
            <Form.Check
              type="checkbox"
              id="upload-run-csv-sync-stop-order"
              className="mb-3"
              label="Reorder stops to match CSV (# column)"
              checked={syncStopOrder}
              disabled={submitting}
              onChange={(e) => setSyncStopOrder(e.target.checked)}
            />
            <Form.Text className="text-muted d-block mb-3" style={{ marginTop: '-0.5rem' }}>
              Also updates library route stop order for sites already on this route. Run review always
              follows the CSV # column; check this only when you want the permanent route roster to
              match the sheet too.
            </Form.Text>
            {error ? (
              <Alert variant="danger">
                <div>{error}</div>
                {blockedMonthIso ? (
                  <div className="mt-2">
                    <Link
                      to={`/monthlies/routes/${routeId}/paperwork?month=${encodeURIComponent(blockedMonthIso)}`}
                      className="alert-link"
                    >
                      Open {formatMonthHeading(blockedMonthIso)} paperwork to reopen
                    </Link>
                  </div>
                ) : null}
              </Alert>
            ) : null}
          </>
        )}
      </Modal.Body>
      <Modal.Footer>
        {result ? (
          <>
            <Button variant="outline-secondary" onClick={onClose}>
              Close
            </Button>
            {monthIso ? (
              <Link
                to={`/monthlies/routes/${routeId}/paperwork?month=${encodeURIComponent(monthIso)}`}
                className="btn btn-primary"
              >
                View paperwork
              </Link>
            ) : null}
          </>
        ) : (
          <>
            <Button variant="outline-secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={onSubmit} disabled={!file || submitting}>
              {submitting ? (
                <>
                  <Spinner size="sm" animation="border" role="status" className="me-2" />
                  Uploading…
                </>
              ) : (
                'Upload'
              )}
            </Button>
          </>
        )}
      </Modal.Footer>
    </Modal>
  )
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
      {badge ? <span className="monthly-route-section-badge">{badge}</span> : null}
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
    <div className="monthly-route-year-toolbar" aria-label="Calendar year selector">
      <Button
        type="button"
        variant="outline-secondary"
        size="sm"
        className="monthly-route-year-toolbar__button"
        disabled={yearIndex <= 0}
        onClick={() => {
          if (yearIndex > 0) onChangeYear(years[yearIndex - 1])
        }}
      >
        Previous
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
        onClick={() => {
          if (yearIndex >= 0 && yearIndex < years.length - 1) onChangeYear(years[yearIndex + 1])
        }}
      >
        Next
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
  const [specialistsByMonth, setSpecialistsByMonth] = useState<MonthlyRouteDetailPayload['specialists_by_month']>(
    {}
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sessionUsername, setSessionUsername] = useState<string | null>(null)
  const [activeTechNames, setActiveTechNames] = useState<Set<string> | null>(null)
  const [historyViewYear, setHistoryViewYear] = useState<number | null>(null)
  const [uploadRunOpen, setUploadRunOpen] = useState(false)
  const [orderedSites, setOrderedSites] = useState<RouteLocationListItem[]>([])
  const [orderSaving, setOrderSaving] = useState(false)
  const [orderError, setOrderError] = useState<string | null>(null)

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!routeId || Number.isNaN(idNum)) return
      setLoading(true)
      setError(null)
      try {
        const data = await apiJson<MonthlyRouteDetailPayload>(`/api/monthly_routes/routes/${idNum}`, {
          signal,
        })
        if (signal?.aborted) return
        setRoute(data.route)
        setSpecialists(data.specialists ?? null)
        setComments(data.comments || [])
        setTestingByMonth(data.testing_by_month || {})
        setSpecialistsByMonth(data.specialists_by_month || {})
        setOrderedSites(data.locations ?? [])
        setOrderError(null)
      } catch (e) {
        if (isAbortError(e)) return
        setError('Unable to load this route.')
        setRoute(null)
        setSpecialists(null)
        setComments([])
        setTestingByMonth({})
        setSpecialistsByMonth({})
        setOrderedSites([])
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [routeId, idNum]
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
    setHistoryViewYear(null)
  }, [routeId])

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
        void load()
      } finally {
        setOrderSaving(false)
      }
    },
    [idNum, load]
  )

  const routeSitesSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const routeStopStartByLocationId = useMemo(() => {
    const out = new Map<number, number>()
    let nextStop = 1
    for (const loc of orderedSites) {
      out.set(loc.id, nextStop)
      nextStop += routeLocationStopCount(loc)
    }
    return out
  }, [orderedSites])

  const handleSitesDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id || orderSaving) return
      const activeId = Number(active.id)
      const overId = Number(over.id)
      if (!Number.isFinite(activeId) || !Number.isFinite(overId)) return
      const oldIndex = orderedSites.findIndex((s) => s.id === activeId)
      const newIndex = orderedSites.findIndex((s) => s.id === overId)
      if (oldIndex < 0 || newIndex < 0) return
      const next = arrayMove(orderedSites, oldIndex, newIndex)
      setOrderedSites(next)
      void persistRouteOrder(next)
    },
    [orderedSites, orderSaving, persistRouteOrder]
  )

  const testingHistoryMonthKeys = useMemo(() => {
    const keys = new Set([
      ...Object.keys(testingByMonth),
      ...Object.keys(specialistsByMonth),
    ])
    return Array.from(keys)
  }, [testingByMonth, specialistsByMonth])

  const testingHistoryYears = useMemo(
    () => yearsFromTestingKeys(testingHistoryMonthKeys),
    [testingHistoryMonthKeys]
  )

  const effectiveHistoryYear = useMemo(() => {
    if (testingHistoryYears.length === 0) return null
    if (historyViewYear != null && testingHistoryYears.includes(historyViewYear)) return historyViewYear
    return defaultTestingYear(testingHistoryYears)
  }, [testingHistoryYears, historyViewYear])

  const testingHistoryYearIndex =
    effectiveHistoryYear != null ? testingHistoryYears.indexOf(effectiveHistoryYear) : -1

  const testedRevenueChart = useMemo(() => {
    if (effectiveHistoryYear == null) return null
    const monthKeys = monthIsoKeysForCalendarYear(effectiveHistoryYear)
    const anySheetMonth = monthKeys.some((iso) => testingByMonth[iso] !== undefined)
    if (!anySheetMonth) return null

    const labels = monthKeys.map((iso) => {
      const ym = parseYearMonth(iso)
      if (!ym) return iso
      return new Intl.DateTimeFormat('en-CA', { month: 'short', timeZone: 'UTC' }).format(
        new Date(Date.UTC(ym.year, ym.month - 1, 1))
      )
    })
    const values = monthKeys.map((iso) => {
      const cell = testingByMonth[iso]
      const v = cell?.tested_revenue_total
      return typeof v === 'number' && Number.isFinite(v) ? v : 0
    })

    return {
      data: {
        labels,
        datasets: [
          {
            label: 'Tested site revenue',
            data: values,
            backgroundColor: 'rgba(22, 75, 124, 0.78)',
            borderRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (items: { parsed: { y: number | null } }) =>
                formatCurrencyCad(items.parsed.y ?? 0),
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: (raw: number | string) => formatCurrencyCad(Number(raw)),
            },
          },
        },
      },
    }
  }, [effectiveHistoryYear, testingByMonth])

  const testedSitesMissingPriceYear = useMemo(() => {
    if (effectiveHistoryYear == null) return 0
    return monthIsoKeysForCalendarYear(effectiveHistoryYear).reduce((acc, iso) => {
      const n = testingByMonth[iso]?.tested_sites_missing_price_count
      return acc + (typeof n === 'number' ? n : 0)
    }, 0)
  }, [effectiveHistoryYear, testingByMonth])

  if (!routeId || Number.isNaN(idNum)) {
    return (
      <div className="container py-4">
        <Alert variant="warning">Invalid route.</Alert>
        <Link to="/monthlies/routes">Back to Monthly Routes</Link>
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

  if (error || !route) {
    return (
      <div className="container py-4">
        <Alert variant="danger">{error || 'Route not found.'}</Alert>
        <Link to="/monthlies/routes">Back to Monthly Routes</Link>
      </div>
    )
  }

  const stUrl = route.service_trade_route_location_url
  const routeLocationCount = route.location_count ?? orderedSites.length
  const routeStopTotal = orderedSites.reduce((sum, loc) => sum + routeLocationStopCount(loc), 0)
  const selectedYearMonthKeys =
    effectiveHistoryYear != null ? monthIsoKeysForCalendarYear(effectiveHistoryYear) : []
  const selectedYearRevenue = selectedYearMonthKeys.reduce((sum, monthIso) => {
    const revenue = testingByMonth[monthIso]?.tested_revenue_total
    return sum + (typeof revenue === 'number' && Number.isFinite(revenue) ? revenue : 0)
  }, 0)
  const heroTopSpecialists = (specialists?.top_technicians ?? [])
    .filter((t) => specialistTechLabel(t) !== '—')
    .filter((t) => {
      if (!activeTechNames) return true
      return activeTechNames.has(normalizedTechName(specialistTechLabel(t)))
    })
    .sort((a, b) => specialistTechJobs(b) - specialistTechJobs(a))
    .slice(0, 3)
  const routeMapOrderSignature = orderedSites
    .map((loc) => `${loc.id}:${loc.route_stop_order ?? ''}:${loc.latitude ?? ''}:${loc.longitude ?? ''}`)
    .join('|')

  return (
    <div className="monthly-route-detail-page">
      <div className="monthly-route-detail-container">
        <Link to="/monthlies/routes" className="monthly-location-back-link">
          ← Monthly Routes library
        </Link>

        <section className="monthly-route-detail-hero monthly-location-detail-surface">
          <div className="monthly-route-detail-hero__copy">
            <div className="monthly-location-detail-eyebrow">Monthly route</div>
            <h1 className="monthly-location-detail-title">{route.label}</h1>
            <div className="monthly-route-detail-hero__meta">
              <Badge bg="light" text="dark" className="monthly-route-pill">
                Locations: <span className="tabular-nums">{routeLocationCount}</span>
              </Badge>
              <Badge bg="light" text="dark" className="monthly-route-pill">
                Tested Revenue: {formatCurrencyCad(selectedYearRevenue)}
                {testedSitesMissingPriceYear > 0 ? (
                  <span className="small text-muted ms-2">
                    {testedSitesMissingPriceYear} missing {testedSitesMissingPriceYear === 1 ? 'price' : 'prices'}
                  </span>
                ) : null}
              </Badge>
            </div>
          </div>
          <div className="monthly-route-detail-hero__right">
            <div className="monthly-route-detail-actions">
              <Button
                variant="outline-secondary"
                size="sm"
                className="monthly-location-detail-action"
                onClick={() => setUploadRunOpen(true)}
              >
                <i className="bi bi-upload" aria-hidden />
                Upload CSV
              </Button>
              {stUrl ? (
                <Button
                  href={stUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="outline-primary"
                  size="sm"
                  className="monthly-location-detail-action"
                >
                  <i className="bi bi-box-arrow-up-right" aria-hidden />
                  ServiceTrade
                </Button>
              ) : null}
            </div>
            {heroTopSpecialists.length > 0 ? (
              <div className="monthly-route-detail-hero__specialists" aria-label="Top monthly specialists">
                <span className="monthly-route-detail-hero__specialists-label">Specialists:</span>
                {heroTopSpecialists.map((tech, index) => (
                  <Badge
                    key={`${specialistTechLabel(tech)}:${index}`}
                    bg="light"
                    text="dark"
                    className={`monthly-route-pill monthly-tech-badge ${specialistBadgeClass(specialistTechJobs(tech))}`}
                    title={`${specialistBadgeTier(specialistTechJobs(tech))} tier`}
                    aria-label={`${specialistTechLabel(tech)}, ${specialistTechJobs(tech)} completions`}
                  >
                    {specialistTechLabel(tech)} ({specialistTechJobs(tech)})
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
        </section>

        <Link
          to={`/monthlies/routes/${idNum}/paperwork`}
          className="btn btn-primary w-100 monthly-route-paperwork-entry"
        >
          <i className="bi bi-folder2-open me-2" aria-hidden />
          Paperwork
        </Link>

        <Accordion defaultActiveKey={['map']} alwaysOpen className="monthly-location-detail-accordion monthly-route-detail-accordion">
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
              stops={orderedSites}
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
            {orderedSites.length === 0 ? (
              <p className="monthly-location-empty-state mb-0">No locations are assigned to this route.</p>
            ) : (
              <>
                <div className="monthly-route-detail-note">
                  <span>{orderedSites.length} assigned locations</span>
                  <span>Order saves automatically after drop</span>
                </div>
                <div className="monthly-route-detail-table-shell">
                  <DndContext
                    sensors={routeSitesSensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleSitesDragEnd}
                  >
                    <Table size="sm" className="monthly-route-detail-table monthly-route-sites-table mb-0 align-middle">
                      <thead>
                        <tr className="small text-muted text-uppercase">
                          <th style={{ width: '3rem' }} className="text-center" aria-label="Drag to reorder">
                            <i className="bi bi-grip-vertical" aria-hidden />
                            <span className="visually-hidden">Reorder</span>
                          </th>
                          <th style={{ width: '4rem' }} className="text-center">
                            Stop
                          </th>
                          <th>Location / testing site</th>
                          <th style={{ width: '6.5rem' }} className="text-nowrap">
                            Annual
                          </th>
                          <th style={{ width: '7rem' }}>Status</th>
                        </tr>
                      </thead>
                      <SortableContext
                        items={orderedSites.map((s) => s.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        <tbody>
                          {orderedSites.map((loc, index) => (
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
              </>
            )}
          </Accordion.Body>
        </Accordion.Item>

        <Accordion.Item
          eventKey="performance"
          className="monthly-location-testing-history-card monthly-route-detail-section monthly-route-detail-performance monthly-location-detail-surface"
        >
          <Accordion.Header className="monthly-location-testing-history-card-header monthly-route-detail-performance-header">
            <RouteSectionHeader
              icon="bi-bar-chart"
              title="Performance"
              badge={formatCurrencyCad(selectedYearRevenue)}
            />
          </Accordion.Header>
          <Accordion.Body className="monthly-location-testing-history-body">
            <Card className="monthly-route-detail-performance__revenue-card">
              <Card.Body className="p-3 p-md-4">
                <div className="monthly-route-detail-performance__summary">
                  <div>
                    <div className="monthly-route-detail-performance__revenue-card-title">
                      Revenue by month
                    </div>
                    <p className="monthly-route-detail-performance__intro mb-0">
                      Sums Price/month for locations tested in the selected year. Locations without a price are excluded.
                    </p>
                  </div>
                  <div className="monthly-route-detail-performance__stat">
                    <span>Total tested revenue</span>
                    <strong>{formatCurrencyCad(selectedYearRevenue)}</strong>
                  </div>
                </div>
                {testingHistoryYears.length > 0 ? (
                  <>
                    <RouteYearToolbar
                      year={effectiveHistoryYear}
                      yearIndex={testingHistoryYearIndex}
                      years={testingHistoryYears}
                      onChangeYear={setHistoryViewYear}
                    />
                    <div className="monthly-route-detail-performance__chart">
                      {testedRevenueChart ? (
                        <>
                          <div className="monthly-route-detail-performance__chart-surface">
                            <div className="monthly-route-detail-performance__chart-area">
                              <Chart type="bar" data={testedRevenueChart.data} options={testedRevenueChart.options} />
                            </div>
                          </div>
                          {testedSitesMissingPriceYear > 0 ? (
                            <p className="monthly-route-detail-callout mt-2 mb-0">
                              {testedSitesMissingPriceYear} tested{' '}
                              {testedSitesMissingPriceYear === 1 ? 'site has' : 'sites have'} no Price/month set for
                              months in {effectiveHistoryYear}.
                            </p>
                          ) : null}
                        </>
                      ) : (
                        <div className="monthly-route-detail-performance__chart-surface">
                          <div className="monthly-route-detail-performance__empty d-flex align-items-center justify-content-center">
                            No monthly sheet data for this calendar year.
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="monthly-route-detail-callout mb-0">
                    Revenue chart appears when monthly sheet testing history exists for this route.
                  </div>
                )}
              </Card.Body>
            </Card>
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
      </div>
      <UploadRunFromCsvModal
        show={uploadRunOpen}
        onClose={() => setUploadRunOpen(false)}
        routeId={idNum}
        routeNumber={route.route_number}
        routeLabel={route.label}
      />
    </div>
  )
}
