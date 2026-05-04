import type { CSSProperties } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Col, Form, Modal, OverlayTrigger, Row, Table, Tooltip } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import RouteLibraryLink from '../features/monthlyRoutes/RouteLibraryLink'
import {
  STATUS_OPTIONS,
  compareYearMonth,
  libraryKeycodeDisplay,
  libraryRouteNumberLine,
  libraryRouteOccurrenceLine,
  parseYearMonth,
  toMonthKey,
  type CreateLocationForm,
  type GeocodeCandidate,
  type LibraryLocation,
  type LibraryPayload,
  type MonthCell,
} from '../features/monthlyRoutes/monthlyRoutesShared'
import { apiJson, isAbortError } from '../lib/apiClient'

const LIBRARY_PAGE_SIZE = 50
const MONTH_NAME_OPTIONS = Array.from({ length: 12 }).map((_, idx) =>
  new Intl.DateTimeFormat('en-US', {
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2000, idx, 1)))
)
/** Month columns get width only via `<colgroup>` (equal share of leftover space). */
const MONTH_TESTING_CELL_STYLE: CSSProperties = {
  verticalAlign: 'middle',
  textAlign: 'center',
  whiteSpace: 'normal',
  wordBreak: 'break-word',
}

const STATUS_COLUMN_STYLE: CSSProperties = {
  width: '5.0rem',
  minWidth: '5.0rem',
  maxWidth: '5.0rem',
}

const PROPERTY_COLUMN_STYLE: CSSProperties = {
  width: '10rem',
  minWidth: '10rem',
  maxWidth: '10rem',
}

const ADDRESS_COLUMN_STYLE: CSSProperties = {
  width: '11rem',
  minWidth: '11rem',
  maxWidth: '11rem',
}

const ROUTE_COLUMN_STYLE: CSSProperties = {
  width: '6.24rem',
  minWidth: '6.24rem',
  maxWidth: '6.24rem',
}

const KEYS_COLUMN_STYLE: CSSProperties = {
  width: '7.36rem',
  minWidth: '7.36rem',
  maxWidth: '7.36rem',
  textAlign: 'center',
}

const ANNUAL_COLUMN_STYLE: CSSProperties = {
  width: '7.35rem',
  minWidth: '7.35rem',
  maxWidth: '7.35rem',
}

const LIBRARY_TABLE_HEADER_STICKY_STYLE: CSSProperties = {
  position: 'sticky',
  top: '0px',
  zIndex: 5,
  backgroundColor: '#fff',
  borderTop: '1px solid #dee2e6',
  boxShadow: 'inset 0 1px 0 #dee2e6, inset 0 -1px 0 rgba(0, 0, 0, 0.12)',
}

const LIBRARY_TABLE_WRAP_STYLE: CSSProperties = {
  maxHeight: '65vh',
  overflowY: 'auto',
  overflowX: 'auto',
}

const LIBRARY_TABLE_STYLE: CSSProperties = {
  width: '100%',
  tableLayout: 'fixed',
}

const CREATE_LOCATION_GEOCODE_DEBOUNCE_MS = 250

const CREATE_LOCATION_CANDIDATES_STYLE: CSSProperties = {
  maxHeight: '11rem',
  overflowY: 'auto',
}

type YearMonth = { year: number; month: number }

function addMonths(start: YearMonth, offset: number): YearMonth {
  const total = start.year * 12 + (start.month - 1) + offset
  const year = Math.floor(total / 12)
  const month = (total % 12) + 1
  return { year, month }
}

function formatMonthLabel(monthKey: string): string {
  const ym = parseYearMonth(monthKey)
  if (!ym) return monthKey
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(ym.year, ym.month - 1, 1)))
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

function getLibraryListRange(
  fromMonth: string,
  toMonth: string,
  currentYearStart: string,
  today: Date
): { start: YearMonth; finish: YearMonth } {
  const from = parseYearMonth(fromMonth)
  const to = parseYearMonth(toMonth)
  const fallback = parseYearMonth(currentYearStart) ?? { year: today.getFullYear(), month: 1 }
  let start = fallback
  let finish = fallback
  if (from && to) {
    start = compareYearMonth(from, to) <= 0 ? from : to
    finish = compareYearMonth(from, to) <= 0 ? to : from
  } else if (from) {
    start = from
    finish = from
  } else if (to) {
    start = to
    finish = to
  }
  return { start, finish }
}

function buildLibraryListQueryString(args: {
  fromMonth: string
  toMonth: string
  currentYearStart: string
  today: Date
  tableSearch: string
  showOnlySkipped: boolean
  showAnnualTestingConflicts: boolean
  page: number
  pageSize: number
  unpaginated: boolean
}): string {
  const { start, finish } = getLibraryListRange(
    args.fromMonth,
    args.toMonth,
    args.currentYearStart,
    args.today
  )
  const params = new URLSearchParams()
  params.set('from_month', toMonthKey(start.year, start.month))
  params.set('to_month', toMonthKey(finish.year, finish.month))
  if (args.tableSearch.trim()) params.set('q', args.tableSearch.trim())
  if (args.showOnlySkipped) params.set('skipped_any', 'true')
  if (args.showAnnualTestingConflicts) params.set('annual_tested_conflict', 'true')
  if (args.unpaginated) {
    params.set('unpaginated', 'true')
  } else {
    params.set('page', String(args.page))
    params.set('page_size', String(args.pageSize))
  }
  return params.toString()
}

function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function statusExportLabel(status: string | null | undefined): string {
  const normalized = (status || '').trim().toLowerCase()
  if (normalized === 'active') return 'active'
  if (normalized === 'cancelled') return 'cancelled'
  if (normalized === 'on_hold' || normalized === 'on hold') return 'on hold'
  if (normalized === 'waiting_keys' || normalized === 'waiting keys') return 'waiting keys'
  return (status || '').trim() || '—'
}

function monthCellExportText(
  cell: MonthCell | undefined,
  monthKey: string,
  annualMonth: string | null | undefined
): string {
  const isAnnual = isAnnualMonth(monthKey, annualMonth)
  if (cell?.result_status === 'tested') {
    if (isAnnual) return 'Tested (annual month)'
    return 'Tested'
  }
  if (isAnnual) return 'Annual month'
  if (!cell) return ''
  if (cell.result_status === 'skipped') {
    const reason = cell.skip_reason?.trim()
    return reason ? `Skipped (${reason})` : 'Skipped'
  }
  return ''
}

export default function MonthlyRoutesPage() {
  const today = new Date()
  const currentYearStart = `${today.getFullYear()}-01-01`
  const currentYearEnd = `${today.getFullYear()}-12-01`

  const [fromMonth, setFromMonth] = useState(currentYearStart)
  const [toMonth, setToMonth] = useState(currentYearEnd)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [payload, setPayload] = useState<LibraryPayload | null>(null)
  const [tableSearch, setTableSearch] = useState('')
  const [showOnlySkipped, setShowOnlySkipped] = useState(false)
  const [showAnnualTestingConflicts, setShowAnnualTestingConflicts] = useState(false)
  const [hideCancelledMbtLocations, setHideCancelledMbtLocations] = useState(true)
  const [newLocationForm, setNewLocationForm] = useState<CreateLocationForm>({
    address: '',
    property_management_company: '',
    status_raw: 'active',
    keys: '',
    test_day: '',
  })
  const [showCreateLocationModal, setShowCreateLocationModal] = useState(false)
  const [createLocationSaving, setCreateLocationSaving] = useState(false)
  const [createLocationError, setCreateLocationError] = useState<string | null>(null)
  const [createLocationAddressQuery, setCreateLocationAddressQuery] = useState('')
  const [createLocationCandidates, setCreateLocationCandidates] = useState<GeocodeCandidate[]>([])
  const [createLocationLookupLoading, setCreateLocationLookupLoading] = useState(false)
  const [createLocationLookupError, setCreateLocationLookupError] = useState<string | null>(null)
  const [createLocationSelectedCandidate, setCreateLocationSelectedCandidate] =
    useState<GeocodeCandidate | null>(null)
  const [page, setPage] = useState(1)
  const [annualEditLocationId, setAnnualEditLocationId] = useState<number | null>(null)
  const [annualSavingLocationId, setAnnualSavingLocationId] = useState<number | null>(null)
  const [csvExporting, setCsvExporting] = useState(false)

  const mergeUpdatedLocation = useCallback((updated: LibraryLocation) => {
    setPayload((prev) =>
      prev
        ? {
            ...prev,
            locations: prev.locations.some((loc) => loc.id === updated.id)
              ? prev.locations.map((loc) => (loc.id === updated.id ? { ...loc, ...updated } : loc))
              : [updated, ...prev.locations],
          }
        : prev
    )
  }, [])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setLoading(true)
    setError(null)

    const qs = buildLibraryListQueryString({
      fromMonth,
      toMonth,
      currentYearStart,
      today,
      tableSearch,
      showOnlySkipped,
      showAnnualTestingConflicts,
      page,
      pageSize: LIBRARY_PAGE_SIZE,
      unpaginated: false,
    })

    apiJson<LibraryPayload>(`/api/monthly_routes/library?${qs}`, {
      signal: controller.signal,
    })
      .then((data) => {
        if (active) setPayload(data)
      })
      .catch((err) => {
        if (!isAbortError(err) && active) {
          setError('Unable to load monthly library data.')
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [fromMonth, page, showAnnualTestingConflicts, showOnlySkipped, tableSearch, toMonth])

  const monthColumns = useMemo(() => {
    const { start, finish } = getLibraryListRange(fromMonth, toMonth, currentYearStart, today)
    const cols: string[] = []
    let cursor = start
    while (compareYearMonth(cursor, finish) <= 0) {
      cols.push(toMonthKey(cursor.year, cursor.month))
      cursor = addMonths(cursor, 1)
    }
    return cols
  }, [fromMonth, toMonth, currentYearStart, today])
  const locations = payload?.locations ?? []

  const filteredLocations = useMemo(() => {
    if (!hideCancelledMbtLocations) return locations
    return locations.filter((loc) => (loc.status_normalized || '').trim().toLowerCase() !== 'cancelled')
  }, [hideCancelledMbtLocations, locations])
  const pagination = payload?.meta.pagination
  const routeOptions = payload?.meta.routes ?? []

  const exportResultsAsCsv = useCallback(async () => {
    setCsvExporting(true)
    try {
      const qs = buildLibraryListQueryString({
        fromMonth,
        toMonth,
        currentYearStart,
        today,
        tableSearch,
        showOnlySkipped,
        showAnnualTestingConflicts,
        page: 1,
        pageSize: LIBRARY_PAGE_SIZE,
        unpaginated: true,
      })
      const data = await apiJson<LibraryPayload>(`/api/monthly_routes/library?${qs}`)
      let rows = data.locations ?? []
      if (hideCancelledMbtLocations) {
        rows = rows.filter((loc) => (loc.status_normalized || '').trim().toLowerCase() !== 'cancelled')
      }
      const monthCols = data.month_columns ?? []
      const headers = [
        'Status',
        'Route',
        'Address',
        'Property Management',
        'Key',
        'Annual',
        ...monthCols.map((m) => formatMonthLabel(m)),
      ]
      const lines = [headers.map(escapeCsvField).join(',')]
      for (const loc of rows) {
        const line2 = libraryRouteOccurrenceLine(loc)
        const routeText = line2 ? `${libraryRouteNumberLine(loc)} / ${line2}` : libraryRouteNumberLine(loc)
        const keyText = libraryKeycodeDisplay(loc) || '—'
        const monthCells = monthCols.map((mk) =>
          monthCellExportText(loc.months?.[mk], mk, loc.annual_month)
        )
        lines.push(
          [
            statusExportLabel(loc.status_normalized),
            routeText,
            loc.address || '',
            loc.property_management_company || '',
            keyText,
            loc.annual_month || '',
            ...monthCells,
          ]
            .map(escapeCsvField)
            .join(',')
        )
      }
      const body = `\uFEFF${lines.join('\r\n')}`
      const blob = new Blob([body], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `monthly-routes-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      window.alert('Unable to export CSV. Please try again.')
    } finally {
      setCsvExporting(false)
    }
  }, [
    currentYearStart,
    fromMonth,
    hideCancelledMbtLocations,
    showAnnualTestingConflicts,
    showOnlySkipped,
    tableSearch,
    toMonth,
    today,
  ])

  const saveAnnualForLocation = useCallback(
    async (locationId: number, annualMonth: string) => {
      setAnnualSavingLocationId(locationId)
      try {
        const response = await apiJson<{ location: LibraryLocation }>(
          `/api/monthly_routes/library/${locationId}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              annual_month: annualMonth || null,
            }),
          }
        )
        setPayload((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            locations: prev.locations.map((loc) =>
              loc.id === response.location.id ? response.location : loc
            ),
          }
        })
      } catch {
        setError('Unable to update annual month.')
      } finally {
        setAnnualSavingLocationId(null)
        setAnnualEditLocationId(null)
      }
    },
    []
  )

  const renderMonthCell = useCallback((
    cell: MonthCell | undefined,
    monthKey: string,
    annualMonth: string | null | undefined,
    locationId: number
  ) => {
    const isAnnual = isAnnualMonth(monthKey, annualMonth)
    if (cell?.result_status === 'tested') {
      if (isAnnual) {
        return (
          <span className="d-inline-flex align-items-center justify-content-center gap-1">
            <i className="bi bi-check-circle-fill text-success" title="Tested" aria-label="Tested" />
            <i
              className="bi bi-exclamation-circle-fill"
              style={{ color: '#6f42c1', fontSize: '0.8rem', lineHeight: 1 }}
              title="Annual month"
              aria-label="Annual month"
            />
          </span>
        )
      }
      return <i className="bi bi-check-circle-fill text-success" title="Tested" aria-label="Tested" />
    }
    if (isAnnual) {
      return (
        <i
          className="bi bi-exclamation-circle-fill"
          style={{ color: '#6f42c1', fontSize: '0.8rem', lineHeight: 1 }}
          title="Annual month"
          aria-label="Annual month"
        />
      )
    }
    if (!cell) return <span className="text-muted">—</span>
    if (cell.result_status === 'skipped') {
      const reason = cell.skip_reason?.trim() || 'Skipped'
      return (
        <OverlayTrigger
          trigger="click"
          rootClose
          placement="top"
          overlay={<Tooltip id={`skip-reason-${locationId}-${monthKey}`}>{reason}</Tooltip>}
        >
          <button
            type="button"
            className="btn p-0 border-0 bg-transparent monthly-skip-reason-hitbox d-flex align-items-center justify-content-center"
            aria-label={`Skipped: ${reason}. Click the cell to view reason.`}
          >
            <i
              className="bi bi-slash-circle-fill text-warning"
              style={{ fontSize: '0.85rem', lineHeight: 1 }}
              aria-hidden="true"
            />
          </button>
        </OverlayTrigger>
      )
    }
    return <span className="text-muted">—</span>
  }, [])

  const renderStatusDot = useCallback((status: string | null | undefined) => {
    const normalized = (status || '').toLowerCase()
    let colorClass = 'bg-secondary'
    let label = status || 'unknown'

    if (normalized === 'active') {
      colorClass = 'bg-success'
      label = 'active'
    } else if (normalized === 'cancelled') {
      colorClass = 'bg-danger'
      label = 'cancelled'
    } else if (normalized === 'on_hold' || normalized === 'on hold') {
      colorClass = 'bg-warning'
      label = 'on hold'
    } else if (normalized === 'waiting_keys' || normalized === 'waiting keys') {
      return (
        <i
          className="bi bi-key-fill text-warning"
          title="waiting keys"
          aria-label="waiting keys"
        />
      )
    }

    return (
      <span
        className={`d-inline-block rounded-circle ${colorClass}`}
        style={{ width: 10, height: 10 }}
        title={label}
        aria-label={label}
      />
    )
  }, [])

  const tableColSpan = 6 + monthColumns.length

  const tableSection = useMemo(() => {
    if (loading || error) return null
    return (
      <div className="monthly-routes-table-wrap" style={LIBRARY_TABLE_WRAP_STYLE}>
        <Table
          striped
          hover
          bordered
          size="sm"
          className="align-middle monthly-routes-library-table"
          style={LIBRARY_TABLE_STYLE}
        >
          <colgroup>
            <col style={{ width: '5rem' }} />
            <col style={{ width: '6.24rem' }} />
            <col style={{ width: '11rem' }} />
            <col style={{ width: '10rem' }} />
            <col style={{ width: '7.36rem' }} />
            <col style={{ width: '7.35rem' }} />
            {monthColumns.map((monthKey) => (
              <col key={monthKey} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th
                className="text-center"
                style={{
                  ...STATUS_COLUMN_STYLE,
                  ...LIBRARY_TABLE_HEADER_STICKY_STYLE,
                }}
              >
                Status
              </th>
              <th style={{ ...ROUTE_COLUMN_STYLE, ...LIBRARY_TABLE_HEADER_STICKY_STYLE }}>Route</th>
              <th style={{ ...ADDRESS_COLUMN_STYLE, ...LIBRARY_TABLE_HEADER_STICKY_STYLE }}>Address</th>
              <th style={{ ...PROPERTY_COLUMN_STYLE, ...LIBRARY_TABLE_HEADER_STICKY_STYLE }}>Property Management</th>
              <th style={{ ...KEYS_COLUMN_STYLE, ...LIBRARY_TABLE_HEADER_STICKY_STYLE }}>Key</th>
              <th
                className="text-center"
                style={{ ...ANNUAL_COLUMN_STYLE, ...LIBRARY_TABLE_HEADER_STICKY_STYLE }}
              >
                Annual
              </th>
              {monthColumns.map((month) => (
                <th
                  key={month}
                  style={{
                    ...MONTH_TESTING_CELL_STYLE,
                    ...LIBRARY_TABLE_HEADER_STICKY_STYLE,
                    verticalAlign: 'bottom',
                  }}
                >
                  {formatMonthLabel(month)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredLocations.length === 0 ? (
              <tr>
                <td colSpan={tableColSpan} className="text-muted">
                  No locations match the current filters.
                </td>
              </tr>
            ) : (
              filteredLocations.map((loc) => (
                <tr
                  key={loc.id}
                >
                  <td className="text-center library-table-cell-clamp" style={STATUS_COLUMN_STYLE}>
                    <div className="library-table-cell-inner">{renderStatusDot(loc.status_normalized)}</div>
                  </td>
                  <td className="library-table-cell-clamp" style={ROUTE_COLUMN_STYLE}>
                    <div className="library-table-cell-inner">
                      <RouteLibraryLink loc={loc} />
                    </div>
                  </td>
                  <td className="library-table-cell-clamp text-break" style={ADDRESS_COLUMN_STYLE}>
                    <div className="library-table-cell-inner">
                      <Link
                        to={`/monthlies/locations/${loc.id}`}
                        className="fw-semibold text-decoration-none text-primary"
                      >
                        {loc.address}
                      </Link>
                    </div>
                  </td>
                  <td className="library-table-cell-clamp" style={PROPERTY_COLUMN_STYLE}>
                    <div className="library-table-cell-inner">{loc.property_management_company || '—'}</div>
                  </td>
                  <td className="library-table-cell-clamp" style={KEYS_COLUMN_STYLE}>
                    <div className="library-table-cell-inner">
                      {loc.key ? (
                        <Link
                          to={`/keys/${loc.key.id}`}
                          className="fw-semibold text-decoration-none"
                        >
                          {loc.key.keycode}
                        </Link>
                      ) : (
                        loc.keys || '—'
                      )}
                    </div>
                  </td>
                  <td
                    className={
                      annualEditLocationId === loc.id ? 'text-center' : 'text-center library-table-cell-clamp'
                    }
                    style={ANNUAL_COLUMN_STYLE}
                  >
                    {annualEditLocationId === loc.id ? (
                      <Form.Select
                        size="sm"
                        value={loc.annual_month || ''}
                        disabled={annualSavingLocationId === loc.id}
                        onChange={(e) => saveAnnualForLocation(loc.id, e.target.value)}
                        onBlur={() => {
                          if (annualSavingLocationId !== loc.id) setAnnualEditLocationId(null)
                        }}
                        autoFocus
                      >
                        <option value="">—</option>
                        {MONTH_NAME_OPTIONS.map((monthName) => (
                          <option key={monthName} value={monthName}>
                            {monthName}
                          </option>
                        ))}
                      </Form.Select>
                    ) : (
                      <div className="library-table-cell-inner">
                        <button
                          type="button"
                          className="btn btn-link p-0 text-decoration-none text-reset"
                          onClick={() => setAnnualEditLocationId(loc.id)}
                        >
                          {loc.annual_month || '—'}
                        </button>
                      </div>
                    )}
                  </td>
                  {monthColumns.map((month) => {
                    const monthCell = loc.months?.[month]
                    const isAnnualDisplay =
                      isAnnualMonth(month, loc.annual_month) && monthCell?.result_status !== 'tested'
                    const isSkippedSurface =
                      !isAnnualDisplay && monthCell?.result_status === 'skipped'
                    return (
                    <td
                      key={`${loc.id}-${month}`}
                      className={
                        isSkippedSurface
                          ? 'library-table-cell-clamp month-testing-cell month-testing-skipped'
                          : 'library-table-cell-clamp month-testing-cell'
                      }
                      style={MONTH_TESTING_CELL_STYLE}
                    >
                      <div className="library-table-cell-inner">
                        {renderMonthCell(monthCell, month, loc.annual_month, loc.id)}
                      </div>
                    </td>
                    )
                  })}
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </div>
    )
  }, [
    error,
    filteredLocations,
    loading,
    monthColumns,
    annualEditLocationId,
    annualSavingLocationId,
    saveAnnualForLocation,
    renderMonthCell,
    renderStatusDot,
    tableColSpan,
  ])

  const canPrevPage = (pagination?.page ?? page) > 1
  const canNextPage = (pagination?.page ?? page) < (pagination?.total_pages ?? 1)

  const paginationSummaryLabel = useMemo(() => {
    if (!pagination) return null
    const { page: p, page_size: pageSize, total, total_pages: totalPages } = pagination
    const pages = totalPages >= 1 ? totalPages : 1
    if (total <= 0) {
      return `Showing 0 of 0 - Page ${p} of ${pages}`
    }
    const start = (p - 1) * pageSize + 1
    const end = Math.min(p * pageSize, total)
    return `Showing ${start}-${end} of ${total} - Page ${p} of ${pages}`
  }, [pagination])

  const openCreateLocationModal = useCallback(() => {
    setCreateLocationError(null)
    setCreateLocationAddressQuery('')
    setCreateLocationCandidates([])
    setCreateLocationLookupLoading(false)
    setCreateLocationLookupError(null)
    setCreateLocationSelectedCandidate(null)
    setNewLocationForm({
      address: '',
      property_management_company: '',
      status_raw: 'active',
      keys: '',
      test_day: '',
    })
    setShowCreateLocationModal(true)
  }, [])

  useEffect(() => {
    if (!showCreateLocationModal) return
    const query = createLocationAddressQuery.trim()
    if (query.length < 3) {
      setCreateLocationCandidates([])
      setCreateLocationLookupLoading(false)
      setCreateLocationLookupError(null)
      return
    }

    let active = true
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setCreateLocationLookupLoading(true)
      setCreateLocationLookupError(null)
      const params = new URLSearchParams({ q: query })
      apiJson<{ candidates: GeocodeCandidate[] }>(
        `/api/monthly_routes/geocode_candidates?${params.toString()}`,
        { signal: controller.signal }
      )
        .then((data) => {
          if (active) setCreateLocationCandidates(data.candidates || [])
        })
        .catch((err) => {
          if (!isAbortError(err) && active) {
            setCreateLocationCandidates([])
            setCreateLocationLookupError('Unable to fetch address suggestions.')
          }
        })
        .finally(() => {
          if (active) setCreateLocationLookupLoading(false)
        })
    }, CREATE_LOCATION_GEOCODE_DEBOUNCE_MS)

    return () => {
      active = false
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [showCreateLocationModal, createLocationAddressQuery])

  const submitCreateLocation = useCallback(async () => {
    const addressLine = (
      createLocationSelectedCandidate?.display_address ||
      createLocationAddressQuery ||
      ''
    ).trim()
    if (!addressLine) {
      setCreateLocationError('Address is required.')
      return
    }
    if (!newLocationForm.property_management_company.trim()) {
      setCreateLocationError('Property management company is required.')
      return
    }

    setCreateLocationSaving(true)
    setCreateLocationError(null)
    try {
      const payload: Record<string, unknown> = {
        address: addressLine,
        property_management_company: newLocationForm.property_management_company.trim(),
        status_raw: newLocationForm.status_raw,
      }
      const keysTrimmed = newLocationForm.keys.trim()
      if (keysTrimmed) payload.keys = keysTrimmed
      const routeTrimmed = (newLocationForm.test_day || '').trim()
      if (routeTrimmed) payload.test_day = routeTrimmed
      if (createLocationSelectedCandidate) {
        payload.display_address = createLocationSelectedCandidate.display_address
        payload.latitude = createLocationSelectedCandidate.latitude
        payload.longitude = createLocationSelectedCandidate.longitude
      }

      const response = await apiJson<{ location: LibraryLocation }>('/api/monthly_routes/library', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      mergeUpdatedLocation(response.location)
      setShowCreateLocationModal(false)
      setCreateLocationAddressQuery('')
      setCreateLocationCandidates([])
      setCreateLocationSelectedCandidate(null)
      setNewLocationForm({
        address: '',
        property_management_company: '',
        status_raw: 'active',
        keys: '',
        test_day: '',
      })
    } catch (err) {
      if (typeof err === 'object' && err && 'error' in err) {
        setCreateLocationError(String((err as { error: unknown }).error))
      } else {
        setCreateLocationError('Unable to create location.')
      }
    } finally {
      setCreateLocationSaving(false)
    }
  }, [
    mergeUpdatedLocation,
    newLocationForm.keys,
    newLocationForm.property_management_company,
    newLocationForm.status_raw,
    newLocationForm.test_day,
    createLocationAddressQuery,
    createLocationSelectedCandidate,
  ])

  return (
    <div className="monthly-routes-library-page d-flex flex-column gap-3">
      <Card className="app-surface-card monthly-routes-filters-card">
        <Card.Body className="p-3 p-md-4">
          <div className="flex-grow-1 min-w-0 d-flex flex-column gap-3">
              <div className="d-flex flex-column flex-sm-row align-items-start justify-content-between gap-2 gap-sm-3">
                <h2 className="processing-page-title mb-0">Filters</h2>
                <Button
                  variant="primary"
                  className="fw-semibold px-4 align-self-stretch align-self-sm-auto"
                  onClick={openCreateLocationModal}
                >
                  Add Location
                </Button>
              </div>

              <div className="monthly-routes-filters__primary">
                <Row className="g-2 g-md-3 align-items-end">
                  <Col xs={12} lg>
                    <Form.Group className="mb-0">
                      <Form.Label className="monthly-routes-filters__label mb-1">Search</Form.Label>
                      <Form.Control
                        type="search"
                        size="sm"
                        value={tableSearch}
                        placeholder="Route, address, property, key, annual…"
                        onChange={(e) => {
                          setTableSearch(e.target.value)
                          setPage(1)
                        }}
                      />
                    </Form.Group>
                  </Col>
                  <Col xs={6} sm="auto">
                    <Form.Group className="mb-0">
                      <Form.Label className="monthly-routes-filters__label mb-1">From month</Form.Label>
                      <Form.Control
                        type="month"
                        size="sm"
                        value={fromMonth.slice(0, 7)}
                        onChange={(e) => {
                          setFromMonth(`${e.target.value}-01`)
                          setPage(1)
                        }}
                        style={{ minWidth: '9.25rem' }}
                      />
                    </Form.Group>
                  </Col>
                  <Col xs={6} sm="auto">
                    <Form.Group className="mb-0">
                      <Form.Label className="monthly-routes-filters__label mb-1">To month</Form.Label>
                      <Form.Control
                        type="month"
                        size="sm"
                        value={toMonth.slice(0, 7)}
                        onChange={(e) => {
                          setToMonth(`${e.target.value}-01`)
                          setPage(1)
                        }}
                        style={{ minWidth: '9.25rem' }}
                      />
                    </Form.Group>
                  </Col>
                </Row>
              </div>

              <div className="monthly-routes-filters__display">
                <div className="monthly-routes-filters__section-title mb-2">Display</div>
                <div className="monthly-routes-filters__checks monthly-routes-filters__checks--row d-flex flex-nowrap align-items-center gap-3 gap-md-4 w-100 min-w-0">
                  <Form.Check
                    id="monthly-routes-skipped-only"
                    type="checkbox"
                    label="Show only skipped locations"
                    checked={showOnlySkipped}
                    className="monthly-routes-filters__check mb-0 flex-shrink-0"
                    onChange={(e) => {
                      setShowOnlySkipped(e.target.checked)
                      setPage(1)
                    }}
                  />
                  <Form.Check
                    id="monthly-routes-annual-tested-conflicts"
                    type="checkbox"
                    label="Show annual/testing conflicts"
                    checked={showAnnualTestingConflicts}
                    className="monthly-routes-filters__check mb-0 flex-shrink-0"
                    onChange={(e) => {
                      setShowAnnualTestingConflicts(e.target.checked)
                      setPage(1)
                    }}
                  />
                  <Form.Check
                    id="monthly-routes-hide-cancelled"
                    type="checkbox"
                    label="Hide cancelled MBT locations"
                    checked={hideCancelledMbtLocations}
                    className="monthly-routes-filters__check mb-0 flex-shrink-0"
                    onChange={(e) => {
                      setHideCancelledMbtLocations(e.target.checked)
                      setPage(1)
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline-secondary"
                    size="sm"
                    className="d-inline-flex align-items-center gap-2 flex-shrink-0 ms-auto text-nowrap"
                    disabled={csvExporting}
                    onClick={() => void exportResultsAsCsv()}
                  >
                    {csvExporting ? (
                      <>
                        <span
                          className="spinner-border spinner-border-sm"
                          role="status"
                          aria-hidden
                        />
                        Exporting…
                      </>
                    ) : (
                      <>
                        <i className="bi bi-download" aria-hidden />
                        Export results as CSV
                      </>
                    )}
                  </Button>
                </div>
              </div>
          </div>
        </Card.Body>
      </Card>

      <Card className="app-surface-card">
        <Card.Body className="p-4">
          {error ? <div className="text-danger">{error}</div> : null}
          {loading ? <div className="text-muted">Loading library data...</div> : null}

          {tableSection}
          {!loading && !error ? (
            <div className="d-flex align-items-center flex-wrap gap-3 mt-2 w-100">
              <div className="small text-muted mb-0">{paginationSummaryLabel}</div>
              <div className="d-flex gap-2 align-items-center flex-shrink-0">
                <Button
                  variant="outline-secondary"
                  size="sm"
                  disabled={!canPrevPage}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline-secondary"
                  size="sm"
                  disabled={!canNextPage}
                  onClick={() =>
                    setPage((p) => (pagination ? Math.min(pagination.total_pages, p + 1) : p + 1))
                  }
                >
                  Next
                </Button>
              </div>
              <div
                className="ms-auto small text-muted d-flex align-items-center flex-wrap column-gap-4 row-gap-2"
                aria-label="Testing history legend"
              >
                <span className="d-inline-flex align-items-center gap-1 text-nowrap">
                  <i
                    className="bi bi-check-circle-fill text-success"
                    style={{ fontSize: '0.85rem', lineHeight: 1 }}
                    aria-hidden
                  />
                  Tested
                </span>
                <span className="d-inline-flex align-items-center gap-1 text-nowrap">
                  <i
                    className="bi bi-exclamation-circle-fill"
                    style={{ color: '#6f42c1', fontSize: '0.8rem', lineHeight: 1 }}
                    aria-hidden
                  />
                  Annual month
                </span>
                <span className="d-inline-flex align-items-center gap-1 text-nowrap">
                  <span className="d-inline-flex align-items-center gap-1" aria-hidden>
                    <i
                      className="bi bi-check-circle-fill text-success"
                      style={{ fontSize: '0.85rem', lineHeight: 1 }}
                    />
                    <i
                      className="bi bi-exclamation-circle-fill"
                      style={{ color: '#6f42c1', fontSize: '0.8rem', lineHeight: 1 }}
                    />
                  </span>
                  Tested (annual month)
                </span>
                <span className="d-inline-flex align-items-center gap-1 text-nowrap">
                  <i
                    className="bi bi-slash-circle-fill text-warning"
                    style={{ fontSize: '0.85rem', lineHeight: 1 }}
                    aria-hidden
                  />
                  Skipped
                </span>
                <span className="d-inline-flex align-items-center gap-1 text-nowrap">
                  <span className="text-muted" aria-hidden>
                    —
                  </span>
                  No data
                </span>
              </div>
            </div>
          ) : null}

        </Card.Body>
      </Card>

      <Modal show={showCreateLocationModal} onHide={() => setShowCreateLocationModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title className="h6 mb-0">Add Location</Modal.Title>
        </Modal.Header>
        <Modal.Body className="small d-flex flex-column gap-2">
          {createLocationError ? <div className="text-danger">{createLocationError}</div> : null}
          <Form.Group>
            <Form.Label className="small mb-1">Address</Form.Label>
            <Form.Control
              size="sm"
              type="search"
              value={createLocationAddressQuery}
              placeholder="Search address (Greater Victoria)"
              onChange={(e) => {
                const v = e.target.value
                setCreateLocationAddressQuery(v)
                setCreateLocationSelectedCandidate(null)
              }}
            />
            {!createLocationSelectedCandidate && createLocationLookupLoading ? (
              <div className="text-muted mt-1">Searching addresses...</div>
            ) : null}
            {!createLocationSelectedCandidate && createLocationLookupError ? (
              <div className="text-danger mt-1">{createLocationLookupError}</div>
            ) : null}
            {!createLocationSelectedCandidate &&
            !createLocationLookupLoading &&
            createLocationAddressQuery.trim().length >= 3 &&
            createLocationCandidates.length === 0 ? (
              <div className="text-muted mt-1">No matching addresses.</div>
            ) : null}
            {!createLocationSelectedCandidate && createLocationCandidates.length > 0 ? (
              <div className="d-flex flex-column gap-1 mt-2" style={CREATE_LOCATION_CANDIDATES_STYLE}>
                {createLocationCandidates.map((candidate) => (
                  <Button
                    key={`${candidate.display_address}-${candidate.latitude}-${candidate.longitude}`}
                    variant="outline-secondary"
                    size="sm"
                    className="text-start"
                    onClick={() => {
                      setCreateLocationSelectedCandidate(candidate)
                      setCreateLocationAddressQuery(candidate.display_address)
                      setCreateLocationCandidates([])
                    }}
                  >
                    {candidate.display_address}
                  </Button>
                ))}
              </div>
            ) : null}
            {createLocationSelectedCandidate ? (
              <div className="text-success small mt-1">Map pin will use the selected address.</div>
            ) : null}
          </Form.Group>
          <Form.Group>
            <Form.Label className="small mb-1">Route (optional)</Form.Label>
            <Form.Select
              size="sm"
              value={newLocationForm.test_day ?? ''}
              onChange={(e) => setNewLocationForm((prev) => ({ ...prev, test_day: e.target.value }))}
            >
              <option value="">Unassigned</option>
              {routeOptions.map((route) => (
                <option key={route} value={route}>
                  {route}
                </option>
              ))}
            </Form.Select>
          </Form.Group>
          <Form.Group>
            <Form.Label className="small mb-1">Property Management Company</Form.Label>
            <Form.Control
              size="sm"
              value={newLocationForm.property_management_company}
              onChange={(e) =>
                setNewLocationForm((prev) => ({
                  ...prev,
                  property_management_company: e.target.value,
                }))
              }
            />
          </Form.Group>
          <Form.Group>
            <Form.Label className="small mb-1">Status</Form.Label>
            <Form.Select
              size="sm"
              value={newLocationForm.status_raw}
              onChange={(e) => setNewLocationForm((prev) => ({ ...prev, status_raw: e.target.value }))}
            >
              {STATUS_OPTIONS.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </Form.Select>
          </Form.Group>
          <Form.Group>
            <Form.Label className="small mb-1">Keys (optional)</Form.Label>
            <Form.Control
              size="sm"
              value={newLocationForm.keys}
              onChange={(e) => setNewLocationForm((prev) => ({ ...prev, keys: e.target.value }))}
            />
          </Form.Group>
          <div className="d-flex justify-content-end gap-2 mt-2">
            <Button
              size="sm"
              variant="outline-secondary"
              onClick={() => setShowCreateLocationModal(false)}
              disabled={createLocationSaving}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={submitCreateLocation} disabled={createLocationSaving}>
              {createLocationSaving ? 'Saving...' : 'Create Location'}
            </Button>
          </div>
        </Modal.Body>
      </Modal>
    </div>
  )
}
