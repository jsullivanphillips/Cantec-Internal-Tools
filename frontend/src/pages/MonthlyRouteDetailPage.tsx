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
  type KeyboardEvent,
} from 'react'
import { Chart } from 'react-chartjs-2'
import { Accordion, Alert, Badge, Button, Card, Col, Form, Modal, Row, Spinner, Table } from 'react-bootstrap'
import { Link, useParams } from 'react-router-dom'
import MonthlyLibraryCommentsPanel from '../features/monthlyRoutes/MonthlyLibraryCommentsPanel'
import {
  monthFirstIsoPacificToday,
  parseYearMonth,
  toMonthKey,
  type MonthlyLocationComment,
  type MonthlyRouteDetailPayload,
  type MonthlyRouteSpecialistMonthPayload,
  type MonthlyRouteSpecialistsPayload,
  type MonthlyRouteSummary,
  type MonthlySpecialistTechRow,
  type RouteLocationListItem,
  type RouteTestingSkippedSite,
} from '../features/monthlyRoutes/monthlyRoutesShared'
import { apiJson, apiPostFormData, isAbortError } from '../lib/apiClient'
import { formatCurrencyCad } from '../lib/formatCurrencyCad'

const WEEKDAY_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function englishOrdinal(n: number): string {
  if (11 <= (n % 100) && (n % 100) <= 13) return `${n}th`
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'
  return `${n}${suffix}`
}

function formatMonthHeading(monthIso: string): string {
  const [y, m] = monthIso.split('-').map(Number)
  if (!y || !m) return monthIso
  return new Intl.DateTimeFormat('en-CA', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, 1)))
}

/** ``YYYY-MM-DD`` from API is a Pacific calendar date; format without TZ shifting the day. */
function formatStoredPacificCalendarDate(iso: string | null | undefined): string | null {
  if (!iso || typeof iso !== 'string') return null
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (!y || !mo || !d) return null
  const dt = new Date(Date.UTC(y, mo - 1, d))
  const monthYear = new Intl.DateTimeFormat('en-CA', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(dt)
  const weekday = new Intl.DateTimeFormat('en-CA', {
    weekday: 'long',
    timeZone: 'UTC',
  }).format(dt)
  return `${monthYear}, ${weekday} the ${englishOrdinal(d)}`
}

function routeTestingPatternLabel(route: MonthlyRouteSummary): string | null {
  const wd =
    typeof route.weekday_iso === 'number' && route.weekday_iso >= 0 && route.weekday_iso <= 6
      ? WEEKDAY_FULL[route.weekday_iso]
      : null
  const occ = route.week_occurrence
  if (!wd || typeof occ !== 'number' || occ < 1) return null
  return `${englishOrdinal(occ)} ${wd}`
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

function formatSpecialistsForMonth(payload: MonthlyRouteSpecialistMonthPayload | undefined): string {
  const list = payload?.top_technicians
  if (!list?.length) return '—'
  return list.map((t) => specialistTechLabel(t)).join(', ')
}

/** True if ST specialist-month row shows attributed completed jobs; false if row exists but zero; null if no row. */
function stRouteTestedForMonth(
  payload: MonthlyRouteSpecialistMonthPayload | undefined
): boolean | null {
  if (payload === undefined) return null
  const n = payload.completed_jobs_attributed
  return typeof n === 'number' && n > 0
}

function coerceSkippedSites(value: unknown): RouteTestingSkippedSite[] {
  if (!Array.isArray(value)) return []
  const out: RouteTestingSkippedSite[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const id = Number(rec.id)
    const label = typeof rec.label === 'string' ? rec.label : ''
    if (!Number.isFinite(id)) continue

    const row: RouteTestingSkippedSite = {
      id,
      label: label.trim() || `Location ${id}`,
    }
    if ('skip_reason' in rec) {
      const sr = rec.skip_reason
      if (sr === null || sr === undefined) row.skip_reason = null
      else if (typeof sr === 'string') row.skip_reason = sr.trim() || null
      else row.skip_reason = null
    }
    out.push(row)
  }
  return out
}

function activateSkipCellKeyboard(e: KeyboardEvent<HTMLTableCellElement>, action: () => void) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    action()
  }
}

function skipReasonTableCell(site: RouteTestingSkippedSite) {
  const r = site.skip_reason
  if (r === undefined || r === null || !r.trim()) {
    return <span className="text-muted">—</span>
  }
  return <span className="text-break">{r}</span>
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

function SortableRouteSiteRow({
  loc,
  index,
  orderSaving,
}: {
  loc: RouteLocationListItem
  index: number
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

  return (
    <tr ref={setNodeRef} style={style}>
      <td className="text-center px-1 align-middle">
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
      </td>
      <td className="text-center tabular-nums fw-semibold">{index + 1}</td>
      <td>
        <Link className="link-primary text-break fw-semibold" to={`/monthlies/locations/${loc.id}`}>
          {line1}
        </Link>
        {blockLine ? <div className="small text-muted text-break">{blockLine}</div> : null}
      </td>
      <td className="small text-nowrap">
        {loc.annual_month?.trim() ? (
          <span className="text-body">{loc.annual_month.trim()}</span>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>
      <td>
        <Badge bg={siteStatusBadgeVariant(loc.status_normalized)} className="text-capitalize">
          {(loc.status_normalized || '').replace(/_/g, ' ') || '—'}
        </Badge>
      </td>
    </tr>
  )
}

type SkipSitesModalState = {
  kind: 'non_annual' | 'annual'
  monthIso: string
  sites: RouteTestingSkippedSite[]
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
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<UploadRunResponse | null>(null)
  const [issuesExpanded, setIssuesExpanded] = useState(false)

  // Reset everything when the modal closes so a fresh open starts clean.
  useEffect(() => {
    if (!show) {
      setFile(null)
      setSubmitting(false)
      setError(null)
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
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await apiPostFormData<UploadRunResponse>(
        `/api/monthly_routes/routes/${routeId}/runs/import_csv`,
        fd
      )
      setResult(res)
    } catch (e) {
      const message =
        typeof e === 'object' && e != null && 'error' in (e as Record<string, unknown>)
          ? String((e as { error?: unknown }).error)
          : typeof e === 'string'
            ? e
            : 'Upload failed.'
      setError(message)
    } finally {
      setSubmitting(false)
    }
  }, [file, routeId])

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
              different route. If this month's run has been marked{' '}
              <span className="fw-semibold text-body">completed</span> on the worksheet, reopen it there before
              uploading again—started-but-open runs can still be refreshed from CSV.
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
            {error ? <Alert variant="danger">{error}</Alert> : null}
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
                to={`/monthlies/routes/${routeId}/worksheet/${monthIso}`}
                className="btn btn-primary"
              >
                Open run worksheet
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
  const [historyViewYear, setHistoryViewYear] = useState<number | null>(null)
  const [skipSitesModal, setSkipSitesModal] = useState<SkipSitesModalState | null>(null)
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

  const patternLabel = routeTestingPatternLabel(route)
  const stUrl = route.service_trade_route_location_url

  return (
    <div className="monthly-route-detail-page pt-0 pb-4 px-3 px-lg-4 mt-n3">
      <div className="mb-3">
        <Link to="/monthlies/routes" className="text-decoration-none">
          ← Monthly Routes library
        </Link>
      </div>

      <Card className="monthly-location-detail-surface monthly-route-detail-hero mb-2">
        <Card.Body className="p-4">
          <div className="d-flex justify-content-between align-items-start flex-wrap gap-3 mb-4">
            <div className="min-w-0 flex-grow-1">
              <div className="text-muted small text-uppercase fw-semibold mb-1">Route</div>
              <h1 className="processing-page-title mb-2">{route.label}</h1>
              <div className="d-flex flex-wrap align-items-center gap-2">
                <Badge bg="light" text="dark" className="border fw-semibold px-2 py-1">
                  R{route.route_number}
                </Badge>
                {patternLabel ? (
                  <Badge bg="secondary" className="fw-semibold px-2 py-1">
                    {patternLabel}
                  </Badge>
                ) : null}
              </div>
            </div>
            <div className="d-flex flex-wrap align-items-center gap-2 flex-shrink-0 align-self-start">
              <Button
                variant="outline-secondary"
                size="sm"
                className="d-inline-flex align-items-center gap-2"
                onClick={() => setUploadRunOpen(true)}
              >
                <i className="bi bi-upload" aria-hidden />
                Upload run from CSV
              </Button>
              {stUrl ? (
                <Button
                  href={stUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="outline-primary"
                  size="sm"
                  className="d-inline-flex align-items-center gap-2"
                >
                  <i className="bi bi-box-arrow-up-right" aria-hidden />
                  Open in ServiceTrade
                </Button>
              ) : null}
            </div>
          </div>

          <Row className="g-4 align-items-start">
            <Col xs={12} md={4} lg={3}>
              <div className="text-muted small text-uppercase fw-semibold mb-1">Locations on route</div>
              <div className="display-6 fw-bold tabular-nums lh-sm">
                {route.location_count ?? '—'}
              </div>
            </Col>
            <Col xs={12} md={8} lg={9} className="monthly-route-detail-hero__specialists-col">
              <div className="text-muted small text-uppercase fw-semibold mb-1">Monthly specialists</div>
              {specialists === null ? (
                <div className="text-muted small">
                  Specialist roster appears when this route is linked to a ServiceTrade route workspace.
                </div>
              ) : !specialists.location_name && specialists.top_technicians.length === 0 ? (
                <div className="text-muted small">
                  No cached specialist data yet. Stats populate when the monthly specialists sync runs.
                </div>
              ) : (
                (() => {
                  const topFive = specialists.top_technicians.slice(0, 5)
                  const summaryPrimary =
                    topFive.length === 0
                      ? 'No active specialists in cached rankings'
                      : topFive.map((t) => `${specialistTechLabel(t)} (${specialistTechJobs(t)})`).join(', ')
                  const metaParts = [`${specialists.completed_jobs_count} route completions`]
                  if (specialists.last_updated_at) {
                    metaParts.push(
                      `Updated ${new Date(specialists.last_updated_at).toLocaleDateString()}`
                    )
                  }
                  const metaLine = metaParts.join(' · ')

                  return (
                    <>
                      {specialists.location_name ? (
                        <div className="small fw-semibold text-truncate mb-1" title={specialists.location_name}>
                          {specialists.location_name}
                        </div>
                      ) : null}
                      <div className="small">
                        <span className="text-body">{summaryPrimary}</span>
                        <span className="text-muted"> · {metaLine}</span>
                      </div>
                    </>
                  )
                })()
              )}
            </Col>
          </Row>
        </Card.Body>
      </Card>

      <Accordion
        defaultActiveKey={['sites', 'performance', 'history', 'comments']}
        alwaysOpen
        className="monthly-location-detail-accordion d-flex flex-column gap-2"
      >
        <Accordion.Item
          eventKey="sites"
          className="monthly-location-testing-history-card monthly-location-detail-surface shadow-sm bg-white"
        >
          <Accordion.Header className="monthly-location-testing-history-card-header py-3">
            <span className="fw-bold text-dark">Sites on this route</span>
          </Accordion.Header>
          <Accordion.Body className="monthly-location-testing-history-body">
            {orderError ? (
              <Alert variant="warning" className="py-2 small mb-3">
                {orderError}
              </Alert>
            ) : null}
            {orderedSites.length === 0 ? (
              <p className="text-muted small mb-0">No locations are assigned to this route.</p>
            ) : (
              <>
                <p className="text-muted small mb-2 mb-md-3">
                  Drag the grip on each row to reorder. Order saves automatically when you drop a row.
                </p>
                <div className="table-responsive">
                  <DndContext
                    sensors={routeSitesSensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleSitesDragEnd}
                  >
                    <Table responsive size="sm" bordered className="mb-0 align-middle">
                      <thead className="table-light">
                        <tr className="small text-muted text-uppercase">
                          <th style={{ width: '3rem' }} className="text-center" aria-label="Drag to reorder">
                            <i className="bi bi-grip-vertical" aria-hidden />
                            <span className="visually-hidden">Reorder</span>
                          </th>
                          <th style={{ width: '4rem' }} className="text-center">
                            Stop
                          </th>
                          <th>Address</th>
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
                              index={index}
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
          className="monthly-location-testing-history-card monthly-route-detail-performance monthly-location-detail-surface shadow-sm bg-white"
        >
          <Accordion.Header className="monthly-location-testing-history-card-header monthly-route-detail-performance-header py-3">
            <span className="d-inline-flex align-items-center gap-2 fw-semibold">
              <i className="bi bi-graph-up-arrow text-primary" aria-hidden />
              Performance
            </span>
          </Accordion.Header>
          <Accordion.Body className="monthly-location-testing-history-body">
            <Card className="monthly-route-detail-performance__revenue-card mb-3">
              <Card.Body className="p-3 p-md-4">
                <div className="monthly-route-detail-performance__revenue-card-title text-muted small text-uppercase fw-semibold mb-3">
                  Revenue by month
                </div>
                <div className="monthly-route-detail-performance__intro text-muted small mb-3">
                  <p className="mb-0">
                    Monthly revenue sums <span className="fw-semibold text-body">Price/month</span> for locations on
                    this route that were <span className="fw-semibold text-body">tested</span> that month. Locations
                    without a price are excluded from the sum.
                  </p>
                </div>
                {testingHistoryYears.length > 0 ? (
                  <>
                    <div className="monthly-route-detail-performance__year-nav d-flex flex-wrap align-items-center gap-2 justify-content-start mb-3">
                      <Button
                        type="button"
                        variant="outline-secondary"
                        size="sm"
                        className="monthly-location-testing-history-year-nav-btn"
                        disabled={testingHistoryYearIndex <= 0}
                        onClick={() => {
                          if (testingHistoryYearIndex > 0) {
                            setHistoryViewYear(testingHistoryYears[testingHistoryYearIndex - 1])
                          }
                        }}
                      >
                        Previous year
                      </Button>
                      <span className="fw-semibold px-1 tabular-nums" aria-live="polite">
                        {effectiveHistoryYear}
                      </span>
                      <Button
                        type="button"
                        variant="outline-secondary"
                        size="sm"
                        className="monthly-location-testing-history-year-nav-btn"
                        disabled={
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
                    <div className="monthly-route-detail-performance__chart">
                      {testedRevenueChart ? (
                        <>
                          <div className="monthly-route-detail-performance__chart-surface">
                            <div className="monthly-route-detail-performance__chart-area">
                              <Chart type="bar" data={testedRevenueChart.data} options={testedRevenueChart.options} />
                            </div>
                          </div>
                          {testedSitesMissingPriceYear > 0 ? (
                            <p className="text-muted small mt-2 mb-0">
                              {testedSitesMissingPriceYear} tested{' '}
                              {testedSitesMissingPriceYear === 1 ? 'site has' : 'sites have'} no Price/month set for
                              months in {effectiveHistoryYear}.
                            </p>
                          ) : null}
                        </>
                      ) : (
                        <div className="monthly-route-detail-performance__chart-surface">
                          <div className="monthly-route-detail-performance__empty d-flex align-items-center justify-content-center text-muted small">
                            No monthly sheet data for this calendar year.
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="monthly-route-detail-performance__intro text-muted small mb-0">
                    Revenue chart appears when monthly sheet testing history exists for this route.
                  </div>
                )}
              </Card.Body>
            </Card>
          </Accordion.Body>
        </Accordion.Item>

        <Accordion.Item
          eventKey="history"
          className="monthly-location-testing-history-card monthly-location-detail-surface shadow-sm bg-white"
        >
          <Accordion.Header className="monthly-location-testing-history-card-header py-3">
            <span className="fw-semibold">Testing history</span>
          </Accordion.Header>
          <Accordion.Body className="monthly-location-testing-history-body">
            {testingHistoryYears.length === 0 ? (
              <div className="text-muted small">
                No testing history or ServiceTrade specialist-by-month data for this route yet.
              </div>
            ) : (
              <>
                <div className="d-flex flex-wrap align-items-center gap-2 justify-content-start mb-3">
                  <Button
                    type="button"
                    variant="outline-secondary"
                    size="sm"
                    className="monthly-location-testing-history-year-nav-btn"
                    disabled={testingHistoryYearIndex <= 0}
                    onClick={() => {
                      if (testingHistoryYearIndex > 0) {
                        setHistoryViewYear(testingHistoryYears[testingHistoryYearIndex - 1])
                      }
                    }}
                  >
                    Previous year
                  </Button>
                  <span className="fw-semibold px-1 tabular-nums" aria-live="polite">
                    {effectiveHistoryYear}
                  </span>
                  <Button
                    type="button"
                    variant="outline-secondary"
                    size="sm"
                    className="monthly-location-testing-history-year-nav-btn"
                    disabled={
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
                <Table
                  responsive
                  size="sm"
                  bordered
                  className="mb-0 small"
                  style={{ tableLayout: 'fixed' }}
                >
                  <colgroup>
                    <col />
                    <col style={{ width: '5.25rem' }} />
                    <col style={{ width: '8rem' }} />
                    <col style={{ width: '6rem' }} />
                    <col style={{ width: '7.25rem' }} />
                    <col />
                  </colgroup>
                  <thead>
                    <tr>
                      <th
                        title="ServiceTrade appointment / completion date (Pacific). Falls back to sheet month when unavailable."
                      >
                        Test date
                      </th>
                      <th className="text-center text-nowrap px-2 align-bottom">Tested</th>
                      <th
                        className="text-center tabular-nums px-2 align-bottom"
                        style={{ whiteSpace: 'normal', lineHeight: 1.25, fontWeight: 600 }}
                        title="Imported sheet: sites tested that month."
                      >
                        # sites tested
                      </th>
                      <th
                        className="text-center tabular-nums px-2 align-bottom"
                        style={{ whiteSpace: 'normal', lineHeight: 1.25, fontWeight: 600 }}
                        title="Skipped sites excluding annual (sheet skip_reason ≠ annual)"
                      >
                        # skipped
                      </th>
                      <th
                        className="text-center tabular-nums px-2 align-bottom"
                        style={{ whiteSpace: 'normal', lineHeight: 1.25, fontWeight: 600 }}
                        title="Skipped — annual (sheet ANNUAL)"
                      >
                        # skipped annual
                      </th>
                      <th>Technicians on route</th>
                    </tr>
                  </thead>
                  <tbody>
                    {effectiveHistoryYear != null
                      ? monthIsoKeysForCalendarYear(effectiveHistoryYear).map((monthIso) => {
                          const cell = testingByMonth[monthIso]
                          const hasSheetHistoryForMonth = cell !== undefined
                          const sitesTested =
                            cell && typeof cell.sites_tested_count === 'number'
                              ? cell.sites_tested_count
                              : 0
                          const skippedNonAnnual =
                            cell && typeof cell.skipped_non_annual_count === 'number'
                              ? cell.skipped_non_annual_count
                              : 0
                          const skippedAnnual =
                            cell && typeof cell.skipped_annual_count === 'number'
                              ? cell.skipped_annual_count
                              : 0
                          const sheetCountsNoData = (
                            <em className="text-muted fst-italic">No data</em>
                          )
                          const specCell = specialistsByMonth[monthIso]
                          const stTested = stRouteTestedForMonth(specCell)
                          const techsLabel = formatSpecialistsForMonth(specCell)
                          const routeTestLabel = formatStoredPacificCalendarDate(specCell?.route_tested_on ?? null)
                          const openSkippedNonAnnualModal = () =>
                            setSkipSitesModal({
                              kind: 'non_annual',
                              monthIso,
                              sites: coerceSkippedSites(cell?.skipped_non_annual_sites),
                            })
                          const openSkippedAnnualModal = () =>
                            setSkipSitesModal({
                              kind: 'annual',
                              monthIso,
                              sites: coerceSkippedSites(cell?.skipped_annual_sites),
                            })
                          return (
                            <tr key={monthIso}>
                              <td
                                title={
                                  routeTestLabel
                                    ? `Sheet month: ${formatMonthHeading(monthIso)}`
                                    : undefined
                                }
                              >
                                <div>{routeTestLabel ?? formatMonthHeading(monthIso)}</div>
                                {hasSheetHistoryForMonth && monthIso <= monthFirstIsoPacificToday() ? (
                                  <div>
                                    <Link
                                      className="small"
                                      to={`/monthlies/routes/${idNum}/worksheet/${encodeURIComponent(monthIso)}`}
                                    >
                                      Technician worksheet
                                    </Link>
                                  </div>
                                ) : null}
                              </td>
                              <td className="text-center align-bottom px-2">
                                {stTested === true ? (
                                  <span className="text-success" aria-label="Yes">
                                    <i className="bi bi-check-lg" aria-hidden />
                                  </span>
                                ) : stTested === false ? (
                                  <span className="text-muted">—</span>
                                ) : (
                                  <span className="text-muted" title="No specialist-by-month data for this month">
                                    —
                                  </span>
                                )}
                              </td>
                              <td className="text-center align-bottom tabular-nums px-2">
                                {hasSheetHistoryForMonth ? sitesTested : sheetCountsNoData}
                              </td>
                              <td
                                className={`text-center align-bottom tabular-nums px-2${
                                  hasSheetHistoryForMonth && skippedNonAnnual > 0
                                    ? ' monthly-route-detail-skip-cell-interactive'
                                    : ''
                                }`}
                                {...(hasSheetHistoryForMonth && skippedNonAnnual > 0
                                  ? {
                                      role: 'button' as const,
                                      tabIndex: 0,
                                      'aria-label': `List sites skipped (${skippedNonAnnual}) for ${formatMonthHeading(monthIso)}`,
                                      onClick: openSkippedNonAnnualModal,
                                      onKeyDown: (e: KeyboardEvent<HTMLTableCellElement>) =>
                                        activateSkipCellKeyboard(e, openSkippedNonAnnualModal),
                                    }
                                  : {})}
                              >
                                {!hasSheetHistoryForMonth ? (
                                  sheetCountsNoData
                                ) : skippedNonAnnual > 0 ? (
                                  <span className="tabular-nums text-decoration-underline link-underline-opacity-50">
                                    {skippedNonAnnual}
                                  </span>
                                ) : (
                                  skippedNonAnnual
                                )}
                              </td>
                              <td
                                className={`text-center align-bottom tabular-nums px-2${
                                  hasSheetHistoryForMonth && skippedAnnual > 0
                                    ? ' monthly-route-detail-skip-cell-interactive'
                                    : ''
                                }`}
                                {...(hasSheetHistoryForMonth && skippedAnnual > 0
                                  ? {
                                      role: 'button' as const,
                                      tabIndex: 0,
                                      'aria-label': `List annual skips (${skippedAnnual}) for ${formatMonthHeading(monthIso)}`,
                                      onClick: openSkippedAnnualModal,
                                      onKeyDown: (e: KeyboardEvent<HTMLTableCellElement>) =>
                                        activateSkipCellKeyboard(e, openSkippedAnnualModal),
                                    }
                                  : {})}
                              >
                                {!hasSheetHistoryForMonth ? (
                                  sheetCountsNoData
                                ) : skippedAnnual > 0 ? (
                                  <span className="tabular-nums text-decoration-underline link-underline-opacity-50">
                                    {skippedAnnual}
                                  </span>
                                ) : (
                                  skippedAnnual
                                )}
                              </td>
                              <td className="text-break align-middle">
                                {techsLabel === '—' ? (
                                  <span className="text-muted">—</span>
                                ) : (
                                  <span title={techsLabel}>{techsLabel}</span>
                                )}
                              </td>
                            </tr>
                          )
                        })
                      : null}
                  </tbody>
                </Table>
                <Modal show={skipSitesModal != null} onHide={() => setSkipSitesModal(null)} centered scrollable>
                  <Modal.Header closeButton>
                    <Modal.Title className="h6 mb-0">
                      {skipSitesModal
                        ? `${formatMonthHeading(skipSitesModal.monthIso)} · ${
                            skipSitesModal.kind === 'annual' ? 'Skipped — annual' : 'Skipped (non-annual)'
                          }`
                        : ''}
                    </Modal.Title>
                  </Modal.Header>
                  <Modal.Body className="small">
                    {skipSitesModal && skipSitesModal.sites.length === 0 ? (
                      <p className="text-muted mb-0">No site addresses were returned for this breakdown.</p>
                    ) : skipSitesModal?.kind === 'non_annual' ? (
                      <Table responsive size="sm" bordered className="mb-0">
                        <thead>
                          <tr>
                            <th>Site</th>
                            <th>Skip reason</th>
                          </tr>
                        </thead>
                        <tbody>
                          {skipSitesModal.sites.map((s) => (
                            <tr key={`non-annual-${skipSitesModal.monthIso}-${s.id}`}>
                              <td className="align-middle">
                                <Link
                                  className="link-primary text-break"
                                  to={`/monthlies/locations/${s.id}`}
                                  onClick={() => setSkipSitesModal(null)}
                                >
                                  {s.label}
                                </Link>
                              </td>
                              <td className="align-middle">{skipReasonTableCell(s)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    ) : skipSitesModal ? (
                      <ul className="list-unstyled mb-0 d-flex flex-column gap-2">
                        {skipSitesModal.sites.map((s) => (
                          <li key={`annual-${skipSitesModal.monthIso}-${s.id}`}>
                            <Link
                              className="link-primary text-break"
                              to={`/monthlies/locations/${s.id}`}
                              onClick={() => setSkipSitesModal(null)}
                            >
                              {s.label}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </Modal.Body>
                </Modal>
              </>
            )}
          </Accordion.Body>
        </Accordion.Item>

        <Accordion.Item
          eventKey="comments"
          className="monthly-location-comments-card monthly-location-detail-surface shadow-sm bg-white"
        >
          <Accordion.Header className="monthly-location-comments-card-header py-3">
            <span className="fw-bold text-dark">Comments</span>
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
