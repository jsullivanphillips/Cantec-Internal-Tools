import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Alert, Badge, Button, OverlayTrigger, Table, Tooltip } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import {
  DASHBOARD_ROUTE_BREAKDOWN_RANGE_OPTIONS,
  DEFAULT_DASHBOARD_ROUTE_BREAKDOWN_RANGE,
  fetchDashboardRouteBreakdown,
  type DashboardRouteBreakdownMonthRevenue,
  type DashboardRouteBreakdownPayload,
  type DashboardRouteBreakdownRange,
  type DashboardRouteBreakdownRevenueColumn,
  type DashboardRouteBreakdownRow,
} from './monthlyDashboardShared'
import { formatCurrencyCad } from '../../lib/formatCurrencyCad'
import MonthlyDashboardRouteBreakdownSkeleton from './MonthlyDashboardRouteBreakdownSkeleton'
import {
  readRouteBreakdownCache,
  writeRouteBreakdownCache,
} from './routeBreakdownCache'

type BaseSortKey =
  | 'route'
  | 'building_count'
  | 'avg_hours'
  | 'tech_count'
  | 'monthly_expense'
  | 'avg_monthly_revenue'
  | 'monthly_net'
  | 'monthly_net_pct'

type SortKey = BaseSortKey | `month:${string}`

type SortDir = 'asc' | 'desc'

function monthSortKey(monthKey: string): SortKey {
  return `month:${monthKey}`
}

function isMonthSortKey(key: SortKey): key is `month:${string}` {
  return key.startsWith('month:')
}

function monthKeyFromSortKey(key: SortKey): string | null {
  return isMonthSortKey(key) ? key.slice('month:'.length) : null
}

function monthRevenueEntry(
  row: DashboardRouteBreakdownRow,
  monthKey: string,
): DashboardRouteBreakdownMonthRevenue | undefined {
  return row.monthly_revenues?.find((entry) => entry.month_key === monthKey)
}

function revenueForMonth(row: DashboardRouteBreakdownRow, monthKey: string): number {
  return monthRevenueEntry(row, monthKey)?.revenue ?? 0
}

function formatMonthRevenueLabel(status: DashboardRouteBreakdownMonthRevenue['revenue_status']): string {
  if (status === 'skipped') return 'Skipped'
  if (status === 'no_data') return 'No data'
  return ''
}

function formatMonthFirstIsoHeading(monthFirstIso: string): string {
  const match = /^(\d{4})-(\d{2})-01$/.exec(monthFirstIso.trim())
  if (!match) return monthFirstIso
  const year = Number(match[1])
  const month = Number(match[2])
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return monthFirstIso
  }
  return new Intl.DateTimeFormat('en-CA', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1)))
}

function formatAvgHoursPeriodDescription(
  periodStart: string,
  periodEnd: string,
  periodLabel: string,
): string {
  const startHeading = formatMonthFirstIsoHeading(periodStart)
  if (periodStart === periodEnd) {
    return `${startHeading} (${periodLabel})`
  }
  const endHeading = formatMonthFirstIsoHeading(periodEnd)
  return `${startHeading} – ${endHeading} (${periodLabel})`
}

function runHoursColumnLabel(range: DashboardRouteBreakdownRange): string {
  return range === 'last_month' ? 'Hours' : 'Avg hours'
}

const INSUFFICIENT_RUN_TIME_LABEL = 'Insufficient run time data'

/** Net % (0–1) mapped to red → yellow → green across this range. */
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

function routeBreakdownLabel(row: DashboardRouteBreakdownRow): string {
  const route = row.route
  const displayName = (route?.display_name || '').trim()
  const base = (route?.label || '').trim() || `R${route?.route_number ?? '?'}`
  return displayName ? `${base} — ${displayName}` : base
}

function routePrimaryLabel(row: DashboardRouteBreakdownRow): string {
  const route = row.route
  return (route?.label || '').trim() || `R${route?.route_number ?? '?'}`
}

function routeDisplayName(row: DashboardRouteBreakdownRow): string | null {
  const name = (row.route?.display_name || '').trim()
  return name || null
}

function hasRunTimeData(row: DashboardRouteBreakdownRow): boolean {
  return row.has_sufficient_run_time_data ?? row.avg_hours_months_sampled > 0
}

function formatNetPct(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return '—'
  return `${(pct * 100).toFixed(2)}%`
}

function formatHours(hours: number | null | undefined): string {
  if (hours == null || !Number.isFinite(hours)) return '—'
  return hours.toFixed(1)
}

function AvgHoursCell({ row }: { row: DashboardRouteBreakdownRow }) {
  const hours = row.avg_hours
  if (hours == null || !Number.isFinite(hours)) {
    return <span>—</span>
  }

  if (row.avg_hours_capped_for_billing && row.avg_hours_billed != null) {
    return (
      <OverlayTrigger
        placement="top"
        trigger={['hover', 'focus']}
        overlay={
          <Tooltip id={`avg-hours-${row.route.id}`}>
            Median run time: {hours.toFixed(1)} hrs
          </Tooltip>
        }
      >
        <span className="monthly-dashboard-breakdown__avg-hours-capped" tabIndex={0}>
          ~{row.avg_hours_billed.toFixed(0)}
        </span>
      </OverlayTrigger>
    )
  }

  return <span>{formatHours(hours)}</span>
}

function compareRows(a: DashboardRouteBreakdownRow, b: DashboardRouteBreakdownRow, key: SortKey): number {
  const monthKey = monthKeyFromSortKey(key)
  if (monthKey) {
    return revenueForMonth(a, monthKey) - revenueForMonth(b, monthKey)
  }
  switch (key) {
    case 'route':
      return (a.route.route_number ?? 0) - (b.route.route_number ?? 0)
    case 'building_count':
      return a.building_count - b.building_count
    case 'avg_hours':
      return (a.avg_hours ?? -1) - (b.avg_hours ?? -1)
    case 'tech_count':
      return a.tech_count - b.tech_count
    case 'monthly_expense':
      return a.monthly_expense - b.monthly_expense
    case 'avg_monthly_revenue':
      return a.avg_monthly_revenue - b.avg_monthly_revenue
    case 'monthly_net':
      return (a.monthly_net ?? Number.NEGATIVE_INFINITY) - (b.monthly_net ?? Number.NEGATIVE_INFINITY)
    case 'monthly_net_pct':
      return (a.monthly_net_pct ?? -1) - (b.monthly_net_pct ?? -1)
    default:
      return 0
  }
}

function sortRows(
  rows: DashboardRouteBreakdownRow[],
  sortKey: SortKey,
  sortDir: SortDir,
): DashboardRouteBreakdownRow[] {
  const copy = [...rows]
  copy.sort((a, b) => {
    const cmp = compareRows(a, b, sortKey)
    return sortDir === 'asc' ? cmp : -cmp
  })
  return copy
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

function SortableHeader({
  label,
  sortKey,
  activeKey,
  sortDir,
  onSort,
  className,
  compact,
  infoTooltip,
  infoLabel,
}: {
  label: string
  sortKey: SortKey
  activeKey: SortKey
  sortDir: SortDir
  onSort: (key: SortKey) => void
  className?: string
  compact?: boolean
  infoTooltip?: ReactNode
  infoLabel?: string
}) {
  const active = activeKey === sortKey
  const tooltipId = `breakdown-header-${sortKey}`
  return (
    <th className={className}>
      <button
        type="button"
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

function MonthRevenueHeader({
  column,
  sortKey,
  activeKey,
  sortDir,
  onSort,
  singleLine,
}: {
  column: DashboardRouteBreakdownRevenueColumn
  sortKey: SortKey
  activeKey: SortKey
  sortDir: SortDir
  onSort: (key: SortKey) => void
  singleLine: boolean
}) {
  const active = activeKey === sortKey
  const monthLabel = column.header.replace(/ REVENUE$/, '')

  if (singleLine) {
    return (
      <th className="text-end monthly-dashboard-breakdown__col-month-revenue monthly-dashboard-breakdown__col-month-revenue--single-line">
        <button
          type="button"
          className={`monthly-dashboard-breakdown__sort monthly-dashboard-breakdown__sort--compact${active ? ' monthly-dashboard-breakdown__sort--active' : ''}`}
          onClick={() => onSort(sortKey)}
          aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
        >
          <span className="monthly-dashboard-breakdown__month-header-inline">{column.header}</span>
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

  return (
    <th className="text-end monthly-dashboard-breakdown__col-month-revenue">
      <button
        type="button"
        className={`monthly-dashboard-breakdown__sort monthly-dashboard-breakdown__sort--compact monthly-dashboard-breakdown__sort--stacked${active ? ' monthly-dashboard-breakdown__sort--active' : ''}`}
        onClick={() => onSort(sortKey)}
        aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        <span className="monthly-dashboard-breakdown__month-header">
          <span className="monthly-dashboard-breakdown__month-header-month">{monthLabel}</span>
          <span className="monthly-dashboard-breakdown__month-header-revenue">REVENUE</span>
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

function BreakdownTableHeader({
  sortKey,
  sortDir,
  onSort,
  revenueColumns,
  showAvgMonthlyRevenue,
  costConstants,
  avgHoursPeriodDescription,
  breakdownRange,
}: {
  sortKey: SortKey
  sortDir: SortDir
  onSort: (key: SortKey) => void
  revenueColumns: DashboardRouteBreakdownRevenueColumn[]
  showAvgMonthlyRevenue: boolean
  costConstants: DashboardRouteBreakdownPayload['cost_constants']
  avgHoursPeriodDescription: string
  breakdownRange: DashboardRouteBreakdownRange
}) {
  const labour = costConstants.labour_rate_per_hour
  const truck = costConstants.truck_charge_per_month
  const singleLineMonthRevenueHeader = revenueColumns.length <= 3
  const hoursColumnLabel = runHoursColumnLabel(breakdownRange)

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
          className="text-end monthly-dashboard-breakdown__col-compact monthly-dashboard-breakdown__col-buildings"
          compact
        />
        <SortableHeader
          label={hoursColumnLabel}
          sortKey="avg_hours"
          activeKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
          className="text-end monthly-dashboard-breakdown__col-compact monthly-dashboard-breakdown__col-hours"
          compact
          infoTooltip={
            <>
              Typical time your techs spend on this route, based on clock-in and clock-out times
              from ServiceTrade. Uses the middle value across months with synced run timing in{' '}
              {avgHoursPeriodDescription}. For costing, routes a little under 8 hours are counted
              as 8 (~8 in the table); 8 hours or more uses the actual time.
            </>
          }
          infoLabel={breakdownRange === 'last_month' ? 'About hours' : 'About avg hours'}
        />
        <SortableHeader
          label="Techs"
          sortKey="tech_count"
          activeKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
          className="text-end monthly-dashboard-breakdown__col-compact monthly-dashboard-breakdown__col-techs"
          compact
        />
        <SortableHeader
          label="Monthly expense"
          sortKey="monthly_expense"
          activeKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
          className="text-end monthly-dashboard-breakdown__col-money"
          infoTooltip={
            <>
              Labour ({formatCurrencyCad(labour)}/hr × techs × avg hours) + truck{' '}
              {formatCurrencyCad(truck)}/mo. Office-skipped route-months in the window show{' '}
              {formatCurrencyCad(0)}.
            </>
          }
          infoLabel="How monthly expense is calculated"
        />
        {revenueColumns.map((column) => (
          <MonthRevenueHeader
            key={column.month_key}
            column={column}
            sortKey={monthSortKey(column.month_key)}
            activeKey={sortKey}
            sortDir={sortDir}
            onSort={onSort}
            singleLine={singleLineMonthRevenueHeader}
          />
        ))}
        {showAvgMonthlyRevenue ? (
          <SortableHeader
            label="Avg monthly revenue"
            sortKey="avg_monthly_revenue"
            activeKey={sortKey}
            sortDir={sortDir}
            onSort={onSort}
            className="text-end monthly-dashboard-breakdown__col-money"
          />
        ) : null}
        <SortableHeader
          label="Monthly net"
          sortKey="monthly_net"
          activeKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
          className="text-end monthly-dashboard-breakdown__col-money"
        />
        <SortableHeader
          label="Net %"
          sortKey="monthly_net_pct"
          activeKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
          className="text-end monthly-dashboard-breakdown__col-net"
          infoTooltip={
            <>Monthly net divided by avg monthly revenue, shown when revenue is greater than zero.</>
          }
          infoLabel="How net percent is calculated"
        />
      </tr>
    </thead>
  )
}

function NetPctCell({ row }: { row: DashboardRouteBreakdownRow }) {
  const pct = row.monthly_net_pct
  if (!hasRunTimeData(row) || pct == null || !Number.isFinite(pct)) {
    return <span className="text-muted">{formatNetPct(pct)}</span>
  }
  return (
    <span className="monthly-dashboard-breakdown__pill" style={netPctGradientStyle(pct)}>
      {formatNetPct(pct)}
    </span>
  )
}

function RouteNameCell({ row }: { row: DashboardRouteBreakdownRow }) {
  const displayName = routeDisplayName(row)
  const sufficient = hasRunTimeData(row)

  return (
    <td className="monthly-dashboard-breakdown__route-cell">
      <Link to={`/monthlies/routes/${row.route.id}`} className="monthly-dashboard-breakdown__route-link">
        <span className="monthly-dashboard-breakdown__route-primary">{routePrimaryLabel(row)}</span>
        {displayName ? (
          <span className="monthly-dashboard-breakdown__route-secondary">{displayName}</span>
        ) : null}
      </Link>
      {!sufficient ? (
        <Badge bg="warning" text="dark" className="monthly-dashboard-breakdown__insufficient-badge">
          {INSUFFICIENT_RUN_TIME_LABEL}
        </Badge>
      ) : null}
    </td>
  )
}

function MonthRevenueCell({ entry }: { entry: DashboardRouteBreakdownMonthRevenue | undefined }) {
  if (!entry) {
    return <span className="text-muted monthly-dashboard-breakdown__revenue-status">No data</span>
  }
  if (entry.revenue_status) {
    return (
      <span className="text-muted monthly-dashboard-breakdown__revenue-status">
        {formatMonthRevenueLabel(entry.revenue_status)}
      </span>
    )
  }
  return <>{formatCurrencyCad(entry.revenue)}</>
}

function BreakdownRow({
  row,
  revenueColumns,
  showAvgMonthlyRevenue,
}: {
  row: DashboardRouteBreakdownRow
  revenueColumns: DashboardRouteBreakdownRevenueColumn[]
  showAvgMonthlyRevenue: boolean
}) {
  const sufficient = hasRunTimeData(row)

  return (
    <tr className={sufficient ? undefined : 'monthly-dashboard-breakdown__row--insufficient'}>
      <RouteNameCell row={row} />
      <td className="text-end tabular-nums monthly-dashboard-breakdown__col-compact monthly-dashboard-breakdown__col-buildings">
        {row.building_count}
      </td>
      <td className="text-end tabular-nums monthly-dashboard-breakdown__col-compact monthly-dashboard-breakdown__col-hours">
        <AvgHoursCell row={row} />
      </td>
      <td className="text-end tabular-nums monthly-dashboard-breakdown__col-compact monthly-dashboard-breakdown__col-techs">
        {row.tech_count}
      </td>
      <td className="text-end tabular-nums monthly-dashboard-breakdown__col-money">
        {formatCurrencyCad(row.monthly_expense)}
      </td>
      {revenueColumns.map((column) => (
        <td
          key={column.month_key}
          className="text-end tabular-nums monthly-dashboard-breakdown__col-month-revenue"
        >
          <MonthRevenueCell entry={monthRevenueEntry(row, column.month_key)} />
        </td>
      ))}
      {showAvgMonthlyRevenue ? (
        <td className="text-end tabular-nums monthly-dashboard-breakdown__col-money">
          {formatCurrencyCad(row.avg_monthly_revenue)}
        </td>
      ) : null}
      <td className="text-end tabular-nums monthly-dashboard-breakdown__col-money">
        {formatCurrencyCad(row.monthly_net)}
      </td>
      <td className="text-end tabular-nums monthly-dashboard-breakdown__col-net">
        <NetPctCell row={row} />
      </td>
    </tr>
  )
}

function BreakdownTable({
  rows,
  sortKey,
  sortDir,
  onSort,
  revenueColumns,
  showAvgMonthlyRevenue,
  costConstants,
  avgHoursPeriodDescription,
  breakdownRange,
}: {
  rows: DashboardRouteBreakdownRow[]
  sortKey: SortKey
  sortDir: SortDir
  onSort: (key: SortKey) => void
  revenueColumns: DashboardRouteBreakdownRevenueColumn[]
  showAvgMonthlyRevenue: boolean
  costConstants: DashboardRouteBreakdownPayload['cost_constants']
  avgHoursPeriodDescription: string
  breakdownRange: DashboardRouteBreakdownRange
}) {
  return (
    <div className="monthly-dashboard-breakdown__card">
      <div className="table-responsive">
        <Table size="sm" className="mb-0 align-middle monthly-dashboard-breakdown__table">
          <BreakdownTableHeader
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={onSort}
            revenueColumns={revenueColumns}
            showAvgMonthlyRevenue={showAvgMonthlyRevenue}
            costConstants={costConstants}
            avgHoursPeriodDescription={avgHoursPeriodDescription}
            breakdownRange={breakdownRange}
          />
          <tbody>
            {rows.map((row) => (
              <BreakdownRow
                key={row.route.id}
                row={row}
                revenueColumns={revenueColumns}
                showAvgMonthlyRevenue={showAvgMonthlyRevenue}
              />
            ))}
          </tbody>
        </Table>
      </div>
    </div>
  )
}

function BreakdownLoadErrorAlert({
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
            Couldn&apos;t load route breakdown
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

function BreakdownRangeSelector({
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
    <div className="monthly-dashboard-breakdown__range-toolbar" aria-label="Breakdown date range">
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

export default function MonthlyDashboardRouteBreakdown() {
  const [payload, setPayload] = useState<DashboardRouteBreakdownPayload | null>(null)
  const [loadingRange, setLoadingRange] = useState<DashboardRouteBreakdownRange | null>(
    DEFAULT_DASHBOARD_ROUTE_BREAKDOWN_RANGE,
  )
  const [error, setError] = useState<string | null>(null)
  const [range, setRange] = useState<DashboardRouteBreakdownRange>(
    DEFAULT_DASHBOARD_ROUTE_BREAKDOWN_RANGE,
  )
  const [sortKey, setSortKey] = useState<SortKey>('route')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [exporting, setExporting] = useState(false)
  const loadRequestRef = useRef(0)

  const load = useCallback(async (selectedRange: DashboardRouteBreakdownRange) => {
    const requestId = ++loadRequestRef.current
    setLoadingRange(selectedRange)
    setError(null)

    const cached = readRouteBreakdownCache(selectedRange)
    if (cached && requestId === loadRequestRef.current) {
      setPayload(cached)
    }

    try {
      const data = await fetchDashboardRouteBreakdown(selectedRange)
      if (requestId !== loadRequestRef.current) return
      setPayload(data)
      setError(null)
      writeRouteBreakdownCache(selectedRange, data)
    } catch (err) {
      if (requestId !== loadRequestRef.current) return
      if (err instanceof Error && (err.message === 'redirect' || err.message === 'auth')) {
        return
      }
      if (!cached) {
        setError(err instanceof Error ? err.message : 'Unable to load route breakdown. Try again.')
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
    (key: SortKey) => {
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

  const { rowsWithRunTime, rowsInsufficientRunTime } = useMemo(() => {
    if (!displayPayload?.rows?.length) {
      return { rowsWithRunTime: [], rowsInsufficientRunTime: [] }
    }
    const withData: DashboardRouteBreakdownRow[] = []
    const insufficient: DashboardRouteBreakdownRow[] = []
    for (const row of displayPayload.rows) {
      if (hasRunTimeData(row)) {
        withData.push(row)
      } else {
        insufficient.push(row)
      }
    }
    return {
      rowsWithRunTime: sortRows(withData, sortKey, sortDir),
      rowsInsufficientRunTime: sortRows(insufficient, sortKey, sortDir),
    }
  }, [displayPayload, sortKey, sortDir])

  const exportCsv = useCallback(() => {
    if (!displayPayload) return
    const allRows = [...rowsWithRunTime, ...rowsInsufficientRunTime]
    if (allRows.length === 0) return
    setExporting(true)
    try {
      const headers = [
        'Route',
        'Buildings',
        runHoursColumnLabel(displayPayload.range),
        'Techs',
        'Monthly expense',
        ...displayPayload.revenue_columns.map((column) => column.header),
        ...(displayPayload.show_avg_monthly_revenue ? ['Avg monthly revenue'] : []),
        'Monthly net',
        'Net %',
        'Run time data',
      ]
      const lines = [headers.map(escapeCsvField).join(',')]
      for (const row of allRows) {
        const sufficient = hasRunTimeData(row)
        lines.push(
          [
            routeBreakdownLabel(row),
            String(row.building_count),
            sufficient && row.avg_hours != null
              ? row.avg_hours_capped_for_billing && row.avg_hours_billed != null
                ? `~${row.avg_hours_billed.toFixed(0)} (${row.avg_hours.toFixed(1)} actual)`
                : row.avg_hours.toFixed(1)
              : '',
            String(row.tech_count),
            row.monthly_expense.toFixed(2),
            ...displayPayload.revenue_columns.map((column) => {
              const entry = monthRevenueEntry(row, column.month_key)
              if (entry?.revenue_status) {
                return formatMonthRevenueLabel(entry.revenue_status)
              }
              return revenueForMonth(row, column.month_key).toFixed(2)
            }),
            ...(displayPayload.show_avg_monthly_revenue ? [row.avg_monthly_revenue.toFixed(2)] : []),
            row.monthly_net != null ? row.monthly_net.toFixed(2) : '—',
            sufficient && row.monthly_net_pct != null
              ? (row.monthly_net_pct * 100).toFixed(2)
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
      a.download = `monthly-route-breakdown-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }, [displayPayload, rowsWithRunTime, rowsInsufficientRunTime])

  const selectedRangeLabel =
    DASHBOARD_ROUTE_BREAKDOWN_RANGE_OPTIONS.find((option) => option.value === range)?.label ?? 'Selected range'

  if (isLoadingCurrentRange && !displayPayload && !error) {
    return (
      <section className="monthly-dashboard-breakdown mt-4">
        <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
          <h2 className="h5 mb-0">Route breakdown — {selectedRangeLabel}</h2>
        </div>
        <BreakdownRangeSelector value={range} onChange={onRangeChange} loadingRange={loadingRange} />
        <MonthlyDashboardRouteBreakdownSkeleton embedded />
      </section>
    )
  }

  if (error && !displayPayload) {
    return (
      <section className="monthly-dashboard-breakdown mt-4">
        <BreakdownRangeSelector value={range} onChange={onRangeChange} loadingRange={loadingRange} />
        <BreakdownLoadErrorAlert
          message={error}
          onRetry={() => void load(range)}
          retrying={isLoadingCurrentRange}
        />
      </section>
    )
  }

  if (!displayPayload) {
    return <div className="text-muted mb-0">No route breakdown data.</div>
  }

  const totalRows = rowsWithRunTime.length + rowsInsufficientRunTime.length
  const periodDetail =
    displayPayload.period_start === displayPayload.period_end
      ? displayPayload.period_start
      : `${displayPayload.period_start} – ${displayPayload.period_end}`
  const avgHoursPeriodDescription = formatAvgHoursPeriodDescription(
    displayPayload.period_start,
    displayPayload.period_end,
    displayPayload.period_label,
  )

  return (
    <section className="monthly-dashboard-breakdown mt-4">
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
        <div className="d-flex flex-wrap align-items-center gap-2">
          <h2 className="h5 mb-0">Route breakdown — {displayPayload.period_label}</h2>
          {rowsWithRunTime.length > 0 ? (
            <Badge bg="secondary" className="monthly-dashboard-breakdown__count-badge tabular-nums">
              {rowsWithRunTime.length} with run time data
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
      <BreakdownRangeSelector
        value={range}
        onChange={onRangeChange}
        loadingRange={loadingRange}
        periodLabel={periodDetail}
      />
      {isLoadingCurrentRange && !displayPayload ? (
        <MonthlyDashboardRouteBreakdownSkeleton embedded />
      ) : (
        <>
          {error ? (
            <div className="mb-3">
              <BreakdownLoadErrorAlert message={error} onRetry={() => void load(range)} />
            </div>
          ) : null}
          {totalRows === 0 && !error ? (
            <p className="text-muted mb-0">No active routes to show.</p>
          ) : totalRows > 0 ? (
            <>
              {rowsWithRunTime.length > 0 ? (
                <div className="mb-4">
                  <BreakdownTable
                    rows={rowsWithRunTime}
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={onSort}
                    revenueColumns={displayPayload.revenue_columns}
                    showAvgMonthlyRevenue={displayPayload.show_avg_monthly_revenue}
                    costConstants={displayPayload.cost_constants}
                    avgHoursPeriodDescription={avgHoursPeriodDescription}
                    breakdownRange={displayPayload.range}
                  />
                </div>
              ) : null}

              {rowsInsufficientRunTime.length > 0 ? (
                <div className="monthly-dashboard-breakdown__insufficient-section">
                  <h3 className="h6 mb-2">
                    Insufficient run time data
                    <Badge bg="warning" text="dark" className="ms-2 tabular-nums">
                      {rowsInsufficientRunTime.length}
                    </Badge>
                  </h3>
                  <p className="text-muted small mb-3">
                    No ServiceTrade testing-job clock data in the selected window (missing ST route
                    link, no testing job scheduled in month, or no onsite clock pairs). Figures below
                    are shown for reference only.
                  </p>
                  <BreakdownTable
                    rows={rowsInsufficientRunTime}
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={onSort}
                    revenueColumns={displayPayload.revenue_columns}
                    showAvgMonthlyRevenue={displayPayload.show_avg_monthly_revenue}
                    costConstants={displayPayload.cost_constants}
                    avgHoursPeriodDescription={avgHoursPeriodDescription}
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
