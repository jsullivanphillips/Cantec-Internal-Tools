import type { CSSProperties } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Col, Form, Row, Table } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import AddMonthlyLocationWizardModal from '../features/monthlyRoutes/AddMonthlyLocationWizardModal'
import RouteLibraryLink from '../features/monthlyRoutes/RouteLibraryLink'
import {
  libraryKeycodeDisplay,
  libraryRouteNumberLine,
  libraryRouteOccurrenceLine,
  type LibraryLocation,
  type LibraryPayload,
} from '../features/monthlyRoutes/monthlyRoutesShared'
import { apiJson, isAbortError } from '../lib/apiClient'

const DEFAULT_PAGE_SIZE = 50
const PAGE_SIZE_OPTIONS = [25, 50, 100] as const

const MONTH_NAME_OPTIONS = Array.from({ length: 12 }).map((_, idx) =>
  new Intl.DateTimeFormat('en-US', {
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2000, idx, 1)))
)

/** Balanced directory columns; address + PMC slightly wider than route/key/annual. */
const DIRECTORY_COLUMN_WIDTHS = {
  status: '5%',
  route: '15%',
  address: '20%',
  property: '20%',
  key: '15%',
  annual: '15%',
} as const

const STATUS_COLUMN_STYLE: CSSProperties = {
  textAlign: 'center',
}

const KEYS_COLUMN_STYLE: CSSProperties = {
  textAlign: 'center',
}

const ANNUAL_COLUMN_STYLE: CSSProperties = {
  textAlign: 'center',
}

const LIBRARY_TABLE_HEADER_STICKY_STYLE: CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 5,
  backgroundColor: '#fff',
  borderTop: '1px solid #dee2e6',
  boxShadow: 'inset 0 1px 0 #dee2e6, inset 0 -1px 0 rgba(0, 0, 0, 0.12)',
}

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
  position,
}: {
  loading: boolean
  summary: string | null
  pagination: LibraryPagination | undefined
  onPageChange: (page: number) => void
  position: 'top' | 'bottom'
}) {
  return (
    <div
      className={`monthly-locations-pagination d-flex flex-wrap justify-content-between align-items-center gap-2 px-3 py-2 ${
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

  return (
    <div className="monthly-routes-library-page d-flex flex-column gap-3">
      <Card className="app-surface-card monthly-routes-filters-card">
        <Card.Body className="p-3 p-md-4">
          <div className="flex-grow-1 min-w-0 d-flex flex-column gap-3">
            <div className="d-flex flex-column flex-sm-row align-items-start justify-content-between gap-2 gap-sm-3">
              <div>
                <h2 className="processing-page-title mb-1">Monthly Locations</h2>
                <p className="text-muted small mb-0">
                  Browse and manage monthly bell testing sites. Open a location for testing history and details.
                </p>
              </div>
              <Button
                variant="primary"
                className="fw-semibold px-4 align-self-stretch align-self-sm-auto"
                onClick={() => setShowCreateLocationModal(true)}
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
                    <Form.Label className="monthly-routes-filters__label mb-1">Rows per page</Form.Label>
                    <Form.Select
                      size="sm"
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value))
                        setPage(1)
                      }}
                      style={{ minWidth: '5.5rem' }}
                      aria-label="Rows per page"
                    >
                      {PAGE_SIZE_OPTIONS.map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </Form.Select>
                  </Form.Group>
                </Col>
              </Row>
            </div>

            <div className="monthly-routes-filters__toolbar d-flex flex-wrap align-items-center gap-3 gap-md-4">
              <Form.Check
                id="monthly-routes-hide-cancelled"
                type="checkbox"
                label="Hide cancelled MBT locations"
                checked={hideCancelledMbtLocations}
                className="monthly-routes-filters__check mb-0"
                onChange={(e) => {
                  setHideCancelledMbtLocations(e.target.checked)
                  setPage(1)
                }}
              />
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
                    Export CSV
                  </>
                )}
              </Button>
            </div>
          </div>
        </Card.Body>
      </Card>

      <Card className="app-surface-card monthly-locations-table-card">
        {error ? (
          <Card.Body className="p-4">
            <div className="text-danger">{error}</div>
          </Card.Body>
        ) : (
          <>
            <LocationsPaginationBar
              loading={loading}
              summary={paginationSummaryLabel}
              pagination={pagination}
              onPageChange={setPage}
              position="top"
            />
            <div className="monthly-locations-table-wrap">
              {loading ? (
                <div className="p-4 text-muted">Loading locations…</div>
              ) : (
                <Table
                  striped
                  hover
                  bordered
                  size="sm"
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
                        className="text-center"
                        style={{ ...STATUS_COLUMN_STYLE, ...LIBRARY_TABLE_HEADER_STICKY_STYLE }}
                      >
                        Status
                      </th>
                      <th style={LIBRARY_TABLE_HEADER_STICKY_STYLE}>Route</th>
                      <th style={LIBRARY_TABLE_HEADER_STICKY_STYLE}>Label</th>
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
                          <td className="text-center library-table-cell-clamp" style={STATUS_COLUMN_STYLE}>
                            <div className="library-table-cell-inner">
                              {renderStatusDot(loc.status_normalized)}
                            </div>
                          </td>
                          <td className="library-table-cell-clamp">
                            <div className="library-table-cell-inner">
                              <RouteLibraryLink loc={loc} />
                            </div>
                          </td>
                          <td className="library-table-cell-clamp text-break">
                            <div className="library-table-cell-inner">
                              <Link
                                to={`/monthlies/locations/${loc.id}`}
                                className="fw-semibold text-decoration-none text-primary"
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
                              annualEditLocationId === loc.id
                                ? 'text-center'
                                : 'text-center library-table-cell-clamp'
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
              position="bottom"
            />
          </>
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
