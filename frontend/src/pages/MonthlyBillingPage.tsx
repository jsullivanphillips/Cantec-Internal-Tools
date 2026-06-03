import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, Card, Form, OverlayTrigger, Spinner, Table, Tooltip } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import {
  billingStatusLabel,
  billingStatusVariant,
  fetchBillingBoard,
  formatMonthHeader,
  patchQuarterBilled,
  quarterTitle,
  billingBoardShowUnsetDash,
  type BillingBoardLocationRow,
  type BillingBoardPayload,
} from '../features/monthlyRoutes/monthlyBillingBoard'
import { billingBoardLocationSubline, billingBoardLocationTitle } from '../features/monthlyRoutes/testingSiteDisplay'
import { monthFirstIsoPacificToday, parseYearMonth, toMonthKey } from '../features/monthlyRoutes/monthlyRoutesShared'
import { isAbortError } from '../lib/apiClient'

const PAGE_SIZE = 50

function anchorMonthOptions(countBack = 18, countForward = 3): string[] {
  const anchor = parseYearMonth(monthFirstIsoPacificToday())
  if (!anchor) return [monthFirstIsoPacificToday()]
  const start = { year: anchor.year, month: anchor.month }
  const keys: string[] = []
  for (let offset = -countBack; offset <= countForward; offset += 1) {
    const total = start.year * 12 + (start.month - 1) + offset
    const year = Math.floor(total / 12)
    const month = (total % 12) + 1
    keys.push(toMonthKey(year, month))
  }
  return keys.reverse()
}

function billingRouteLabel(row: BillingBoardLocationRow): string {
  if (typeof row.route_number === 'number') return `R${row.route_number}`
  return row.test_day?.trim() || '—'
}

function BillingRouteCell({ row }: { row: BillingBoardLocationRow }) {
  const label = billingRouteLabel(row)
  const routeId = row.monthly_route_id
  if (routeId != null && label !== '—') {
    return (
      <Link
        to={`/monthlies/routes/${routeId}`}
        className="fw-semibold text-decoration-none"
        onClick={(e) => e.stopPropagation()}
      >
        {label}
      </Link>
    )
  }
  return <>{label}</>
}

function BillingMonthCell({
  cell,
  monthIso,
}: {
  cell: BillingBoardLocationRow['months'][string] | undefined
  monthIso: string
}) {
  const billing = cell?.billing_status ?? 'unset'
  if (billingBoardShowUnsetDash(cell, monthIso)) {
    return <span className="text-muted">—</span>
  }
  const skipCategory =
    billing === 'do_not_bill' ? cell?.skip_reason_category?.trim() || null : null
  return (
    <div className="d-flex flex-column align-items-center gap-1">
      <Badge bg={billingStatusVariant(billing)} className="text-wrap small">
        {billingStatusLabel(billing)}
      </Badge>
      {skipCategory ? (
        <span className="small text-muted text-wrap">{skipCategory}</span>
      ) : null}
    </div>
  )
}

const BILLING_SKELETON_ROW_COUNT = 8

function BillingBoardTableSkeleton({ monthDates }: { monthDates: string[] }) {
  const monthCols = monthDates.length > 0 ? monthDates.length : 3
  return (
    <div
      className="monthly-billing-table-skeleton"
      aria-busy="true"
      aria-label="Loading billing locations"
    >
      <Table responsive className="mb-0 align-middle">
        <thead>
          <tr>
            <th style={{ minWidth: '14rem' }}>Address</th>
            <th style={{ minWidth: '5rem' }}>Route</th>
            {monthDates.length > 0
              ? monthDates.map((monthIso) => (
                  <th key={monthIso} className="text-center" style={{ minWidth: '7rem' }}>
                    {formatMonthHeader(monthIso)}
                  </th>
                ))
              : Array.from({ length: monthCols }, (_, i) => (
                  <th key={i} className="text-center" style={{ minWidth: '7rem' }}>
                    <span
                      className="home-skeleton-bar d-inline-block"
                      style={{ width: '3.25rem', height: '0.75rem' }}
                    />
                  </th>
                ))}
            <th className="text-center" style={{ minWidth: '7rem' }}>
              Quarter
            </th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: BILLING_SKELETON_ROW_COUNT }, (_, rowIdx) => (
            <tr key={rowIdx}>
              <td>
                <span
                  className="home-skeleton-bar d-block mb-1"
                  style={{ width: '88%', height: '0.9rem' }}
                />
                <span className="home-skeleton-bar d-block" style={{ width: '52%', height: '0.75rem' }} />
              </td>
              <td>
                <span className="home-skeleton-bar d-block" style={{ width: '2.25rem', height: '0.75rem' }} />
              </td>
              {Array.from({ length: monthCols }, (_, colIdx) => (
                <td key={colIdx} className="text-center">
                  <span
                    className="home-skeleton-bar d-inline-block"
                    style={{ width: '4.25rem', height: '1.35rem', borderRadius: '0.35rem' }}
                  />
                </td>
              ))}
              <td className="text-center">
                <span
                  className="home-skeleton-bar d-inline-block"
                  style={{ width: '5.75rem', height: '1.85rem', borderRadius: '0.35rem' }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  )
}

export default function MonthlyBillingPage() {
  const monthOptions = useMemo(() => anchorMonthOptions(), [])
  const [anchorMonth, setAnchorMonth] = useState(monthFirstIsoPacificToday())
  const [query, setQuery] = useState('')
  const [routeFilter, setRouteFilter] = useState('')
  const [billAnyMonth, setBillAnyMonth] = useState(false)
  const [unsetAnyMonth, setUnsetAnyMonth] = useState(false)
  const [notBilledQuarter, setNotBilledQuarter] = useState(false)
  const [failedAnyMonth, setFailedAnyMonth] = useState(false)
  const [page, setPage] = useState(1)
  const [payload, setPayload] = useState<BillingBoardPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyLocationId, setBusyLocationId] = useState<number | null>(null)
  const [trackedLocationId, setTrackedLocationId] = useState<number | null>(null)
  const loadSeqRef = useRef(0)

  const load = useCallback(async () => {
    const seq = loadSeqRef.current + 1
    loadSeqRef.current = seq
    setLoading(true)
    setError(null)
    try {
      const data = await fetchBillingBoard({
        anchorMonth,
        q: query,
        route: routeFilter,
        page,
        pageSize: PAGE_SIZE,
        billAnyMonth,
        unsetAnyMonth,
        notBilledQuarter,
        failedAnyMonth,
      })
      if (loadSeqRef.current !== seq) return
      setPayload(data)
    } catch (err) {
      if (loadSeqRef.current !== seq) return
      if (!isAbortError(err)) {
        setError(err instanceof Error ? err.message : 'Unable to load billing board.')
      }
    } finally {
      if (loadSeqRef.current === seq) setLoading(false)
    }
  }, [
    anchorMonth,
    query,
    routeFilter,
    page,
    billAnyMonth,
    unsetAnyMonth,
    notBilledQuarter,
    failedAnyMonth,
  ])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setTrackedLocationId(null)
  }, [page, anchorMonth, query, routeFilter, billAnyMonth, unsetAnyMonth, notBilledQuarter, failedAnyMonth])

  const routeOptions = payload?.meta.routes ?? []
  const monthDates = payload?.month_dates ?? []
  const pagination = payload?.pagination
  const quarterHeading =
    payload != null
      ? quarterTitle(payload.year, payload.quarter, payload.month_dates)
      : null

  const paginationSummary = useMemo(() => {
    if (!pagination) return null
    const start = (pagination.page - 1) * pagination.page_size + 1
    const end = Math.min(pagination.page * pagination.page_size, pagination.total)
    if (pagination.total === 0) return 'No locations'
    return `Showing ${start}–${end} of ${pagination.total}`
  }, [pagination])

  const toggleBilled = async (row: BillingBoardLocationRow) => {
    setBusyLocationId(row.location_id)
    try {
      const result = await patchQuarterBilled(row.location_id, anchorMonth, !row.quarter_billed)
      setPayload((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          locations: prev.locations.map((loc) =>
            loc.location_id === row.location_id
              ? {
                  ...loc,
                  quarter_billed: result.quarter_billed,
                  billed_at: result.billed_at,
                  billed_by: result.billed_by,
                }
              : loc,
          ),
        }
      })
      if (notBilledQuarter && result.quarter_billed) {
        setPayload((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            locations: prev.locations.filter((loc) => loc.location_id !== row.location_id),
            pagination: {
              ...prev.pagination,
              total: Math.max(0, prev.pagination.total - 1),
            },
          }
        })
      }
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Unable to update billed status.')
    } finally {
      setBusyLocationId(null)
    }
  }

  return (
    <div className="monthly-page d-flex flex-column gap-3">
      <Card className="app-surface-card monthly-filters-card">
        <Card.Body className="p-3 p-md-4">
          <h1 className="processing-page-title mb-1">Monthly Billing</h1>
          <p className="text-muted small mb-3">
            Processor Bill / Do not bill decisions are set on route paperwork. Use this board to
            review billing by quarter and mark addresses as invoiced.
          </p>
          {quarterHeading ? (
            <p className="fw-semibold mb-3">{quarterHeading}</p>
          ) : null}
          <div className="d-flex flex-wrap align-items-end gap-3">
            <Form.Group>
              <Form.Label className="small text-muted mb-1">Month (sets quarter)</Form.Label>
              <Form.Select
                value={anchorMonth}
                onChange={(e) => {
                  setAnchorMonth(e.target.value)
                  setPage(1)
                }}
                style={{ minWidth: '11rem' }}
              >
                {monthOptions.map((key) => (
                  <option key={key} value={key}>
                    {formatMonthHeader(key)}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
            <Form.Group className="flex-grow-1" style={{ minWidth: '12rem', maxWidth: '22rem' }}>
              <Form.Label className="small text-muted mb-1">Search</Form.Label>
              <Form.Control
                placeholder="Address or PMC (use Route for R10…)"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setPage(1)
                }}
              />
            </Form.Group>
            <Form.Group>
              <Form.Label className="small text-muted mb-1">Route</Form.Label>
              <Form.Select
                value={routeFilter}
                onChange={(e) => {
                  setRouteFilter(e.target.value)
                  setPage(1)
                }}
                style={{ minWidth: '10rem' }}
              >
                <option value="">All routes</option>
                {routeOptions.map((route) => (
                  <option key={route} value={route}>
                    {route}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          </div>
          <div className="d-flex flex-wrap gap-3 mt-3">
            <Form.Check
              type="checkbox"
              id="billing-filter-bill"
              label="Bill in any month"
              checked={billAnyMonth}
              onChange={(e) => {
                setBillAnyMonth(e.target.checked)
                setPage(1)
              }}
            />
            <Form.Check
              type="checkbox"
              id="billing-filter-unset"
              label="Unset in any month"
              checked={unsetAnyMonth}
              onChange={(e) => {
                setUnsetAnyMonth(e.target.checked)
                setPage(1)
              }}
            />
            <Form.Check
              type="checkbox"
              id="billing-filter-not-billed"
              label="Not billed for quarter"
              checked={notBilledQuarter}
              onChange={(e) => {
                setNotBilledQuarter(e.target.checked)
                setPage(1)
              }}
            />
            <Form.Check
              type="checkbox"
              id="billing-filter-failed"
              label="Failed in any month"
              checked={failedAnyMonth}
              onChange={(e) => {
                setFailedAnyMonth(e.target.checked)
                setPage(1)
              }}
            />
          </div>
        </Card.Body>
      </Card>

      <Card className="app-surface-card monthly-results-card">
        <Card.Body className="p-0">
          {error ? (
            <p className="text-danger small p-3 mb-0" role="alert">
              {error}
            </p>
          ) : (
            <>
              <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 px-3 py-2 border-bottom">
                {loading ? (
                  <span
                    className="home-skeleton-bar d-inline-block"
                    style={{ width: '11rem', height: '0.85rem' }}
                    aria-hidden
                  />
                ) : (
                  <span className="small text-muted">{paginationSummary}</span>
                )}
                <div className="d-flex gap-2">
                  <Button
                    size="sm"
                    variant="outline-secondary"
                    disabled={!pagination || pagination.page <= 1 || loading}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="outline-secondary"
                    disabled={
                      !pagination ||
                      pagination.page >= pagination.total_pages ||
                      loading
                    }
                    onClick={() =>
                      setPage((p) =>
                        pagination ? Math.min(pagination.total_pages, p + 1) : p + 1,
                      )
                    }
                  >
                    Next
                  </Button>
                </div>
              </div>
              {loading ? (
                <BillingBoardTableSkeleton monthDates={monthDates} />
              ) : (
                <Table responsive hover className="mb-0 align-middle">
                  <thead>
                    <tr>
                        <th style={{ minWidth: '14rem' }}>Address</th>
                        <th style={{ minWidth: '5rem' }}>Route</th>
                        {monthDates.map((monthIso) => (
                          <th
                            key={monthIso}
                            colSpan={1}
                            className="text-center"
                            style={{ minWidth: '7rem' }}
                          >
                            {formatMonthHeader(monthIso)}
                          </th>
                        ))}
                        <th className="text-center" style={{ minWidth: '7rem' }}>
                          Quarter
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {(payload?.locations ?? []).length === 0 ? (
                        <tr>
                          <td colSpan={3 + monthDates.length} className="text-muted small p-3">
                            No active locations match your filters.
                          </td>
                        </tr>
                      ) : (
                        (payload?.locations ?? []).map((row) => {
                          const billedTooltip =
                            row.quarter_billed && row.billed_at
                              ? `Billed ${new Date(row.billed_at).toLocaleString()}${row.billed_by ? ` by ${row.billed_by}` : ''}`
                              : 'Mark as invoiced for this quarter'
                          const btn = (
                            <Button
                              size="sm"
                              variant={row.quarter_billed ? 'success' : 'outline-primary'}
                              disabled={busyLocationId === row.location_id}
                              onClick={(e) => {
                                e.stopPropagation()
                                void toggleBilled(row)
                              }}
                            >
                              {busyLocationId === row.location_id ? (
                                <Spinner animation="border" size="sm" aria-label="Saving" />
                              ) : row.quarter_billed ? (
                                'Billed'
                              ) : (
                                'Mark billed'
                              )}
                            </Button>
                          )
                          const tracked = trackedLocationId === row.location_id
                          return (
                            <tr
                              key={row.location_id}
                              className={`monthly-billing-row${tracked ? ' monthly-billing-row--tracked' : ''}`}
                              onClick={() =>
                                setTrackedLocationId((prev) =>
                                  prev === row.location_id ? null : row.location_id,
                                )
                              }
                              aria-selected={tracked}
                            >
                              <td>
                                <Link
                                  to={`/monthlies/locations/${row.location_id}`}
                                  className="fw-semibold text-decoration-none"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {billingBoardLocationTitle(row)}
                                </Link>
                                {billingBoardLocationSubline(row) ? (
                                  <div className="small text-muted">
                                    {billingBoardLocationSubline(row)}
                                  </div>
                                ) : null}
                                {row.billing_comments?.trim() ? (
                                  <div className="small text-muted text-break">
                                    {row.billing_comments.trim()}
                                  </div>
                                ) : null}
                              </td>
                              <td className="small">
                                <BillingRouteCell row={row} />
                              </td>
                              {monthDates.map((monthIso) => (
                                <td key={monthIso} className="text-center">
                                  <BillingMonthCell cell={row.months[monthIso]} monthIso={monthIso} />
                                </td>
                              ))}
                              <td className="text-center">
                                <OverlayTrigger overlay={<Tooltip>{billedTooltip}</Tooltip>}>
                                  <span className="d-inline-block">{btn}</span>
                                </OverlayTrigger>
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </Table>
              )}
            </>
          )}
        </Card.Body>
      </Card>
    </div>
  )
}
