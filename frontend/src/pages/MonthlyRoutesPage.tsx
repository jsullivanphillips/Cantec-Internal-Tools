import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Form, Table } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import AddMonthlyLocationWizardModal from '../features/monthlyRoutes/AddMonthlyLocationWizardModal'
import HeroFilterPill from '../components/HeroFilterPill'
import {
  ANNUAL_COLUMN_STYLE,
  DIRECTORY_COLUMN_WIDTHS,
  KEYS_COLUMN_STYLE,
  LIBRARY_TABLE_HEADER_STICKY_STYLE,
  renderLibraryStatusDot,
  STATUS_COLUMN_STYLE,
} from '../features/monthlyRoutes/monthlyDirectoryTableShared'
import RouteLibraryLink from '../features/monthlyRoutes/RouteLibraryLink'
import {
  libraryKeycodeDisplay,
  libraryRouteNumberLine,
  libraryRouteOccurrenceLine,
  type LibraryLocation,
  type LibraryPayload,
} from '../features/monthlyRoutes/monthlyRoutesShared'
import { apiJson, isAbortError } from '../lib/apiClient'
import { PROCESSING_PAGE_TITLE_COMPACT_CLASS } from '../styles/pageTypography'

const DEFAULT_PAGE_SIZE = 50
const PAGE_SIZE_OPTIONS = [25, 50, 100] as const

const MONTH_NAME_OPTIONS = Array.from({ length: 12 }).map((_, idx) =>
  new Intl.DateTimeFormat('en-US', {
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2000, idx, 1)))
)

type LibraryPagination = NonNullable<LibraryPayload['meta']['pagination']>

function buildLibraryListQueryString(args: {
  tableSearch: string
  page: number
  pageSize: number
  unpaginated: boolean
}): string {
  const params = new URLSearchParams()
  params.set('include_history', 'false')
  if (args.tableSearch.trim()) params.set('q', args.tableSearch.trim())
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

function paginationSummary(pagination: LibraryPagination | undefined): string | null {
  if (!pagination) return null
  const { page: p, page_size: pageSize, total, total_pages: totalPages } = pagination
  const pages = totalPages >= 1 ? totalPages : 1
  if (total <= 0) {
    return `Showing 0 of 0 · Page ${p} of ${pages}`
  }
  const start = (p - 1) * pageSize + 1
  const end = Math.min(p * pageSize, total)
  return `Showing ${start}–${end} of ${total} · Page ${p} of ${pages}`
}

function LocationsPaginationBar({
  loading,
  summary,
  pagination,
  onPageChange,
}: {
  loading: boolean
  summary: string | null
  pagination: LibraryPagination | undefined
  onPageChange: (page: number) => void
}) {
  return (
    <div
      className="monthly-locations-pagination d-flex flex-wrap justify-content-between align-items-center gap-2 py-2"
    >
      {loading ? (
        <span
          className="home-skeleton-bar d-inline-block"
          style={{ width: '11rem', height: '0.85rem' }}
          aria-hidden
        />
      ) : (
        <span className="small text-muted mb-0">{summary}</span>
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
          disabled={
            !pagination || pagination.page >= pagination.total_pages || loading
          }
          onClick={() =>
            onPageChange(
              pagination ? Math.min(pagination.total_pages, pagination.page + 1) : 1
            )
          }
        >
          Next
        </Button>
      </div>
    </div>
  )
}

export default function MonthlyRoutesPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [payload, setPayload] = useState<LibraryPayload | null>(null)
  const [tableSearch, setTableSearch] = useState('')
  const [hideCancelledMbtLocations, setHideCancelledMbtLocations] = useState(true)
  const [showCreateLocationModal, setShowCreateLocationModal] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE)
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
      tableSearch,
      page,
      pageSize,
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
          setError('Unable to load monthly locations.')
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [page, pageSize, tableSearch])

  const locations = payload?.locations ?? []

  const filteredLocations = useMemo(() => {
    if (!hideCancelledMbtLocations) return locations
    return locations.filter((loc) => (loc.status_normalized || '').trim().toLowerCase() !== 'cancelled')
  }, [hideCancelledMbtLocations, locations])

  const pagination = payload?.meta.pagination
  const routeOptions = payload?.meta.routes ?? []
  const paginationSummaryLabel = useMemo(() => paginationSummary(pagination), [pagination])

  const exportResultsAsCsv = useCallback(async () => {
    setCsvExporting(true)
    try {
      const qs = buildLibraryListQueryString({
        tableSearch,
        page: 1,
        pageSize,
        unpaginated: true,
      })
      const data = await apiJson<LibraryPayload>(`/api/monthly_routes/library?${qs}`)
      let rows = data.locations ?? []
      if (hideCancelledMbtLocations) {
        rows = rows.filter((loc) => (loc.status_normalized || '').trim().toLowerCase() !== 'cancelled')
      }
      const headers = ['Status', 'Route', 'Label', 'Property Management', 'Key', 'Annual']
      const lines = [headers.map(escapeCsvField).join(',')]
      for (const loc of rows) {
        const line2 = libraryRouteOccurrenceLine(loc)
        const routeText = line2 ? `${libraryRouteNumberLine(loc)} / ${line2}` : libraryRouteNumberLine(loc)
        const keyText = libraryKeycodeDisplay(loc) || '—'
        lines.push(
          [
            statusExportLabel(loc.status_normalized),
            routeText,
            loc.label?.trim() || '',
            loc.property_management_company || '',
            keyText,
            loc.annual_month || '',
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
      a.download = `monthly-locations-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      window.alert('Unable to export CSV. Please try again.')
    } finally {
      setCsvExporting(false)
    }
  }, [hideCancelledMbtLocations, pageSize, tableSearch])

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

  const renderStatusDot = useCallback(
    (status: string | null | undefined) => renderLibraryStatusDot(status),
    [],
  )

  return (
    <div className="monthly-page monthly-routes-library-page d-flex flex-column gap-3">
      <Card className="app-surface-card monthly-filters-card monthly-hero-card">
        <Card.Body className="monthly-hero-card__body">
          <div className="monthly-hero-card__row">
            <h1 className={`${PROCESSING_PAGE_TITLE_COMPACT_CLASS} m-0`}>Monthly Locations</h1>
            <div className="monthly-hero-card__controls">
              <label className="monthly-hero-card__select-wrap">
                <i className="bi bi-list-ul" aria-hidden />
                <Form.Select
                  size="sm"
                  className="monthly-hero-card__select"
                  value={pageSize}
                  style={{ minWidth: '5.5rem' }}
                  aria-label="Rows per page"
                  onChange={(e) => {
                    setPageSize(Number(e.target.value))
                    setPage(1)
                  }}
                >
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </Form.Select>
              </label>
              <Button
                variant="primary"
                size="sm"
                className="fw-semibold text-nowrap"
                onClick={() => setShowCreateLocationModal(true)}
              >
                <i className="bi bi-plus-lg me-1" aria-hidden />
                Add Location
              </Button>
            </div>
          </div>
          <div className="monthly-hero-card__filters">
            <div
              className="run-review-filter monthly-hero-card__filter-pills"
              role="group"
              aria-label="Location filters"
            >
              <HeroFilterPill
                id="monthly-routes-hide-cancelled"
                icon="bi-eye-slash"
                label="Hide cancelled"
                checked={hideCancelledMbtLocations}
                onChange={(checked) => {
                  setHideCancelledMbtLocations(checked)
                  setPage(1)
                }}
              />
            </div>
            <Button
              type="button"
              variant="outline-secondary"
              size="sm"
              className="d-inline-flex align-items-center gap-2 ms-sm-auto text-nowrap"
              disabled={csvExporting}
              onClick={() => void exportResultsAsCsv()}
            >
              {csvExporting ? (
                <>
                  <span className="spinner-border spinner-border-sm" role="status" aria-hidden />
                  Exporting…
                </>
              ) : (
                <>
                  <i className="bi bi-download" aria-hidden />
                  Export CSV
                </>
              )}
            </Button>
          </div>
        </Card.Body>
      </Card>

      <Card className="app-surface-card monthly-locations-table-card monthly-results-card">
        {error ? (
          <Card.Body className="p-4">
            <div className="text-danger">{error}</div>
          </Card.Body>
        ) : (
          <Card.Body className="monthly-results-body">
            <div className="monthly-table-search py-2">
              <div className="app-topbar-location-search">
                <div className="app-topbar-location-search__field">
                  <i className="bi bi-search app-topbar-location-search__icon" aria-hidden />
                  <Form.Control
                    type="search"
                    size="sm"
                    className="app-topbar-location-search__input"
                    value={tableSearch}
                    placeholder="Route, address, property, key, annual…"
                    aria-label="Search locations"
                    onChange={(e) => {
                      setTableSearch(e.target.value)
                      setPage(1)
                    }}
                  />
                </div>
              </div>
            </div>
            <LocationsPaginationBar
              loading={loading}
              summary={paginationSummaryLabel}
              pagination={pagination}
              onPageChange={setPage}
            />
            <div className="monthly-locations-table-wrap">
              {loading ? (
                <div className="p-4 text-muted">Loading locations…</div>
              ) : (
                <Table
                  striped
                  hover
                  className="align-middle monthly-routes-library-table monthly-locations-directory-table mb-0"
                >
                  <colgroup>
                    <col style={{ width: DIRECTORY_COLUMN_WIDTHS.status }} />
                    <col style={{ width: DIRECTORY_COLUMN_WIDTHS.route }} />
                    <col style={{ width: DIRECTORY_COLUMN_WIDTHS.address }} />
                    <col style={{ width: DIRECTORY_COLUMN_WIDTHS.property }} />
                    <col style={{ width: DIRECTORY_COLUMN_WIDTHS.key }} />
                    <col style={{ width: DIRECTORY_COLUMN_WIDTHS.annual }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th
                        className="text-center monthly-locations-table__status-col"
                        style={{ ...STATUS_COLUMN_STYLE, ...LIBRARY_TABLE_HEADER_STICKY_STYLE }}
                      >
                        Status
                      </th>
                      <th
                        className="monthly-locations-table__route-col"
                        style={LIBRARY_TABLE_HEADER_STICKY_STYLE}
                      >
                        Route
                      </th>
                      <th
                        className="monthly-locations-table__label-col"
                        style={LIBRARY_TABLE_HEADER_STICKY_STYLE}
                      >
                        Label
                      </th>
                      <th style={LIBRARY_TABLE_HEADER_STICKY_STYLE}>Property Management</th>
                      <th
                        className="text-center"
                        style={{ ...KEYS_COLUMN_STYLE, ...LIBRARY_TABLE_HEADER_STICKY_STYLE }}
                      >
                        Key
                      </th>
                      <th
                        className="text-center"
                        style={{ ...ANNUAL_COLUMN_STYLE, ...LIBRARY_TABLE_HEADER_STICKY_STYLE }}
                      >
                        Annual
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLocations.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-muted py-4">
                          No locations match the current filters.
                        </td>
                      </tr>
                    ) : (
                      filteredLocations.map((loc) => (
                        <tr key={loc.id}>
                          <td
                            className="text-center library-table-cell-clamp monthly-locations-table__status-col"
                            style={STATUS_COLUMN_STYLE}
                          >
                            <div className="library-table-cell-inner">
                              {renderStatusDot(loc.status_normalized)}
                            </div>
                          </td>
                          <td className="library-table-cell-clamp monthly-locations-table__route-col">
                            <div className="library-table-cell-inner">
                              <RouteLibraryLink loc={loc} />
                            </div>
                          </td>
                          <td className="library-table-cell-clamp text-break monthly-locations-table__label-col">
                            <div className="library-table-cell-inner">
                              <Link
                                to={`/monthlies/locations/${loc.id}`}
                                className="monthly-locations-table__link"
                                title={(loc.address || '').trim() || undefined}
                              >
                                {loc.label?.trim() || '—'}
                              </Link>
                            </div>
                          </td>
                          <td className="library-table-cell-clamp">
                            <div className="library-table-cell-inner">
                              {loc.property_management_company || '—'}
                            </div>
                          </td>
                          <td className="library-table-cell-clamp" style={KEYS_COLUMN_STYLE}>
                            <div className="library-table-cell-inner">
                              {loc.key ? (
                                <Link
                                  to={`/keys/${loc.key.id}`}
                                  className="monthly-locations-table__link"
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
                              annualEditLocationId === loc.id
                                ? 'text-center'
                                : 'text-center library-table-cell-clamp'
                            }
                            style={ANNUAL_COLUMN_STYLE}
                          >
                            {annualEditLocationId === loc.id ? (
                              <Form.Select
                                size="sm"
                                className="monthly-locations-table__annual-select"
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
                                  className="monthly-locations-table__annual-btn"
                                  aria-label={`Change annual month${loc.annual_month ? ` (${loc.annual_month})` : ''}`}
                                  onClick={() => setAnnualEditLocationId(loc.id)}
                                >
                                  <span>{loc.annual_month || '—'}</span>
                                  <i
                                    className="bi bi-chevron-down monthly-locations-table__annual-btn-caret"
                                    aria-hidden
                                  />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </Table>
              )}
            </div>
            <LocationsPaginationBar
              loading={loading}
              summary={paginationSummaryLabel}
              pagination={pagination}
              onPageChange={setPage}
            />
          </Card.Body>
        )}
      </Card>

      <AddMonthlyLocationWizardModal
        show={showCreateLocationModal}
        onHide={() => setShowCreateLocationModal(false)}
        routeOptions={routeOptions}
        onCreated={mergeUpdatedLocation}
      />
    </div>
  )
}
