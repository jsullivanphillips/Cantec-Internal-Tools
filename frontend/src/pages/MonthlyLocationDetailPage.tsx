import type { ReactElement, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Accordion, Alert, Badge, Button, Card, Col, Form, Row, Spinner, Table } from 'react-bootstrap'
import { Link, useNavigate, useParams } from 'react-router-dom'
import MonthlyLibraryCommentsPanel from '../features/monthlyRoutes/MonthlyLibraryCommentsPanel'
import MonthlyLocationLibraryModal from '../features/monthlyRoutes/MonthlyLocationLibraryModal'
import {
  isMonthlyTestingHistoryEditable,
  libraryRouteDisplay,
  monthlyRouteOccurrenceDateUtc,
  nextUntestedMonthIso,
  parseYearMonth,
  toMonthKey,
  type LibraryLocation,
  type LibraryPayload,
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
  const d = monthlyRouteOccurrenceDateUtc(monthIso, loc.monthly_route)
  if (!d) return null
  return new Intl.DateTimeFormat('en-CA', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d)
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

function streetViewUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps?layer=c&cbll=${lat},${lng}`
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

type HistoryEdit =
  | { kind: 'result'; monthIso: string; value: 'tested' | 'skipped' }
  | { kind: 'skip_reason'; monthIso: string; value: string }

function normalizeHistoryResultStatus(raw: string | undefined): 'tested' | 'skipped' {
  return raw?.toLowerCase() === 'skipped' ? 'skipped' : 'tested'
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
  const n = normalizeHistoryResultStatus(cell.result_status)
  if (n === 'tested') return 'monthly-location-testing-history-result--tested'
  if (n === 'skipped') return 'monthly-location-testing-history-result--skipped'
  return ''
}

function testingHistoryResultDisplayText(
  cell: MonthCell | undefined,
  isNextSlot: boolean,
  isAnnualMonthRow: boolean
): string {
  if (!cell) {
    if (isAnnualMonthRow) return 'Annual'
    if (isNextSlot) return 'Pending'
    return 'No data'
  }
  return cell.result_status
}

function testingHistoryResultMainLabel(
  cell: MonthCell | undefined,
  isNextSlot: boolean,
  isAnnualMonthRow: boolean
): ReactNode {
  if (!cell) {
    return testingHistoryResultDisplayText(cell, isNextSlot, isAnnualMonthRow)
  }
  if (normalizeHistoryResultStatus(cell.result_status) === 'skipped') {
    return (
      <>
        <span className="text-capitalize">Skipped</span>
        {cell.skip_reason?.trim() ? (
          <>
            {' — '}
            <span className="text-break">{cell.skip_reason.trim()}</span>
          </>
        ) : null}
      </>
    )
  }
  return <span className="text-capitalize">{cell.result_status}</span>
}

function testingHistoryRouteContextLine(cell: MonthCell | undefined): ReactNode {
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

export default function MonthlyLocationDetailPage() {
  const { locationId } = useParams<{ locationId: string }>()
  const navigate = useNavigate()
  const [location, setLocation] = useState<LibraryLocation | null>(null)
  const [comments, setComments] = useState<MonthlyLocationComment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [routeOptions, setRouteOptions] = useState<string[]>([])
  const [showEditModal, setShowEditModal] = useState(false)
  const [sessionUsername, setSessionUsername] = useState<string | null>(null)
  /** Selected calendar year for testing-history grid; ``null`` means “use default year” until user picks one. */
  const [historyViewYear, setHistoryViewYear] = useState<number | null>(null)
  const [historyEdit, setHistoryEdit] = useState<HistoryEdit | null>(null)
  const [historySaving, setHistorySaving] = useState(false)
  const [historySaveError, setHistorySaveError] = useState<string | null>(null)

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
      } catch (e) {
        if (isAbortError(e)) return
        setError('Unable to load this location.')
        setLocation(null)
        setComments([])
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
    apiJson<LibraryPayload>('/api/monthly_routes/library?page=1&page_size=1')
      .then((data) => {
        if (active) setRouteOptions(data.meta?.routes ?? [])
      })
      .catch(() => {
        if (active) setRouteOptions([])
      })
    return () => {
      active = false
    }
  }, [])

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
    setHistoryEdit(null)
    setHistorySaveError(null)
  }, [])

  const saveHistoryResultEdit = useCallback(async () => {
    if (!location || !historyEdit || historyEdit.kind !== 'result') return
    const { monthIso, value } = historyEdit
    const existing = location.months[monthIso]
    const skip_reason =
      value === 'skipped' ? (existing?.skip_reason?.trim() || null) : null

    setHistorySaving(true)
    setHistorySaveError(null)
    try {
      const res = await apiJson<{ location: LibraryLocation }>(
        `/api/monthly_routes/library/${location.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            months: {
              [monthIso]: {
                result_status: value,
                skip_reason,
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
      setHistorySaveError(msg || 'Unable to save testing history.')
    } finally {
      setHistorySaving(false)
    }
  }, [location, historyEdit, cancelHistoryEdit])

  const saveHistorySkipEdit = useCallback(async () => {
    if (!location || !historyEdit || historyEdit.kind !== 'skip_reason') return
    const { monthIso, value } = historyEdit
    const existing = location.months[monthIso]
    if (!existing) return

    setHistorySaving(true)
    setHistorySaveError(null)
    try {
      const res = await apiJson<{ location: LibraryLocation }>(
        `/api/monthly_routes/library/${location.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            months: {
              [monthIso]: {
                result_status: normalizeHistoryResultStatus(existing.result_status),
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

  useEffect(() => {
    if (!historyEdit || historySaving) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') cancelHistoryEdit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [historyEdit, historySaving, cancelHistoryEdit])

  if (!locationId || Number.isNaN(idNum)) {
    return (
      <div className="container py-4">
        <Alert variant="warning">Invalid location.</Alert>
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

  if (error || !location) {
    return (
      <div className="container py-4">
        <Alert variant="danger">{error || 'Location not found.'}</Alert>
        <Link to="/monthlies/routes">Back to Monthly Routes</Link>
      </div>
    )
  }

  const routeLabel = libraryRouteDisplay(location)
  const routeDetailId = location.monthly_route?.id ?? location.monthly_route_id ?? null
  const lat = location.latitude ?? undefined
  const lng = location.longitude ?? undefined
  const title =
    location.building?.trim() != null && location.building.trim() !== ''
      ? `${location.address} (${location.building})`
      : location.address

  const testingHistoryGridYear =
    testingHistoryYears.length === 0
      ? null
      : (effectiveTestingHistoryYear ?? defaultTestingHistoryYear(testingHistoryYears))
  const testingHistoryYearIndex =
    testingHistoryGridYear != null ? testingHistoryYears.indexOf(testingHistoryGridYear) : -1

  const historyYearNavLocked = historySaving || historyEdit != null

  return (
    <div className="monthly-location-detail-page pt-0 pb-4 px-3 px-lg-4 mt-n3">
      <div className="mb-3">
        <Link to="/monthlies/routes" className="text-decoration-none">
          ← Monthly Routes library
        </Link>
      </div>

      <Card className="monthly-location-detail-surface monthly-location-detail-hero mb-2">
        <Card.Body className="p-4">
          <div className="d-flex justify-content-between align-items-start flex-wrap gap-3 mb-4">
            <div className="min-w-0 flex-grow-1">
              <div className="text-muted small text-uppercase fw-semibold mb-1">Location</div>
              <h1 className="processing-page-title mb-0">{title}</h1>
            </div>
            <Button
              type="button"
              variant="outline-primary"
              size="sm"
              className="d-inline-flex align-items-center gap-2 flex-shrink-0 align-self-start fw-semibold"
              onClick={() => setShowEditModal(true)}
            >
              <i className="bi bi-pencil-square" aria-hidden />
              Edit location
            </Button>
          </div>

          <Row className="g-4">
            <Col md={6} lg={3}>
              <div className="text-muted small text-uppercase fw-semibold mb-1">Location</div>
              <div className="text-break">{location.display_address || location.address}</div>
              {lat != null && lng != null ? (
                <a
                  href={streetViewUrl(lat, lng)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="d-inline-block mt-2 small"
                >
                  Google Street View
                </a>
              ) : null}
            </Col>
            <Col md={6} lg={3}>
              <div className="text-muted small text-uppercase fw-semibold mb-1">Route</div>
              {routeDetailId != null && routeLabel !== '—' ? (
                <Link to={`/monthlies/routes/${routeDetailId}`} className="fw-semibold text-decoration-none">
                  {routeLabel}
                </Link>
              ) : (
                <span className="fw-semibold">{routeLabel}</span>
              )}
              <div className="text-muted small mt-2 text-uppercase fw-semibold mb-1">Testing day</div>
              <div>{location.test_day?.trim() || '—'}</div>
            </Col>
            <Col md={6} lg={3}>
              <div className="text-muted small text-uppercase fw-semibold mb-1">Monthly price</div>
              <div className="fw-semibold">{formatPriceCad(location.price_per_month)}</div>
              <div className="text-muted small mt-2 text-uppercase fw-semibold mb-1">Status</div>
              <Badge bg={statusBadgeVariant(location.status_normalized)} className="text-capitalize">
                {(location.status_raw || location.status_normalized || '').replace(/_/g, ' ') || '—'}
              </Badge>
            </Col>
            <Col md={6} lg={3}>
              <div className="text-muted small text-uppercase fw-semibold mb-1">Property management</div>
              <div className="text-break">{location.property_management_company || '—'}</div>
              <div className="text-muted small mt-2 text-uppercase fw-semibold mb-1">Key</div>
              {location.key ? (
                <Link to={`/keys/${location.key.id}`} className="fw-semibold text-decoration-none">
                  {location.key.keycode}
                </Link>
              ) : (
                <span>{location.keys?.trim() || '—'}</span>
              )}
            </Col>
          </Row>

          {location.notes?.trim() ? (
            <div className="mt-4 pt-3 border-top">
              <div className="text-muted small text-uppercase fw-semibold mb-1">Notes (spreadsheet)</div>
              <div className="text-break small" style={{ whiteSpace: 'pre-wrap' }}>
                {location.notes}
              </div>
            </div>
          ) : null}
        </Card.Body>
      </Card>

      <MonthlyLocationLibraryModal
        location={showEditModal ? location : null}
        routeOptions={routeOptions}
        openInEditMode
        onHide={() => setShowEditModal(false)}
        onSaved={(loc) => {
          setLocation(loc)
        }}
        onDeleted={() => navigate('/monthlies/routes')}
      />

      <Accordion
        defaultActiveKey={['history', 'comments']}
        alwaysOpen
        className="monthly-location-detail-accordion d-flex flex-column gap-2"
      >
        <Accordion.Item
          eventKey="history"
          className="monthly-location-testing-history-card monthly-location-detail-surface shadow-sm bg-white"
        >
          <Accordion.Header className="monthly-location-testing-history-card-header py-3">
            <span className="fw-semibold">Testing history</span>
          </Accordion.Header>
          <Accordion.Body className="monthly-location-testing-history-body">
            {testingHistoryYears.length === 0 ? (
              <div className="text-muted small">No monthly test outcomes recorded yet.</div>
            ) : (
              <div className="monthly-location-testing-history-table-wrap">
                <div className="d-flex flex-wrap align-items-center gap-2 justify-content-start mb-3">
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
                <Table
                  responsive
                  size="sm"
                  bordered
                  className="mb-0 small monthly-location-testing-history-grid-table"
                >
                  <colgroup>
                    <col className="monthly-history-col-month" />
                    <col className="monthly-history-col-result" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {testingHistoryGridYear != null
                      ? monthIsoKeysForCalendarYear(testingHistoryGridYear).map((monthIso) => {
                          const cell = location.months[monthIso]
                          const testDayLabel = formatScheduledTestDay(monthIso, location)
                          const isNextSlot = !cell && monthIso === nextTestingMonthIso
                          const isAnnualMonthRow = isAnnualMonth(monthIso, location.annual_month)
                          const canEditMonth = isMonthlyTestingHistoryEditable(monthIso, location)
                          const editingResult =
                            historyEdit?.kind === 'result' && historyEdit.monthIso === monthIso
                          const editingSkip =
                            historyEdit?.kind === 'skip_reason' && historyEdit.monthIso === monthIso

                          const monthTd = (
                            <td>
                              {isNextSlot ? (
                                <div className="text-muted small text-uppercase fw-semibold mb-1">
                                  Next test
                                </div>
                              ) : null}
                              <div>{formatMonthHeading(monthIso)}</div>
                              {testDayLabel ? (
                                <div className="text-muted small">{testDayLabel}</div>
                              ) : null}
                            </td>
                          )

                          const rowClass =
                            isNextSlot && !cell
                              ? 'monthly-location-testing-history-next-row table-light'
                              : !cell && !isNextSlot
                                ? 'text-muted'
                                : undefined

                          const canEditSkip =
                            canEditMonth &&
                            cell != null &&
                            normalizeHistoryResultStatus(cell.result_status) === 'skipped'

                          let resultTd: ReactElement
                          if (editingSkip && historyEdit?.kind === 'skip_reason') {
                            resultTd = (
                              <td
                                className={[
                                  testingHistoryResultCellClass(
                                    cell,
                                    { editing: true, editValue: 'skipped' },
                                    isAnnualMonthRow
                                  ),
                                ]
                                  .filter(Boolean)
                                  .join(' ')}
                              >
                                <Form.Control
                                  size="sm"
                                  type="text"
                                  className="mb-2"
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
                              </td>
                            )
                          } else if (editingResult && historyEdit?.kind === 'result') {
                            resultTd = (
                              <td
                                className={[
                                  'text-capitalize',
                                  testingHistoryResultCellClass(
                                    cell,
                                    {
                                      editing: true,
                                      editValue: historyEdit.value,
                                    },
                                    isAnnualMonthRow
                                  ),
                                ]
                                  .filter(Boolean)
                                  .join(' ')}
                              >
                                <Form.Select
                                  size="sm"
                                  className="mb-2"
                                  value={historyEdit.value}
                                  disabled={historySaving}
                                  onChange={(e) =>
                                    setHistoryEdit({
                                      ...historyEdit,
                                      value: e.target.value === 'skipped' ? 'skipped' : 'tested',
                                    })
                                  }
                                  aria-label="Test result"
                                >
                                  <option value="tested">Tested</option>
                                  <option value="skipped">Skipped</option>
                                </Form.Select>
                                <div className="d-flex flex-wrap gap-2">
                                  <Button
                                    type="button"
                                    variant="primary"
                                    size="sm"
                                    disabled={historySaving}
                                    onClick={() => void saveHistoryResultEdit()}
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
                              </td>
                            )
                          } else if (!canEditMonth) {
                            resultTd = (
                              <td
                                className={
                                  [
                                    cell
                                      ? 'text-capitalize'
                                      : isAnnualMonthRow
                                        ? 'fw-semibold'
                                        : isNextSlot
                                          ? 'text-muted fst-italic'
                                          : 'fst-italic',
                                    testingHistoryResultCellClass(cell, { editing: false }, isAnnualMonthRow),
                                  ]
                                    .filter(Boolean)
                                    .join(' ') || undefined
                                }
                              >
                                {testingHistoryResultMainLabel(cell, isNextSlot, isAnnualMonthRow)}
                                {testingHistoryRouteContextLine(cell)}
                              </td>
                            )
                          } else {
                            resultTd = (
                              <td
                                className={[
                                  testingHistoryResultCellClass(cell, { editing: false }, isAnnualMonthRow),
                                ]
                                  .filter(Boolean)
                                  .join(' ')}
                              >
                                <div className="d-flex flex-wrap align-items-baseline gap-2">
                                  <button
                                    type="button"
                                    className="btn btn-link btn-sm p-0 text-decoration-none text-body text-start"
                                    disabled={historySaving}
                                    onClick={() => {
                                      if (historySaving) return
                                      if (
                                        historyEdit &&
                                        (historyEdit.monthIso !== monthIso ||
                                          historyEdit.kind !== 'result')
                                      ) {
                                        return
                                      }
                                      setHistorySaveError(null)
                                      setHistoryEdit({
                                        kind: 'result',
                                        monthIso,
                                        value: normalizeHistoryResultStatus(cell?.result_status),
                                      })
                                    }}
                                  >
                                    {testingHistoryResultMainLabel(cell, isNextSlot, isAnnualMonthRow)}
                                  </button>
                                  {canEditSkip && !historyEdit ? (
                                    <button
                                      type="button"
                                      className="btn btn-link btn-sm p-0 text-decoration-none"
                                      disabled={historySaving}
                                      onClick={() => {
                                        if (historySaving) return
                                        setHistorySaveError(null)
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
                                {testingHistoryRouteContextLine(cell)}
                              </td>
                            )
                          }

                          return (
                            <tr key={monthIso} className={rowClass}>
                              {monthTd}
                              {resultTd}
                            </tr>
                          )
                        })
                      : null}
                  </tbody>
                </Table>
              </div>
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
  )
}
