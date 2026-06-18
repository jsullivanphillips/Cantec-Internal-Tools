import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Table } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import { formatCurrencyCad } from '../../lib/formatCurrencyCad'
import {
  DASHBOARD_ROUTE_BREAKDOWN_RANGE_OPTIONS,
  DEFAULT_DASHBOARD_ROUTE_BREAKDOWN_RANGE,
  fetchDashboardLocationMetrics,
  type DashboardRouteBreakdownRange,
  type DashboardLocationMetricsPayload,
  type DashboardLocationMetricsRow,
  type DashboardLocationPriceRow,
} from './monthlyDashboardShared'
import { routeDisplayLabel } from './monthlyRoutesShared'

function formatVisitMinutes(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return '—'
  const rounded = Math.round(minutes)
  if (rounded < 60) return `${rounded} min`
  const hours = Math.floor(rounded / 60)
  const remainder = rounded % 60
  if (remainder === 0) return `${hours} hr`
  return `${hours} hr ${remainder} min`
}

function formatPricePerHour(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${formatCurrencyCad(value)}/hr`
}

function LocationMonthlyPriceTable({
  title,
  rows,
  emptyMessage,
}: {
  title: string
  rows: DashboardLocationPriceRow[]
  emptyMessage: string
}) {
  return (
    <div className="mb-4">
      <h3 className="h6 mb-3">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-muted small mb-0">{emptyMessage}</p>
      ) : (
        <div className="monthly-dashboard-breakdown__card">
          <div className="table-responsive">
            <Table size="sm" className="mb-0 align-middle monthly-dashboard-breakdown__table">
              <thead>
                <tr>
                  <th className="monthly-dashboard-breakdown__col-route">Site</th>
                  <th className="monthly-dashboard-breakdown__col-route">Route</th>
                  <th className="text-end monthly-dashboard-breakdown__col-money">Monthly price</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.location_id}>
                    <td className="monthly-dashboard-breakdown__col-route">
                      <Link
                        to={`/monthlies/locations/${row.location_id}`}
                        className="monthly-dashboard-breakdown__route-link"
                      >
                        {row.label}
                      </Link>
                      {row.address ? (
                        <div className="text-muted small text-truncate">{row.address}</div>
                      ) : null}
                    </td>
                    <td className="monthly-dashboard-breakdown__col-route">
                      {row.route ? (
                        <Link
                          to={`/monthlies/routes/${row.route.id}`}
                          className="monthly-dashboard-breakdown__route-link"
                        >
                          {routeDisplayLabel(row.route)}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="text-end tabular-nums monthly-dashboard-breakdown__col-money">
                      {row.price_per_month != null ? formatCurrencyCad(row.price_per_month) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </div>
      )}
    </div>
  )
}

function LocationMetricsTable({
  title,
  rows,
  emptyMessage,
}: {
  title: string
  rows: DashboardLocationMetricsRow[]
  emptyMessage: string
}) {
  return (
    <div className="mb-4">
      <h3 className="h6 mb-3">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-muted small mb-0">{emptyMessage}</p>
      ) : (
        <div className="monthly-dashboard-breakdown__card">
          <div className="table-responsive">
            <Table size="sm" className="mb-0 align-middle monthly-dashboard-breakdown__table">
              <thead>
                <tr>
                  <th className="monthly-dashboard-breakdown__col-route">Site</th>
                  <th className="monthly-dashboard-breakdown__col-route">Route</th>
                  <th className="text-end monthly-dashboard-breakdown__col-money">Monthly price</th>
                  <th className="text-end monthly-dashboard-breakdown__col-compact">Avg on-site</th>
                  <th className="text-end monthly-dashboard-breakdown__col-money">$/hr (price)</th>
                  <th className="text-end monthly-dashboard-breakdown__col-compact">Visits</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.location_id}>
                    <td className="monthly-dashboard-breakdown__col-route">
                      <Link
                        to={`/monthlies/locations/${row.location_id}`}
                        className="monthly-dashboard-breakdown__route-link"
                      >
                        {row.label}
                      </Link>
                      {row.address ? (
                        <div className="text-muted small text-truncate">{row.address}</div>
                      ) : null}
                    </td>
                    <td className="monthly-dashboard-breakdown__col-route">
                      {row.route ? (
                        <Link
                          to={`/monthlies/routes/${row.route.id}`}
                          className="monthly-dashboard-breakdown__route-link"
                        >
                          {routeDisplayLabel(row.route)}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="text-end tabular-nums monthly-dashboard-breakdown__col-money">
                      {row.price_per_month != null ? formatCurrencyCad(row.price_per_month) : '—'}
                    </td>
                    <td className="text-end tabular-nums monthly-dashboard-breakdown__col-compact">
                      {formatVisitMinutes(row.avg_visit_minutes)}
                    </td>
                    <td className="text-end tabular-nums monthly-dashboard-breakdown__col-money">
                      {formatPricePerHour(row.price_per_hour)}
                    </td>
                    <td className="text-end tabular-nums monthly-dashboard-breakdown__col-compact">
                      {row.visits_sampled}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </div>
      )}
    </div>
  )
}

function MetricsRangeSelector({
  value,
  onChange,
  loadingRange,
  periodLabel,
}: {
  value: DashboardRouteBreakdownRange
  onChange: (range: DashboardRouteBreakdownRange) => void
  loadingRange?: DashboardRouteBreakdownRange | null
  periodLabel?: string | null
}) {
  return (
    <div className="monthly-dashboard-breakdown__range-toolbar" aria-label="Location metrics date range">
      <span className="monthly-dashboard-breakdown__range-toolbar-label">Range</span>
      <div className="monthly-dashboard-breakdown__range-options" role="radiogroup" aria-label="Date range">
        {DASHBOARD_ROUTE_BREAKDOWN_RANGE_OPTIONS.map((option) => {
          const active = value === option.value
          const loading = loadingRange === option.value
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              aria-busy={loading || undefined}
              title={option.hint}
              className={`monthly-dashboard-breakdown__range-option${active ? ' monthly-dashboard-breakdown__range-option--active' : ''}${loading ? ' monthly-dashboard-breakdown__range-option--loading' : ''}`}
              onClick={() => onChange(option.value)}
            >
              <span className="monthly-dashboard-breakdown__range-option-text">{option.label}</span>
              {loading ? (
                <span
                  className="spinner-border spinner-border-sm monthly-dashboard-breakdown__range-spinner"
                  role="status"
                  aria-label="Loading"
                />
              ) : null}
            </button>
          )
        })}
      </div>
      {periodLabel ? (
        <span className="monthly-dashboard-breakdown__range-period text-muted tabular-nums">{periodLabel}</span>
      ) : null}
    </div>
  )
}

export default function MonthlyDashboardLocationMetrics() {
  const [payload, setPayload] = useState<DashboardLocationMetricsPayload | null>(null)
  const [loadingRange, setLoadingRange] = useState<DashboardRouteBreakdownRange | null>(
    DEFAULT_DASHBOARD_ROUTE_BREAKDOWN_RANGE,
  )
  const [error, setError] = useState<string | null>(null)
  const [range, setRange] = useState<DashboardRouteBreakdownRange>(
    DEFAULT_DASHBOARD_ROUTE_BREAKDOWN_RANGE,
  )
  const loadRequestRef = useRef(0)

  const load = useCallback(async (selectedRange: DashboardRouteBreakdownRange) => {
    const requestId = ++loadRequestRef.current
    setLoadingRange(selectedRange)
    setError(null)

    try {
      const data = await fetchDashboardLocationMetrics(selectedRange)
      if (requestId !== loadRequestRef.current) return
      setPayload(data)
      setError(null)
    } catch (err) {
      if (requestId !== loadRequestRef.current) return
      if (err instanceof Error && (err.message === 'redirect' || err.message === 'auth')) {
        return
      }
      setError(err instanceof Error ? err.message : 'Unable to load location metrics. Try again.')
    } finally {
      if (requestId === loadRequestRef.current) {
        setLoadingRange(null)
      }
    }
  }, [])

  useEffect(() => {
    void load(range)
  }, [load, range])

  const displayPayload = payload?.range === range ? payload : null
  const isLoadingCurrentRange = loadingRange === range
  const selectedRangeLabel =
    DASHBOARD_ROUTE_BREAKDOWN_RANGE_OPTIONS.find((option) => option.value === range)?.label ?? 'Selected range'

  if (isLoadingCurrentRange && !displayPayload && !error) {
    return (
      <section className="monthly-dashboard-breakdown monthly-location-metrics">
        <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
          <h2 className="h5 mb-0">Location metrics — {selectedRangeLabel}</h2>
        </div>
        <MetricsRangeSelector value={range} onChange={setRange} loadingRange={loadingRange} />
        <div className="text-muted">Loading location metrics…</div>
      </section>
    )
  }

  if (error && !displayPayload) {
    return (
      <section className="monthly-dashboard-breakdown monthly-location-metrics">
        <MetricsRangeSelector value={range} onChange={setRange} loadingRange={loadingRange} />
        <Alert variant="danger" className="mb-0">
          <div className="d-flex flex-wrap align-items-start justify-content-between gap-3">
            <div>
              <Alert.Heading as="h3" className="h6 mb-2">
                Couldn&apos;t load location metrics
              </Alert.Heading>
              <p className="mb-0 small">{error}</p>
            </div>
            <Button variant="outline-danger" size="sm" onClick={() => void load(range)} disabled={isLoadingCurrentRange}>
              {isLoadingCurrentRange ? 'Retrying…' : 'Try again'}
            </Button>
          </div>
        </Alert>
      </section>
    )
  }

  if (!displayPayload) {
    return <div className="text-muted mb-0">No location metrics data.</div>
  }

  const periodDetail =
    displayPayload.period_start === displayPayload.period_end
      ? displayPayload.period_start
      : `${displayPayload.period_start} – ${displayPayload.period_end}`

  return (
    <section className="monthly-dashboard-breakdown monthly-location-metrics">
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
        <h2 className="h5 mb-0">Location metrics — {displayPayload.period_label}</h2>
      </div>
      <MetricsRangeSelector
        value={range}
        onChange={setRange}
        loadingRange={loadingRange}
        periodLabel={periodDetail}
      />
      {error ? (
        <Alert variant="warning" className="mb-3 small">
          {error}
        </Alert>
      ) : null}
      <LocationMonthlyPriceTable
        title="Lowest monthly price"
        rows={displayPayload.lowest_monthly_price_locations ?? []}
        emptyMessage="No active sites with a monthly price set."
      />
      <LocationMetricsTable
        title="Lowest price per hour on site"
        rows={displayPayload.lowest_performers}
        emptyMessage="No sites with a monthly price and on-site visit times in this range."
      />
    </section>
  )
}
