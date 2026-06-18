import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Alert, Badge, Button, OverlayTrigger, Table, Tooltip } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import {
  DASHBOARD_ROUTE_BREAKDOWN_RANGE_OPTIONS,
  DEFAULT_DASHBOARD_ROUTE_BREAKDOWN_RANGE,
  fetchDashboardRoutePerformance,
  type DashboardRouteBreakdownRange,
  type DashboardRoutePerformancePayload,
  type DashboardRoutePerformanceRow,
} from './monthlyDashboardShared'
import { formatNetPct } from './routePerformanceDisplay'
import {
  capacityBandLabel,
  enrichHealthRow,
  fieldDurationColumnLabel,
  formatKmPerBuilding,
  formatPreRouteGap,
  formatSkippedValue,
  formatTypicalDuration,
  preRouteGapColumnLabel,
  skippedColumnLabel,
  sortHealthRows,
  stDurationColumnLabel,
  type RouteHealthScorecardRow,
  type RouteHealthSortDir,
  type RouteHealthSortKey,
} from './routeHealthScorecard'
import MonthlyDashboardRoutePerformanceSkeleton from './MonthlyDashboardRoutePerformanceSkeleton'
import {
  readRoutePerformanceCache,
  writeRoutePerformanceCache,
} from './routePerformanceDashboardCache'
import { routeDisplayLabel } from './monthlyRoutesShared'

const INSUFFICIENT_RUN_TIME_LABEL = 'Insufficient run time data'

const NET_PCT_GRADIENT_MIN = 0.4
const NET_PCT_GRADIENT_MAX = 0.72

function netPctGradientStyle(pct: number): { backgroundColor: string; color: string } {
  const t = Math.max(
    0,
    Math.min(1, (pct - NET_PCT_GRADIENT_MIN) / (NET_PCT_GRADIENT_MAX - NET_PCT_GRADIENT_MIN)),
  )
  const hue = Math.round(t * 120)
  return {
    backgroundColor: `hsl(${hue}, 62%, 91%)`,
    color: `hsl(${hue}, 58%, 28%)`,
  }
}

function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function capacityBadgeVariant(
  band: RouteHealthScorecardRow['capacityBand'],
): 'success' | 'primary' | 'warning' | 'danger' | 'secondary' {
  switch (band) {
    case 'under':
      return 'success'
    case 'healthy':
      return 'primary'
    case 'full':
      return 'warning'
    case 'over':
      return 'danger'
    default:
      return 'secondary'
  }
}

function SortableHeader({
  label,
  sortKey,
  activeKey,
  sortDir,
  onSort,
  className,
  compact,
  title,
  infoTooltip,
  infoLabel,
}: {
  label: string
  sortKey: RouteHealthSortKey
  activeKey: RouteHealthSortKey
  sortDir: RouteHealthSortDir
  onSort: (key: RouteHealthSortKey) => void
  className?: string
  compact?: boolean
  title?: string
  infoTooltip?: ReactNode
  infoLabel?: string
}) {
  const active = activeKey === sortKey
  const tooltipId = `route-health-header-${sortKey}`
  return (
    <th className={className}>
      <button
        type="button"
        title={infoTooltip ? undefined : title}
        className={`monthly-dashboard-breakdown__sort${active ? ' monthly-dashboard-breakdown__sort--active' : ''}${compact ? ' monthly-dashboard-breakdown__sort--compact' : ''}`}
        onClick={() => onSort(sortKey)}
        aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        <span className="monthly-dashboard-breakdown__sort-label">
          <span>{label}</span>
          {infoTooltip ? (
            <HeaderColumnTooltip id={tooltipId} label={infoLabel ?? label}>
              {infoTooltip}
            </HeaderColumnTooltip>
          ) : null}
        </span>
        {active ? (
          <i
            className={`bi ${sortDir === 'asc' ? 'bi-caret-up-fill' : 'bi-caret-down-fill'} monthly-dashboard-breakdown__sort-icon`}
            aria-hidden
          />
        ) : null}
      </button>
    </th>
  )
}

function HeaderColumnTooltip({
  id,
  label,
  children,
}: {
  id: string
  label: string
  children: ReactNode
}) {
  return (
    <OverlayTrigger
      placement="top"
      trigger={['hover', 'focus']}
      overlay={
        <Tooltip id={id} className="monthly-dashboard-breakdown__formula-tooltip">
          <div className="monthly-dashboard-breakdown__formula-tooltip-body">{children}</div>
        </Tooltip>
      }
    >
      <button
        type="button"
        className="monthly-dashboard-breakdown__header-info"
        aria-label={label}
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <i className="bi bi-info-circle" aria-hidden />
      </button>
    </OverlayTrigger>
  )
}

function HealthTableHeader({
  sortKey,
  sortDir,
  onSort,
  breakdownRange,
}: {
  sortKey: RouteHealthSortKey
  sortDir: RouteHealthSortDir
  onSort: (key: RouteHealthSortKey) => void
  breakdownRange: DashboardRouteBreakdownRange
}) {
  return (
    <thead>
      <tr>
        <SortableHeader
          label="Route"
          sortKey="route"
          activeKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
          className="monthly-dashboard-breakdown__col-route"
        />
        <SortableHeader
          label="Buildings"
          sortKey="building_count"
          activeKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
          className="text-end monthly-dashboard-breakdown__col-compact"
          compact
        />
        <SortableHeader
          label={stDurationColumnLabel(breakdownRange)}
          sortKey="avg_hours"
          activeKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
          className="text-end monthly-dashboard-breakdown__col-compact"
          compact
          title="ServiceTrade testing-job clock-in to clock-out"
        />
        <SortableHeader
          label={fieldDurationColumnLabel(breakdownRange)}
          sortKey="field_avg_hours"
          activeKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
          className="text-end monthly-dashboard-breakdown__col-compact"
          compact
          infoLabel="Field duration"
          infoTooltip={
            <>
              Calculated from the first site&apos;s time-in and the latest clock-out event on the
              route.
            </>
          }
        />
        <SortableHeader
          label="Capacity"
          sortKey="capacity_hours"
          activeKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
          className="text-end monthly-dashboard-breakdown__col-compact"
          compact
          title="Capacity band from field duration when available, otherwise ServiceTrade job duration"
        />
        <SortableHeader
          label={preRouteGapColumnLabel(breakdownRange)}
          sortKey="pre_route_gap_minutes"
          activeKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
          className="text-end monthly-dashboard-breakdown__col-compact"
          compact
          title="Time between ServiceTrade job clock-in and first stop time-in (drive / early clock-in)"
        />
        <SortableHeader
          label="Sprawl"
          sortKey="km_per_building"
          activeKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
          className="text-end monthly-dashboard-breakdown__col-compact"
          compact
        />
        <SortableHeader
          label="Monitoring"
          sortKey="monitoring_pct"
          activeKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
          className="text-end monthly-dashboard-breakdown__col-compact"
          compact
        />
        <SortableHeader
          label={skippedColumnLabel(breakdownRange)}
          sortKey="skipped_non_annual"
          activeKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
          className="text-end monthly-dashboard-breakdown__col-compact"
          compact
        />
        <SortableHeader
          label="Net %"
          sortKey="monthly_net_pct"
          activeKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
          className="text-end monthly-dashboard-breakdown__col-net"
          compact
        />
      </tr>
    </thead>
  )
}

function NetPctCell({ row }: { row: DashboardRoutePerformanceRow }) {
  if (!row.has_sufficient_run_time_data || row.monthly_net_pct == null) {
    return <span>—</span>
  }
  const style = netPctGradientStyle(row.monthly_net_pct)
  return (
    <span className="monthly-dashboard-breakdown__net-pill tabular-nums" style={style}>
      {formatNetPct(row.monthly_net_pct)}
    </span>
  )
}

function HealthRow({ row }: { row: RouteHealthScorecardRow }) {
  const source = row.source
  const insufficient = !source.has_sufficient_run_time_data
  return (
    <tr className={insufficient ? 'monthly-dashboard-breakdown__row--insufficient' : undefined}>
      <td className="monthly-dashboard-breakdown__col-route">
        <Link to={`/monthlies/routes/${source.route.id}`} className="monthly-dashboard-breakdown__route-link">
          {routeDisplayLabel(source.route)}
        </Link>
        {insufficient ? (
          <Badge bg="warning" text="dark" className="ms-2 monthly-dashboard-breakdown__insufficient-badge">
            {INSUFFICIENT_RUN_TIME_LABEL}
          </Badge>
        ) : null}
      </td>
      <td className="text-end tabular-nums monthly-dashboard-breakdown__col-compact">
        {source.building_count}
      </td>
      <td className="text-end tabular-nums monthly-dashboard-breakdown__col-compact">
        {formatTypicalDuration(source.avg_hours)}
      </td>
      <td className="text-end tabular-nums monthly-dashboard-breakdown__col-compact">
        {formatTypicalDuration(source.field_avg_hours)}
      </td>
      <td className="text-end tabular-nums monthly-dashboard-breakdown__col-compact">
        {row.capacityBand === 'unknown' ? (
          <span>—</span>
        ) : (
          <Badge
            bg={capacityBadgeVariant(row.capacityBand)}
            className="monthly-route-health-capacity-badge"
          >
            {capacityBandLabel(row.capacityBand)}
          </Badge>
        )}
      </td>
      <td className="text-end tabular-nums monthly-dashboard-breakdown__col-compact">
        {formatPreRouteGap(source.pre_route_gap_minutes)}
      </td>
      <td className="text-end tabular-nums monthly-dashboard-breakdown__col-compact">
        {formatKmPerBuilding(row.kmPerBuilding)}
      </td>
      <td className="text-end tabular-nums monthly-dashboard-breakdown__col-compact">
        {row.monitoringPct != null ? `${row.monitoringPct}%` : '—'}
      </td>
      <td className="text-end tabular-nums monthly-dashboard-breakdown__col-compact">
        {formatSkippedValue(source.skipped_non_annual)}
      </td>
      <td className="text-end tabular-nums monthly-dashboard-breakdown__col-net">
        <NetPctCell row={source} />
      </td>
    </tr>
  )
}

function HealthTable({
  rows,
  sortKey,
  sortDir,
  onSort,
  breakdownRange,
}: {
  rows: RouteHealthScorecardRow[]
  sortKey: RouteHealthSortKey
  sortDir: RouteHealthSortDir
  onSort: (key: RouteHealthSortKey) => void
  breakdownRange: DashboardRouteBreakdownRange
}) {
  return (
    <div className="monthly-dashboard-breakdown__card">
      <div className="table-responsive">
        <Table size="sm" className="mb-0 align-middle monthly-dashboard-breakdown__table">
          <HealthTableHeader
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={onSort}
            breakdownRange={breakdownRange}
          />
          <tbody>
            {rows.map((row) => (
              <HealthRow key={row.source.route.id} row={row} />
            ))}
          </tbody>
        </Table>
      </div>
    </div>
  )
}

function HealthLoadErrorAlert({
  message,
  onRetry,
  retrying,
}: {
  message: string
  onRetry: () => void
  retrying?: boolean
}) {
  return (
    <Alert variant="danger" className="mb-0">
      <div className="d-flex flex-wrap align-items-start justify-content-between gap-3">
        <div>
          <Alert.Heading as="h3" className="h6 mb-2">
            Couldn&apos;t load route health
          </Alert.Heading>
          <p className="mb-0 small">{message}</p>
        </div>
        <Button variant="outline-danger" size="sm" onClick={onRetry} disabled={retrying}>
          {retrying ? 'Retrying…' : 'Try again'}
        </Button>
      </div>
    </Alert>
  )
}

function HealthRangeSelector({
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
    <div className="monthly-dashboard-breakdown__range-toolbar" aria-label="Health scorecard date range">
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

export default function MonthlyDashboardRoutePerformance() {
  const [payload, setPayload] = useState<DashboardRoutePerformancePayload | null>(null)
  const [loadingRange, setLoadingRange] = useState<DashboardRouteBreakdownRange | null>(
    DEFAULT_DASHBOARD_ROUTE_BREAKDOWN_RANGE,
  )
  const [error, setError] = useState<string | null>(null)
  const [range, setRange] = useState<DashboardRouteBreakdownRange>(
    DEFAULT_DASHBOARD_ROUTE_BREAKDOWN_RANGE,
  )
  const [sortKey, setSortKey] = useState<RouteHealthSortKey>('route')
  const [sortDir, setSortDir] = useState<RouteHealthSortDir>('asc')
  const [exporting, setExporting] = useState(false)
  const loadRequestRef = useRef(0)

  const load = useCallback(async (selectedRange: DashboardRouteBreakdownRange) => {
    const requestId = ++loadRequestRef.current
    setLoadingRange(selectedRange)
    setError(null)

    const cached = readRoutePerformanceCache(selectedRange)
    if (cached && requestId === loadRequestRef.current) {
      setPayload(cached)
    }

    try {
      const data = await fetchDashboardRoutePerformance(selectedRange)
      if (requestId !== loadRequestRef.current) return
      setPayload(data)
      setError(null)
      writeRoutePerformanceCache(selectedRange, data)
    } catch (err) {
      if (requestId !== loadRequestRef.current) return
      if (err instanceof Error && (err.message === 'redirect' || err.message === 'auth')) {
        return
      }
      if (!cached) {
        setError(err instanceof Error ? err.message : 'Unable to load route health. Try again.')
      }
    } finally {
      if (requestId === loadRequestRef.current) {
        setLoadingRange(null)
      }
    }
  }, [])

  useEffect(() => {
    void load(range)
  }, [load, range])

  const onRangeChange = useCallback((nextRange: DashboardRouteBreakdownRange) => {
    setRange(nextRange)
    setSortKey('route')
    setSortDir('asc')
  }, [])

  const onSort = useCallback(
    (key: RouteHealthSortKey) => {
      if (sortKey === key) {
        setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
      } else {
        setSortKey(key)
        setSortDir(key === 'route' ? 'asc' : 'desc')
      }
    },
    [sortKey],
  )

  const displayPayload = payload?.range === range ? payload : null
  const isLoadingCurrentRange = loadingRange === range

  const { healthRows, insufficientRows } = useMemo(() => {
    if (!displayPayload?.rows?.length) {
      return { healthRows: [], insufficientRows: [] }
    }
    const withData: RouteHealthScorecardRow[] = []
    const insufficient: RouteHealthScorecardRow[] = []
    for (const row of displayPayload.rows) {
      const enriched = enrichHealthRow(row)
      if (row.has_sufficient_run_time_data) {
        withData.push(enriched)
      } else {
        insufficient.push(enriched)
      }
    }
    return {
      healthRows: sortHealthRows(withData, sortKey, sortDir),
      insufficientRows: sortHealthRows(insufficient, sortKey, sortDir),
    }
  }, [displayPayload, sortKey, sortDir])

  const exportCsv = useCallback(() => {
    if (!displayPayload) return
    const allRows = [...healthRows, ...insufficientRows]
    if (allRows.length === 0) return
    setExporting(true)
    try {
      const headers = [
        'Route',
        'Buildings',
        stDurationColumnLabel(displayPayload.range),
        fieldDurationColumnLabel(displayPayload.range),
        'Capacity band',
        preRouteGapColumnLabel(displayPayload.range),
        'Sprawl (km per building)',
        'Monitoring %',
        skippedColumnLabel(displayPayload.range),
        'Net %',
        'Run time data',
      ]
      const lines = [headers.map(escapeCsvField).join(',')]
      for (const row of allRows) {
        const source = row.source
        const sufficient = source.has_sufficient_run_time_data
        lines.push(
          [
            routeDisplayLabel(source.route),
            String(source.building_count),
            source.avg_hours != null ? source.avg_hours.toFixed(1) : '',
            source.field_avg_hours != null ? source.field_avg_hours.toFixed(1) : '',
            capacityBandLabel(row.capacityBand),
            source.pre_route_gap_minutes != null ? String(Math.round(source.pre_route_gap_minutes)) : '',
            row.kmPerBuilding != null ? row.kmPerBuilding.toFixed(2) : '',
            row.monitoringPct != null ? String(row.monitoringPct) : '',
            formatSkippedValue(source.skipped_non_annual),
            sufficient && source.monthly_net_pct != null
              ? (source.monthly_net_pct * 100).toFixed(2)
              : '',
            sufficient ? 'Sufficient' : INSUFFICIENT_RUN_TIME_LABEL,
          ]
            .map((v) => escapeCsvField(v))
            .join(','),
        )
      }
      const body = `\uFEFF${lines.join('\r\n')}`
      const blob = new Blob([body], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `monthly-route-health-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }, [displayPayload, healthRows, insufficientRows])

  const selectedRangeLabel =
    DASHBOARD_ROUTE_BREAKDOWN_RANGE_OPTIONS.find((option) => option.value === range)?.label ?? 'Selected range'

  if (isLoadingCurrentRange && !displayPayload && !error) {
    return (
      <section className="monthly-dashboard-breakdown monthly-route-health">
        <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
          <h2 className="h5 mb-0">Route health — {selectedRangeLabel}</h2>
        </div>
        <HealthRangeSelector value={range} onChange={onRangeChange} loadingRange={loadingRange} />
        <MonthlyDashboardRoutePerformanceSkeleton embedded />
      </section>
    )
  }

  if (error && !displayPayload) {
    return (
      <section className="monthly-dashboard-breakdown monthly-route-health">
        <HealthRangeSelector value={range} onChange={onRangeChange} loadingRange={loadingRange} />
        <HealthLoadErrorAlert
          message={error}
          onRetry={() => void load(range)}
          retrying={isLoadingCurrentRange}
        />
      </section>
    )
  }

  if (!displayPayload) {
    return <div className="text-muted mb-0">No route health data.</div>
  }

  const totalRows = healthRows.length + insufficientRows.length
  const periodDetail =
    displayPayload.period_start === displayPayload.period_end
      ? displayPayload.period_start
      : `${displayPayload.period_start} – ${displayPayload.period_end}`

  return (
    <section className="monthly-dashboard-breakdown monthly-route-health">
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
        <div className="d-flex flex-wrap align-items-center gap-2">
          <h2 className="h5 mb-0">Route health — {displayPayload.period_label}</h2>
          {insufficientRows.length > 0 ? (
            <Badge bg="warning" text="dark" className="monthly-dashboard-breakdown__count-badge tabular-nums">
              {insufficientRows.length} missing run time data
            </Badge>
          ) : null}
        </div>
        <Button
          variant="outline-secondary"
          size="sm"
          disabled={exporting || isLoadingCurrentRange || totalRows === 0}
          onClick={exportCsv}
        >
          Export CSV
        </Button>
      </div>
      <HealthRangeSelector
        value={range}
        onChange={onRangeChange}
        loadingRange={loadingRange}
        periodLabel={periodDetail}
      />
      {isLoadingCurrentRange && !displayPayload ? (
        <MonthlyDashboardRoutePerformanceSkeleton embedded />
      ) : (
        <>
          {error ? (
            <div className="mb-3">
              <HealthLoadErrorAlert message={error} onRetry={() => void load(range)} />
            </div>
          ) : null}
          {totalRows === 0 && !error ? (
            <p className="text-muted mb-0">No active routes to show.</p>
          ) : totalRows > 0 ? (
            <>
              {healthRows.length > 0 ? (
                <div className="mb-4">
                  <HealthTable
                    rows={healthRows}
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={onSort}
                    breakdownRange={displayPayload.range}
                  />
                </div>
              ) : null}

              {insufficientRows.length > 0 ? (
                <div className="monthly-dashboard-breakdown__insufficient-section">
                  <h3 className="h6 mb-2">
                    Insufficient run time data
                    <Badge bg="warning" text="dark" className="ms-2 tabular-nums">
                      {insufficientRows.length}
                    </Badge>
                  </h3>
                  <p className="text-muted small mb-3">
                    No ServiceTrade testing-job clock data in the selected window. Sprawl, monitoring,
                    and skip figures are still shown; duration and net % need run timing when ST data
                    is missing.
                  </p>
                  <HealthTable
                    rows={insufficientRows}
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={onSort}
                    breakdownRange={displayPayload.range}
                  />
                </div>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </section>
  )
}
