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
import { Accordion, Alert, Badge, Button, Col, Form, Modal, Row, Spinner, Table } from 'react-bootstrap'
import { Link, useParams } from 'react-router-dom'
import MonthlyLibraryCommentsPanel from '../features/monthlyRoutes/MonthlyLibraryCommentsPanel'
import RouteTechnicianNoteCard from '../features/monthlyRoutes/RouteTechnicianNoteCard'
import MonthlyRouteMapCard from '../features/monthlyRoutes/MonthlyRouteMapCard'
import PortalKeyViewModal from '../features/monthlyRoutes/PortalKeyViewModal'
import { fetchRouteKeyViewStops } from '../features/monthlyRoutes/portalKeyViewShared'
import {
  activeRouteLocations,
  libraryLocationHasMapCoordinates,
  mergeVisibleRouteLocationReorder,
  monthFirstIsoPacificToday,
  parseYearMonth,
  toMonthKey,
  type MonthlyLocationComment,
  type MonthlyRouteDetailPayload,
  type MonthlyRouteSpecialistsPayload,
  type MonthlyRouteSummary,
  type MonthlySpecialistTechRow,
  type RouteLocationListItem,
  type TechnicianWorksheetLocation,
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
} from '../features/monthlyRoutes/routeRunsDisplay'
import { locationAddressSubline, locationPrimaryLabel } from '../features/monthlyRoutes/locationDisplay'
import { apiJson, apiPostFormData, isAbortError } from '../lib/apiClient'
import { formatCurrencyCad } from '../lib/formatCurrencyCad'
import MonthlyRouteDetailPageSkeleton from './MonthlyRouteDetailPageSkeleton'

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

type RouteSiteRow = { id: number; sort_order: number; label: string | null; annual_month: string | null }
function testingSitesForRouteLocation(loc: RouteLocationListItem): RouteSiteRow[] {
  return [{ id: loc.id, sort_order: 0, label: loc.label ?? null, annual_month: loc.annual_month ?? null }]
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
        const { buildingName, navigationAddress } = routeLocationSubtext(loc, rowLabel)
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
                  aria-label={`Drag to reorder: ${locationLabel}`}
                  {...attributes}
                  {...listeners}
                >
                  <i className="bi bi-grip-vertical fs-5" aria-hidden />
                </button>
              ) : null}
            </td>
            <td className="text-center tabular-nums fw-semibold">{stopStart + siteIndex}</td>
            <td>
              <Link className="link-primary text-break fw-semibold" to={`/monthlies/locations/${loc.id}`}>
                {rowLabel}
              </Link>
              {buildingName ? (
                <div className="small text-muted text-break">{buildingName}</div>
              ) : null}
              {navigationAddress ? (
                <div className="small text-muted text-break">{navigationAddress}</div>
              ) : null}
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
  targetMonthIso?: string | null
  onUploaded?: (result: UploadRunResponse) => void
}

function UploadRunFromCsvModal({
  show,
  onClose,
  routeId,
  routeNumber,
  routeLabel,
  targetMonthIso = null,
  onUploaded,
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
      if (targetMonthIso && res.month_date !== targetMonthIso) {
        setError(
          `This CSV is dated ${formatMonthHeading(res.month_date)} but you opened upload for ${formatMonthHeading(targetMonthIso)}. Choose a CSV for the correct month.`
        )
        return
      }
      setResult(res)
      onUploaded?.(res)
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
  }, [file, routeId, syncStopOrder, targetMonthIso, onUploaded])

  const formattedMonth = result?.month_date
    ? formatMonthHeading(result.month_date)
    : null
  const monthIso = result?.month_date ?? null
  const targetMonthLabel = targetMonthIso ? formatMonthHeading(targetMonthIso) : null

  return (
    <Modal show={show} onHide={onClose} size="lg" backdrop={submitting ? 'static' : true}>
      <Modal.Header closeButton={!submitting}>
        <Modal.Title>Upload run from CSV</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {targetMonthLabel ? (
          <Alert variant="info" className="mb-3">
            CSV must be dated <strong>{targetMonthLabel}</strong> (check the sheet DATE row).
          </Alert>
        ) : null}
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
                    worksheet location
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

type SkipRunConfirmModalProps = {
  show: boolean
  monthIso: string | null
  submitting: boolean
  error: string | null
  onClose: () => void
  onConfirm: () => void
}

function SkipRunConfirmModal({
  show,
  monthIso,
  submitting,
  error,
  onClose,
  onConfirm,
}: SkipRunConfirmModalProps) {
  const monthLabel = monthIso ? formatMonthHeading(monthIso) : null
  return (
    <Modal show={show} onHide={onClose} backdrop={submitting ? 'static' : true}>
      <Modal.Header closeButton={!submitting}>
        <Modal.Title>Skip run</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {monthLabel ? (
          <p className="mb-3">
            Mark <strong>{monthLabel}</strong> as skipped? Every site on this route will be set to
            skipped with billing status <strong>Waive</strong>, and the month will be closed.
          </p>
        ) : null}
        {error ? <Alert variant="danger">{error}</Alert> : null}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button variant="primary" onClick={onConfirm} disabled={submitting || !monthIso}>
          {submitting ? (
            <>
              <Spinner size="sm" animation="border" role="status" className="me-2" />
              Skipping…
            </>
          ) : (
            'Skip run'
          )}
        </Button>
      </Modal.Footer>
    </Modal>
  )
}

function runsStageBadgeClass(stageLabel: string, hasRunData: boolean): string {
  if (!hasRunData || stageLabel.trim().toLowerCase() === 'no data') {
    return 'monthly-route-stage-badge monthly-route-stage-badge--empty'
  }
  const normalized = stageLabel.trim().toLowerCase()
  if (normalized.includes('complete') || normalized.includes('review')) {
    return 'monthly-route-stage-badge monthly-route-stage-badge--success'
  }
  if (normalized.includes('skip')) {
    return 'monthly-route-stage-badge monthly-route-stage-badge--muted'
  }
  return 'monthly-route-stage-badge monthly-route-stage-badge--info'
}

function RouteMetricCard({
  label,
  value,
  meta,
  tone,
}: {
  label: string
  value: ReactNode
  meta?: ReactNode
  tone?: 'success' | 'info' | 'warning'
}) {
  const className = `monthly-route-metric-card${tone ? ` monthly-route-metric-card--${tone}` : ''}`
  return (
    <div className={className}>
      <div className="monthly-route-metric-label">{label}</div>
      <div className="monthly-route-metric-value">{value}</div>
      {meta ? <div className="monthly-route-metric-meta">{meta}</div> : null}
    </div>
  )
}

function RouteSectionHeader({
  icon,
  title,
  subtitle,
  badge,
}: {
  icon: string
  title: string
  subtitle?: string
  badge?: ReactNode
}) {
  return (
    <div className="monthly-route-section-header">
      <span className="monthly-route-section-icon" aria-hidden>
        <i className={`bi ${icon}`} />
      </span>
      <span className="monthly-route-section-copy">
        <span className="monthly-route-section-title">{title}</span>
        {subtitle ? <span className="monthly-route-section-subtitle">{subtitle}</span> : null}
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
  const [runsByMonth, setRunsByMonth] = useState<MonthlyRouteDetailPayload['runs_by_month']>({})
  const [specialistsByMonth, setSpecialistsByMonth] = useState<MonthlyRouteDetailPayload['specialists_by_month']>(
    {}
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sessionUsername, setSessionUsername] = useState<string | null>(null)
  const [activeTechNames, setActiveTechNames] = useState<Set<string> | null>(null)
  const [historyViewYear, setHistoryViewYear] = useState<number | null>(null)
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
        setRunsByMonth(data.runs_by_month || {})
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
        setRunsByMonth({})
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

  const confirmSkipRun = useCallback(async () => {
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
        { method: 'POST' }
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
  }, [skipConfirmMonthIso, idNum, patchRunsByMonthFromApiRun])

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

  const routeStopTotal = useMemo(
    () => visibleSites.reduce((sum, loc) => sum + routeLocationStopCount(loc), 0),
    [visibleSites],
  )

  const openKeyView = useCallback(async () => {
    if (Number.isNaN(idNum) || routeStopTotal === 0) return
    setKeyViewLoading(true)
    setKeyViewError(null)
    try {
      const stops = await fetchRouteKeyViewStops(idNum, monthFirstIsoPacificToday())
      setKeyViewStops(stops)
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

  if (loading) {
    return <MonthlyRouteDetailPageSkeleton />
  }

  if (error || !route) {
    return (
      <div className="monthly-route-detail-page">
        <div className="monthly-route-detail-container">
          <Alert variant="danger">{error || 'Route not found.'}</Alert>
          <Link to="/monthlies" className="monthly-location-back-link">
            <i className="bi bi-chevron-left" aria-hidden />
            Monthlies
          </Link>
        </div>
      </div>
    )
  }

  const stUrl = route.service_trade_route_location_url
  const routeLocationCount = visibleSites.length
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
  const routeMapOrderSignature = visibleSites
    .map((loc) => `${loc.id}:${loc.route_stop_order ?? ''}:${loc.latitude ?? ''}:${loc.longitude ?? ''}`)
    .join('|')
  const metricsRevenueYear = effectiveHistoryYear ?? new Date().getFullYear()
  const metricsRunsYear = effectiveRunsYear ?? new Date().getFullYear()

  return (
    <div className="monthly-route-detail-page">
      <div className="monthly-route-detail-container">
        <Link to="/monthlies" className="monthly-location-back-link">
          <i className="bi bi-chevron-left" aria-hidden />
          Monthlies
        </Link>

        <section className="monthly-route-detail-hero monthly-location-detail-hero monthly-location-detail-surface">
          <div className="monthly-location-detail-hero-main">
            <div className="monthly-location-hero-topline">
              <span className="monthly-location-detail-eyebrow">Monthly route</span>
              <span className="monthly-location-hero-id">R{route.route_number}</span>
            </div>
            <h1 className="monthly-location-detail-title">{route.label}</h1>
            {heroTopSpecialists.length > 0 ? (
              <div className="monthly-location-hero-meta monthly-route-detail-hero__specialists" aria-label="Top monthly specialists">
                <span className="monthly-route-detail-hero__specialists-label">
                  <i className="bi bi-award" aria-hidden />
                  Top specialists
                </span>
                {heroTopSpecialists.map((tech, index) => (
                  <span
                    key={`${specialistTechLabel(tech)}:${index}`}
                    className={`monthly-route-detail-hero__specialist-chip monthly-tech-badge ${specialistBadgeClass(specialistTechJobs(tech))}`}
                    title={`${specialistBadgeTier(specialistTechJobs(tech))} tier`}
                  >
                    {specialistTechLabel(tech)}
                    <span className="tabular-nums">({specialistTechJobs(tech)})</span>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <div className="monthly-location-hero-actions">
            {reviewPaperworkMonthIso ? (
              <Link
                to={`/monthlies/routes/${idNum}/paperwork?month=${encodeURIComponent(reviewPaperworkMonthIso)}`}
                className="btn btn-success btn-sm monthly-location-detail-action monthly-route-detail-hero__review-paperwork-action"
              >
                <i className="bi bi-clipboard-check" aria-hidden />
                Review Run Paperwork
              </Link>
            ) : null}
            <Link
              to={`/monthlies/routes/${idNum}/paperwork`}
              className="btn btn-primary btn-sm monthly-location-detail-action"
            >
              <i className="bi bi-folder2-open" aria-hidden />
              Paperwork
            </Link>
            <div className="monthly-route-detail-hero__paired-actions">
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
                onClick={() => openUploadCsv(null)}
              >
                <i className="bi bi-upload" aria-hidden />
                Upload CSV
              </Button>
            </div>
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
        </section>

        {keyViewError ? (
          <Alert variant="danger" dismissible onClose={() => setKeyViewError(null)} className="mb-0">
            {keyViewError}
          </Alert>
        ) : null}

        <div className="monthly-route-metric-grid" aria-label="Route summary">
          <RouteMetricCard label="Locations" value={<span className="tabular-nums">{routeLocationCount}</span>} />
          <RouteMetricCard label="Stops" value={<span className="tabular-nums">{routeStopTotal}</span>} />
          <RouteMetricCard
            label={`Tested revenue (${metricsRevenueYear})`}
            value={formatCurrencyCad(selectedYearRevenue)}
            tone="success"
            meta={
              testedSitesMissingPriceYear > 0
                ? `${testedSitesMissingPriceYear} missing ${testedSitesMissingPriceYear === 1 ? 'price' : 'prices'}`
                : undefined
            }
          />
          <RouteMetricCard
            label={`Runs with data (${metricsRunsYear})`}
            value={<span className="tabular-nums">{runsWithDataCount}</span>}
            tone="info"
          />
        </div>

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
              subtitle="Stop order and map pins for assigned locations"
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
              subtitle="Drag to reorder; saves automatically"
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
              <>
                <div className="monthly-route-detail-note">
                  <span>
                    <i className="bi bi-info-circle" aria-hidden />
                    {visibleSites.length} assigned locations
                  </span>
                  <span>
                    <i className="bi bi-arrow-repeat" aria-hidden />
                    Order saves automatically after drop
                  </span>
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
                          <th>Location</th>
                          <th style={{ width: '6.5rem' }} className="text-nowrap">
                            Annual
                          </th>
                          <th style={{ width: '7rem' }}>Status</th>
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
              </>
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
              subtitle="Monthly paperwork and CSV upload history"
              badge={runsWithDataCount}
            />
          </Accordion.Header>
          <Accordion.Body className="monthly-location-testing-history-body">
            {runsCardYears.length > 0 ? (
              <div className="monthly-route-detail-section-toolbar">
                <p className="monthly-route-detail-section-toolbar__intro mb-0">
                  Review run dates, testing progress, and paperwork for each month.
                </p>
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
              <div className="monthly-route-detail-table-shell">
                <Table size="sm" className="monthly-route-detail-table monthly-route-detail-runs-table mb-0 align-middle">
                  <thead>
                    <tr className="small text-muted text-uppercase">
                      <th>Month</th>
                      <th>Date</th>
                      <th className="text-nowrap">Sites tested</th>
                      <th>Stage</th>
                      <th className="text-end">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runsCardRows.map(({ monthIso, run, specialistMonth, hasRunData }) => (
                      <tr key={monthIso}>
                        <td className="fw-semibold">{formatMonthHeading(monthIso)}</td>
                        <td className="text-nowrap">
                          {run ? formatRunDisplayDate(run, specialistMonth) : '—'}
                        </td>
                        <td className="tabular-nums">
                          {run ? formatSitesTestedRatio(run) : '—'}
                        </td>
                        <td>
                          {(() => {
                            const stageLabel = formatRunsCardStageLabel({
                              monthIso,
                              run,
                              specialistMonth,
                              hasRunData,
                            })
                            const stageClass = runsStageBadgeClass(stageLabel, hasRunData)
                            return <span className={stageClass}>{stageLabel}</span>
                          })()}
                        </td>
                        <td className="text-end">
                          {hasRunData && run ? (
                            <Link
                              to={`/monthlies/routes/${idNum}/paperwork?month=${encodeURIComponent(monthIso)}`}
                              className="btn btn-outline-primary btn-sm"
                            >
                              Open paperwork
                            </Link>
                          ) : (
                            <div className="d-inline-flex flex-wrap gap-2 justify-content-end">
                              <Button
                                type="button"
                                variant="outline-secondary"
                                size="sm"
                                onClick={() => openSkipConfirm(monthIso)}
                              >
                                Skip run
                              </Button>
                              <Button
                                type="button"
                                variant="outline-secondary"
                                size="sm"
                                onClick={() => openUploadCsv(monthIso)}
                              >
                                Upload CSV
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
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
              subtitle="Tested-site revenue by calendar year"
              badge={formatCurrencyCad(selectedYearRevenue)}
            />
          </Accordion.Header>
          <Accordion.Body className="monthly-location-testing-history-body">
            <div className="monthly-route-detail-performance__content">
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
                  <div className="monthly-route-detail-section-toolbar">
                    <p className="monthly-route-detail-section-toolbar__intro mb-0">
                      Compare monthly tested revenue across the selected calendar year.
                    </p>
                    <RouteYearToolbar
                      year={effectiveHistoryYear}
                      yearIndex={testingHistoryYearIndex}
                      years={testingHistoryYears}
                      onChangeYear={setHistoryViewYear}
                    />
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
            </div>
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
              subtitle="Office notes for this route"
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
      </div>
      <UploadRunFromCsvModal
        show={uploadRunOpen}
        onClose={closeUploadCsv}
        routeId={idNum}
        routeNumber={route.route_number}
        routeLabel={route.label}
        targetMonthIso={uploadTargetMonthIso}
        onUploaded={handleCsvUploaded}
      />
      <SkipRunConfirmModal
        show={skipConfirmMonthIso != null}
        monthIso={skipConfirmMonthIso}
        submitting={skipSubmitting}
        error={skipError}
        onClose={closeSkipConfirm}
        onConfirm={() => void confirmSkipRun()}
      />
      <PortalKeyViewModal
        show={keyViewOpen}
        onHide={() => setKeyViewOpen(false)}
        stops={keyViewStops}
        activeStopId={null}
      />
    </div>
  )
}
