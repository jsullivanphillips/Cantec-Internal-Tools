import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, Card, Form, OverlayTrigger, Spinner, Table, Tooltip } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import {
  billingBoardShowUnsetDash,
  billingMonthPillClickable,
  billingMonthPaperworkRouteId,
  billingStatusLabel,
  billingStatusVariant,
  currentBillingQuarter,
  fetchBillingBoard,
  formatMonthHeader,
  parseQuarterSelectionKey,
  patchQuarterBilled,
  quarterOptionLabel,
  quarterSelectionKey,
  quarterSelectionOptions,
  type BillingBoardLocationRow,
  type BillingBoardPayload,
} from '../features/monthlyRoutes/monthlyBillingBoard'
import { billingBoardLocationTitle } from '../features/monthlyRoutes/locationDisplay'
import BillingBoardCommentCell from '../features/monthlyRoutes/BillingBoardCommentCell'
import BillingBoardPaperworkModal, {
  type BillingBoardPaperworkModalContext,
} from '../features/monthlyRoutes/BillingBoardPaperworkModal'
import { isAbortError } from '../lib/apiClient'

const PAGE_SIZE = 50

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
  row,
  cell,
  monthIso,
  onOpenPaperwork,
}: {
  row: BillingBoardLocationRow
  cell: BillingBoardLocationRow['months'][string] | undefined
  monthIso: string
  onOpenPaperwork: (context: BillingBoardPaperworkModalContext) => void
}) {
  const billing = cell?.billing_status ?? 'unset'
  if (billingBoardShowUnsetDash(cell, monthIso)) {
    return <span className="text-muted">—</span>
  }
  const clickable = billingMonthPillClickable(row, cell, monthIso)
  const badge = (
    <Badge bg={billingStatusVariant(billing)} className="text-wrap small">
      {billingStatusLabel(billing)}
    </Badge>
  )

  if (!clickable) {
    return <div className="d-flex justify-content-center">{badge}</div>
  }

  const waiveReason =
    billing === 'do_not_bill' ? cell?.skip_reason_category?.trim() || null : null
  const routeId = billingMonthPaperworkRouteId(row, cell)

  const pillButton = (
    <button
      type="button"
      className="btn btn-link p-0 border-0 monthly-billing-pill--clickable"
      aria-label={
        waiveReason
          ? `Waive: ${waiveReason}. View paperwork for ${formatMonthHeader(monthIso)}.`
          : `View paperwork for ${formatMonthHeader(monthIso)} (${billingStatusLabel(billing)})`
      }
      onClick={(e) => {
        e.stopPropagation()
        if (routeId == null) return
        onOpenPaperwork({
          locationId: row.location_id,
          locationLabel: billingBoardLocationTitle(row),
          monthIso,
          routeId,
          billingStatus: billing,
          waiveReason,
        })
      }}
    >
      {badge}
    </button>
  )

  return (
    <div className="d-flex justify-content-center">
      {waiveReason ? (
        <OverlayTrigger trigger={['hover', 'focus']} overlay={<Tooltip>{waiveReason}</Tooltip>}>
          <span className="d-inline-block">{pillButton}</span>
        </OverlayTrigger>
      ) : (
        pillButton
      )}
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
      <Table responsive className="mb-0 align-middle monthly-billing-table">
        <thead>
          <tr>
            <th style={{ minWidth: '14rem' }}>Address</th>
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
              Invoiced
            </th>
            <th style={{ minWidth: '5rem' }}>Route</th>
            <th style={{ minWidth: '10rem' }}>Billing comment</th>
            <th style={{ minWidth: '10rem' }}>Property management company</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: BILLING_SKELETON_ROW_COUNT }, (_, rowIdx) => (
            <tr key={rowIdx}>
              <td>
                <span
                  className="home-skeleton-bar d-block"
                  style={{ width: '88%', height: '0.9rem' }}
                />
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
              <td>
                <span className="home-skeleton-bar d-block" style={{ width: '2.25rem', height: '0.75rem' }} />
              </td>
              <td>
                <span className="home-skeleton-bar d-block" style={{ width: '70%', height: '0.75rem' }} />
              </td>
              <td>
                <span className="home-skeleton-bar d-block" style={{ width: '75%', height: '0.75rem' }} />
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  )
}

type BillingBoardPagination = BillingBoardPayload['pagination']

function BillingBoardPaginationBar({
  loading,
  paginationSummary,
  pagination,
  onPageChange,
  position,
}: {
  loading: boolean
  paginationSummary: string | null
  pagination: BillingBoardPagination | undefined
  onPageChange: (page: number) => void
  position: 'top' | 'bottom'
}) {
  return (
    <div
      className={`d-flex flex-wrap justify-content-between align-items-center gap-2 px-3 py-2 ${
        position === 'top' ? 'border-bottom' : 'border-top'
      }`}
    >
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
          onClick={() => onPageChange(Math.max(1, (pagination?.page ?? 1) - 1))}
        >
          Previous
        </Button>
        <Button
          size="sm"
          variant="outline-secondary"
          disabled={!pagination || pagination.page >= pagination.total_pages || loading}
          onClick={() =>
            onPageChange(pagination ? Math.min(pagination.total_pages, pagination.page + 1) : 1)
          }
        >
          Next
        </Button>
      </div>
    </div>
  )
}

export default function MonthlyBillingPage() {
  const quarterOptions = useMemo(() => quarterSelectionOptions(), [])
  const initialQuarter = useMemo(() => currentBillingQuarter(), [])
  const [selectedQuarterKey, setSelectedQuarterKey] = useState(() =>
    quarterSelectionKey(initialQuarter.year, initialQuarter.quarter),
  )
  const selectedQuarter = useMemo(
    () => parseQuarterSelectionKey(selectedQuarterKey) ?? initialQuarter,
    [selectedQuarterKey, initialQuarter],
  )
  const [query, setQuery] = useState('')
  const [routeFilter, setRouteFilter] = useState('')
  const [doNotBillAnyMonth, setDoNotBillAnyMonth] = useState(false)
  const [notBilledQuarter, setNotBilledQuarter] = useState(false)
  const [nonEmptyBillingNotes, setNonEmptyBillingNotes] = useState(false)
  const [page, setPage] = useState(1)
  const [payload, setPayload] = useState<BillingBoardPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyLocationId, setBusyLocationId] = useState<number | null>(null)
  const [editingBillingCommentLocationId, setEditingBillingCommentLocationId] = useState<number | null>(
    null,
  )
  const [trackedLocationId, setTrackedLocationId] = useState<number | null>(null)
  const [paperworkModalContext, setPaperworkModalContext] =
    useState<BillingBoardPaperworkModalContext | null>(null)
  const loadSeqRef = useRef(0)

  const load = useCallback(async () => {
    const seq = loadSeqRef.current + 1
    loadSeqRef.current = seq
    setLoading(true)
    setError(null)
    try {
      const data = await fetchBillingBoard({
        year: selectedQuarter.year,
        quarter: selectedQuarter.quarter,
        q: query,
        route: routeFilter,
        page,
        pageSize: PAGE_SIZE,
        doNotBillAnyMonth,
        notBilledQuarter,
        nonEmptyBillingNotes,
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
    selectedQuarter.year,
    selectedQuarter.quarter,
    query,
    routeFilter,
    page,
    doNotBillAnyMonth,
    notBilledQuarter,
    nonEmptyBillingNotes,
  ])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setTrackedLocationId(null)
    setEditingBillingCommentLocationId(null)
  }, [page, selectedQuarterKey, query, routeFilter, doNotBillAnyMonth, notBilledQuarter, nonEmptyBillingNotes])

  const routeOptions = payload?.meta.routes ?? []
  const monthDates = payload?.month_dates ?? []
  const pagination = payload?.pagination

  const paginationSummary = useMemo(() => {
    if (!pagination) return null
    const start = (pagination.page - 1) * pagination.page_size + 1
    const end = Math.min(pagination.page * pagination.page_size, pagination.total)
    if (pagination.total === 0) return 'No locations'
    return `Showing ${start}–${end} of ${pagination.total}`
  }, [pagination])

  const updateLocationBillingComments = useCallback((locationId: number, billingComments: string | null) => {
    setPayload((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        locations: prev.locations.map((loc) =>
          loc.location_id === locationId ? { ...loc, billing_comments: billingComments } : loc,
        ),
      }
    })
  }, [])

  const toggleBilled = async (row: BillingBoardLocationRow) => {
    setBusyLocationId(row.location_id)
    try {
      const result = await patchQuarterBilled(
        row.location_id,
        selectedQuarter.year,
        selectedQuarter.quarter,
        !row.quarter_billed,
      )
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
          <h1 className="processing-page-title mb-3">Monthly Billing</h1>
          <div className="d-flex flex-wrap align-items-end gap-3">
            <Form.Group>
              <Form.Label className="small text-muted mb-1">Quarter</Form.Label>
              <Form.Select
                value={selectedQuarterKey}
                onChange={(e) => {
                  setSelectedQuarterKey(e.target.value)
                  setPage(1)
                }}
                style={{ minWidth: '18rem' }}
              >
                {quarterOptions.map((key) => {
                  const parsed = parseQuarterSelectionKey(key)
                  if (!parsed) return null
                  return (
                    <option key={key} value={key}>
                      {quarterOptionLabel(parsed.year, parsed.quarter)}
                    </option>
                  )
                })}
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
              id="billing-filter-do-not-bill"
              label="Waive in any month"
              checked={doNotBillAnyMonth}
              onChange={(e) => {
                setDoNotBillAnyMonth(e.target.checked)
                setPage(1)
              }}
            />
            <Form.Check
              type="checkbox"
              id="billing-filter-non-empty-notes"
              label="Non-empty notes"
              checked={nonEmptyBillingNotes}
              onChange={(e) => {
                setNonEmptyBillingNotes(e.target.checked)
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
              <BillingBoardPaginationBar
                loading={loading}
                paginationSummary={paginationSummary}
                pagination={pagination}
                onPageChange={setPage}
                position="top"
              />
              {loading ? (
                <BillingBoardTableSkeleton monthDates={monthDates} />
              ) : (
                <>
                  <Table responsive hover className="mb-0 align-middle monthly-billing-table">
                  <thead>
                    <tr>
                        <th style={{ minWidth: '14rem' }}>Address</th>
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
                          Invoiced
                        </th>
                        <th style={{ minWidth: '5rem' }}>Route</th>
                        <th style={{ minWidth: '10rem' }}>Billing comment</th>
                        <th style={{ minWidth: '10rem' }}>Property management company</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(payload?.locations ?? []).length === 0 ? (
                        <tr>
                          <td colSpan={5 + monthDates.length} className="text-muted small p-3">
                            No active locations match your filters.
                          </td>
                        </tr>
                      ) : (
                        (payload?.locations ?? []).map((row) => {
                          const billedTooltip =
                            row.quarter_billed && row.billed_at
                              ? `Invoiced ${new Date(row.billed_at).toLocaleString()}${row.billed_by ? ` by ${row.billed_by}` : ''}`
                              : 'Invoice for this quarter'
                          const btn = (
                            <Button
                              size="sm"
                              variant={row.quarter_billed ? 'link' : 'primary'}
                              className={row.quarter_billed ? 'p-0 text-success' : undefined}
                              disabled={busyLocationId === row.location_id}
                              aria-label={row.quarter_billed ? 'Invoiced' : 'Invoice'}
                              onClick={(e) => {
                                e.stopPropagation()
                                void toggleBilled(row)
                              }}
                            >
                              {busyLocationId === row.location_id ? (
                                <Spinner
                                  animation="border"
                                  size="sm"
                                  variant={row.quarter_billed ? undefined : 'light'}
                                  aria-label="Saving"
                                />
                              ) : row.quarter_billed ? (
                                <i className="bi bi-check-circle-fill fs-5" aria-hidden />
                              ) : (
                                'Invoice'
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
                              </td>
                              {monthDates.map((monthIso) => (
                                <td key={monthIso} className="text-center">
                                  <BillingMonthCell
                                    row={row}
                                    cell={row.months[monthIso]}
                                    monthIso={monthIso}
                                    onOpenPaperwork={setPaperworkModalContext}
                                  />
                                </td>
                              ))}
                              <td className="text-center">
                                <OverlayTrigger overlay={<Tooltip>{billedTooltip}</Tooltip>}>
                                  <span className="d-inline-block">{btn}</span>
                                </OverlayTrigger>
                              </td>
                              <td className="small">
                                <BillingRouteCell row={row} />
                              </td>
                              <td className="small text-muted text-break">
                                <BillingBoardCommentCell
                                  locationId={row.location_id}
                                  billingComments={row.billing_comments}
                                  isEditing={editingBillingCommentLocationId === row.location_id}
                                  onBeginEdit={() => setEditingBillingCommentLocationId(row.location_id)}
                                  onEndEdit={() => setEditingBillingCommentLocationId(null)}
                                  onSaved={(billingComments) =>
                                    updateLocationBillingComments(row.location_id, billingComments)
                                  }
                                />
                              </td>
                              <td className="small text-muted text-break">
                                {row.property_management_company?.trim() ? (
                                  row.property_management_company.trim()
                                ) : (
                                  <span className="text-muted">—</span>
                                )}
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </Table>
                  <BillingBoardPaginationBar
                    loading={loading}
                    paginationSummary={paginationSummary}
                    pagination={pagination}
                    onPageChange={setPage}
                    position="bottom"
                  />
                </>
              )}
            </>
          )}
        </Card.Body>
      </Card>

      <BillingBoardPaperworkModal
        show={paperworkModalContext != null}
        context={paperworkModalContext}
        onHide={() => setPaperworkModalContext(null)}
      />
    </div>
  )
}
