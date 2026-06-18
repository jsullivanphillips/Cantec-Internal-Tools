import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Card, Form, OverlayTrigger, Spinner, Table, Tooltip } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import {
  billingBoardPillTone,
  billingBoardShowUnsetDash,
  billingBoardWaiveTooltipText,
  billingMonthPillClickable,
  billingMonthPaperworkRouteId,
  billingStatusLabel,
  currentBillingQuarter,
  fetchBillingBoard,
  formatMonthHeader,
  parseQuarterSelectionKey,
  patchQuarterBilled,
  patchLocationPricingUpdated,
  quarterOptionLabel,
  quarterSelectionLabel,
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
import HeroFilterPill from '../components/HeroFilterPill'
import { isAbortError } from '../lib/apiClient'
import { formatCurrencyCad } from '../lib/formatCurrencyCad'
import { PROCESSING_PAGE_TITLE_COMPACT_CLASS } from '../styles/pageTypography'

const PAGE_SIZE = 50
const BILLING_MONTH_COL_MIN_WIDTH = '3.85rem'
const BILLING_ACTION_COL_MIN_WIDTH = '5.25rem'
const BILLING_UPDATED_COL_MIN_WIDTH = '2.15rem'

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
  const tone = billingBoardPillTone(billing)
  const label = billingStatusLabel(billing)
  const clickable = billingMonthPillClickable(row, cell, monthIso)
  const waiveTooltip = billingBoardWaiveTooltipText(cell)
  const routeId = billingMonthPaperworkRouteId(row, cell)

  const cardClass = `monthly-billing-pill-card monthly-billing-pill-card--${tone}${
    clickable ? ' monthly-billing-pill--clickable' : ''
  }`

  const cardInner = clickable ? (
    <button
      type="button"
      className={cardClass}
      aria-label={
        waiveTooltip
          ? `Waive: ${waiveTooltip}. View paperwork for ${formatMonthHeader(monthIso)}.`
          : `View paperwork for ${formatMonthHeader(monthIso)} (${label})`
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
          waiveReason: waiveTooltip,
        })
      }}
    >
      {label}
    </button>
  ) : (
    <span className={cardClass}>{label}</span>
  )

  const shell = (
    <div className="monthly-billing-month-cell">{cardInner}</div>
  )

  if (clickable && waiveTooltip) {
    return (
      <OverlayTrigger
        trigger={['hover', 'focus']}
        overlay={<Tooltip className="monthly-billing-waive-tooltip">{waiveTooltip}</Tooltip>}
      >
        <span className="monthly-billing-month-cell-wrap d-block">{shell}</span>
      </OverlayTrigger>
    )
  }

  return shell
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
      <Table responsive striped className="mb-0 align-middle monthly-billing-table">
        <thead>
          <tr>
            <th style={{ minWidth: '11rem' }}>Address</th>
            {monthDates.length > 0
              ? monthDates.map((monthIso) => (
                  <th
                    key={monthIso}
                    className="text-center monthly-billing-month-th"
                    style={{ minWidth: BILLING_MONTH_COL_MIN_WIDTH }}
                  >
                    {formatMonthHeader(monthIso)}
                  </th>
                ))
              : Array.from({ length: monthCols }, (_, i) => (
                  <th
                    key={i}
                    className="text-center monthly-billing-month-th"
                    style={{ minWidth: BILLING_MONTH_COL_MIN_WIDTH }}
                  >
                    <span
                      className="home-skeleton-bar d-inline-block"
                      style={{ width: '2.5rem', height: '0.65rem' }}
                    />
                  </th>
                ))}
            <th
              className="text-center monthly-billing-price-col"
              style={{ minWidth: BILLING_ACTION_COL_MIN_WIDTH }}
            >
              Price
            </th>
            <th
              className="text-center monthly-billing-updated-col"
              style={{ minWidth: BILLING_UPDATED_COL_MIN_WIDTH }}
              title="Updated"
            >
              Upd.
            </th>
            <th
              className="text-center monthly-billing-invoiced-col"
              style={{ minWidth: BILLING_ACTION_COL_MIN_WIDTH }}
            >
              Invoiced
            </th>
            <th style={{ minWidth: '3.5rem' }}>Route</th>
            <th style={{ minWidth: '8rem' }}>Billing comment</th>
            <th style={{ minWidth: '8rem' }}>Property management company</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: BILLING_SKELETON_ROW_COUNT }, (_, rowIdx) => (
            <tr key={rowIdx}>
              <td>
                <span
                  className="home-skeleton-bar d-block"
                  style={{ width: '88%', height: '0.75rem' }}
                />
              </td>
              {Array.from({ length: monthCols }, (_, colIdx) => (
                <td key={colIdx} className="text-center monthly-billing-month-td">
                  <span
                    className="home-skeleton-bar d-inline-block"
                    style={{ width: '2.75rem', height: '1.1rem', borderRadius: '0.35rem' }}
                  />
                </td>
              ))}
              <td className="text-center monthly-billing-price-col">
                <span
                  className="home-skeleton-bar d-inline-block"
                  style={{ width: '3.5rem', height: '0.65rem' }}
                />
              </td>
              <td className="text-center monthly-billing-updated-col">
                <span
                  className="home-skeleton-bar d-inline-block"
                  style={{ width: '0.9rem', height: '0.9rem', borderRadius: '0.15rem' }}
                />
              </td>
              <td className="text-center monthly-billing-invoiced-col">
                <span
                  className="home-skeleton-bar d-inline-block"
                  style={{ width: '4.5rem', height: '1.35rem', borderRadius: '0.35rem' }}
                />
              </td>
              <td>
                <span className="home-skeleton-bar d-block" style={{ width: '2rem', height: '0.65rem' }} />
              </td>
              <td>
                <span className="home-skeleton-bar d-block" style={{ width: '70%', height: '0.65rem' }} />
              </td>
              <td>
                <span className="home-skeleton-bar d-block" style={{ width: '75%', height: '0.65rem' }} />
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
      className={`d-flex flex-wrap justify-content-between align-items-center gap-2 py-2 ${
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
  const [unsetAnyMonth, setUnsetAnyMonth] = useState(false)
  const [notBilledQuarter, setNotBilledQuarter] = useState(false)
  const [nonEmptyBillingNotes, setNonEmptyBillingNotes] = useState(false)
  const [pricingUpdatedFilter, setPricingUpdatedFilter] = useState(false)
  const [page, setPage] = useState(1)
  const [payload, setPayload] = useState<BillingBoardPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyLocationId, setBusyLocationId] = useState<number | null>(null)
  const [busyPricingUpdatedLocationId, setBusyPricingUpdatedLocationId] = useState<number | null>(
    null,
  )
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
        unsetAnyMonth,
        notBilledQuarter,
        nonEmptyBillingNotes,
        pricingUpdated: pricingUpdatedFilter,
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
    unsetAnyMonth,
    notBilledQuarter,
    nonEmptyBillingNotes,
    pricingUpdatedFilter,
  ])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setTrackedLocationId(null)
    setEditingBillingCommentLocationId(null)
  }, [page, selectedQuarterKey, query, routeFilter, doNotBillAnyMonth, unsetAnyMonth, notBilledQuarter, nonEmptyBillingNotes, pricingUpdatedFilter])

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

  const togglePricingUpdated = async (row: BillingBoardLocationRow, checked: boolean) => {
    setBusyPricingUpdatedLocationId(row.location_id)
    try {
      const result = await patchLocationPricingUpdated(row.location_id, checked)
      const pricingUpdated = result.location.pricing_updated ?? checked
      setPayload((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          locations: prev.locations.map((loc) =>
            loc.location_id === row.location_id ? { ...loc, pricing_updated: pricingUpdated } : loc,
          ),
        }
      })
      if (pricingUpdatedFilter && !pricingUpdated) {
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
      window.alert(err instanceof Error ? err.message : 'Unable to update pricing updated status.')
    } finally {
      setBusyPricingUpdatedLocationId(null)
    }
  }

  return (
    <div className="monthly-page monthly-billing-page d-flex flex-column gap-3">
      <Card className="app-surface-card monthly-filters-card monthly-hero-card">
        <Card.Body className="monthly-hero-card__body">
          <div className="monthly-hero-card__row">
            <h1 className={`${PROCESSING_PAGE_TITLE_COMPACT_CLASS} m-0`}>Monthly Billing</h1>
          </div>
        </Card.Body>
      </Card>

      <Card className="app-surface-card monthly-results-card">
        <Card.Body className="monthly-results-body">
          <div className="monthly-table-search monthly-billing-table-toolbar">
            <div className="monthly-locations-filter-field monthly-billing-table-toolbar__search">
              <span className="monthly-locations-filter-field__label">Search</span>
              <div className="monthly-locations-filter-field__control monthly-locations-filter-field__control--search">
                <i className="bi bi-search monthly-locations-filter-field__icon" aria-hidden />
                <Form.Control
                  type="search"
                  size="sm"
                  className="monthly-locations-filter-field__input"
                  value={query}
                  placeholder="Address or PMC…"
                  aria-label="Search billing locations"
                  onChange={(e) => {
                    setQuery(e.target.value)
                    setPage(1)
                  }}
                />
              </div>
            </div>
            <div className="monthly-locations-filter-field monthly-billing-table-toolbar__quarter">
              <span className="monthly-locations-filter-field__label">Quarter</span>
              <div className="monthly-locations-filter-field__control monthly-locations-filter-field__control--select">
                <label className="monthly-billing-table-toolbar__select-wrap monthly-billing-table-toolbar__select-wrap--quarter">
                  <i className="bi bi-calendar3" aria-hidden />
                  <span className="monthly-billing-table-toolbar__quarter-display" aria-hidden="true">
                    {quarterSelectionLabel(selectedQuarter.year, selectedQuarter.quarter)}
                  </span>
                  <Form.Select
                    size="sm"
                    className="monthly-billing-table-toolbar__select monthly-billing-table-toolbar__select--quarter-value"
                    value={selectedQuarterKey}
                    aria-label="Quarter"
                    onChange={(e) => {
                      setSelectedQuarterKey(e.target.value)
                      setPage(1)
                    }}
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
                </label>
              </div>
            </div>
            <div className="monthly-locations-filter-field monthly-billing-table-toolbar__route">
              <span className="monthly-locations-filter-field__label">Route</span>
              <div className="monthly-locations-filter-field__control monthly-locations-filter-field__control--select">
                <label className="monthly-billing-table-toolbar__select-wrap">
                  <i className="bi bi-signpost-split" aria-hidden />
                  <Form.Select
                    size="sm"
                    className="monthly-billing-table-toolbar__select"
                    value={routeFilter}
                    aria-label="Route"
                    onChange={(e) => {
                      setRouteFilter(e.target.value)
                      setPage(1)
                    }}
                  >
                    <option value="">All routes</option>
                    {routeOptions.map((route) => (
                      <option key={route} value={route}>
                        {route}
                      </option>
                    ))}
                  </Form.Select>
                </label>
              </div>
            </div>
            <div
              className="run-review-filter monthly-billing-table-toolbar__filters"
              role="group"
              aria-label="Billing status filters"
            >
              <HeroFilterPill
                id="billing-filter-not-billed"
                icon="bi-receipt"
                label="Not billed"
                checked={notBilledQuarter}
                onChange={(checked) => {
                  setNotBilledQuarter(checked)
                  setPage(1)
                }}
              />
              <HeroFilterPill
                id="billing-filter-do-not-bill"
                icon="bi-ban"
                label="Waived"
                checked={doNotBillAnyMonth}
                onChange={(checked) => {
                  setDoNotBillAnyMonth(checked)
                  setPage(1)
                }}
              />
              <HeroFilterPill
                id="billing-filter-unset"
                icon="bi-question-circle"
                label="Unset"
                checked={unsetAnyMonth}
                onChange={(checked) => {
                  setUnsetAnyMonth(checked)
                  setPage(1)
                }}
              />
              <HeroFilterPill
                id="billing-filter-pricing-updated"
                icon="bi-check2-square"
                label="Price updated"
                checked={pricingUpdatedFilter}
                onChange={(checked) => {
                  setPricingUpdatedFilter(checked)
                  setPage(1)
                }}
              />
              <HeroFilterPill
                id="billing-filter-non-empty-notes"
                icon="bi-journal-text"
                label="Has notes"
                checked={nonEmptyBillingNotes}
                onChange={(checked) => {
                  setNonEmptyBillingNotes(checked)
                  setPage(1)
                }}
              />
            </div>
          </div>
          {error ? (
            <p className="text-danger small mb-0" role="alert">
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
                  <Table responsive striped hover className="mb-0 align-middle monthly-billing-table">
                  <thead>
                    <tr>
                        <th style={{ minWidth: '11rem' }}>Address</th>
                        {monthDates.map((monthIso) => (
                          <th
                            key={monthIso}
                            colSpan={1}
                            className="text-center monthly-billing-month-th"
                            style={{ minWidth: BILLING_MONTH_COL_MIN_WIDTH }}
                          >
                            {formatMonthHeader(monthIso)}
                          </th>
                        ))}
                        <th
                          className="text-center monthly-billing-price-col"
                          style={{ minWidth: BILLING_ACTION_COL_MIN_WIDTH }}
                        >
                          Price
                        </th>
                        <th
                          className="text-center monthly-billing-updated-col"
                          style={{ minWidth: BILLING_UPDATED_COL_MIN_WIDTH }}
                          title="Updated"
                        >
                          Upd.
                        </th>
                        <th
                          className="text-center monthly-billing-invoiced-col"
                          style={{ minWidth: BILLING_ACTION_COL_MIN_WIDTH }}
                        >
                          Invoiced
                        </th>
                        <th style={{ minWidth: '3.5rem' }}>Route</th>
                        <th style={{ minWidth: '8rem' }}>Billing comment</th>
                        <th style={{ minWidth: '8rem' }}>Property management company</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(payload?.locations ?? []).length === 0 ? (
                        <tr>
                          <td colSpan={7 + monthDates.length} className="text-muted small p-3">
                            No active locations match your filters.
                          </td>
                        </tr>
                      ) : (
                        (payload?.locations ?? []).map((row) => {
                          const billedTooltip =
                            row.quarter_billed && row.billed_at
                              ? `Invoiced ${new Date(row.billed_at).toLocaleString()}${row.billed_by ? ` by ${row.billed_by}` : ''}`
                              : 'Mark invoiced for this quarter'
                          const btn = (
                            <Button
                              size="sm"
                              variant={row.quarter_billed ? 'link' : 'primary'}
                              className={
                                row.quarter_billed ? 'p-0 text-success' : 'monthly-billing-invoice-btn'
                              }
                              disabled={busyLocationId === row.location_id}
                              aria-label={row.quarter_billed ? 'Invoiced' : 'Mark invoiced'}
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
                                <i className="bi bi-check-circle-fill fs-6" aria-hidden />
                              ) : (
                                'Invoiced'
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
                                  className="monthly-billing-address-link"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {billingBoardLocationTitle(row)}
                                </Link>
                              </td>
                              {monthDates.map((monthIso) => (
                                <td key={monthIso} className="text-center monthly-billing-month-td">
                                  <BillingMonthCell
                                    row={row}
                                    cell={row.months[monthIso]}
                                    monthIso={monthIso}
                                    onOpenPaperwork={setPaperworkModalContext}
                                  />
                                </td>
                              ))}
                              <td className="text-center monthly-billing-price-col text-muted">
                                {formatCurrencyCad(row.rollup_price_per_month)}
                              </td>
                              <td className="text-center monthly-billing-updated-col">
                                <Form.Check
                                  type="checkbox"
                                  id={`billing-pricing-updated-${row.location_id}`}
                                  className="monthly-billing-pricing-updated-check d-inline-flex justify-content-center mb-0"
                                  checked={row.pricing_updated}
                                  disabled={busyPricingUpdatedLocationId === row.location_id}
                                  aria-label={
                                    row.pricing_updated
                                      ? 'Pricing updated'
                                      : 'Mark pricing updated'
                                  }
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) => {
                                    void togglePricingUpdated(row, e.target.checked)
                                  }}
                                />
                              </td>
                              <td className="text-center monthly-billing-invoiced-col">
                                <OverlayTrigger overlay={<Tooltip>{billedTooltip}</Tooltip>}>
                                  <span className="d-inline-block">{btn}</span>
                                </OverlayTrigger>
                              </td>
                              <td>
                                <BillingRouteCell row={row} />
                              </td>
                              <td className="text-muted text-break">
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
                              <td className="text-muted text-break">
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
