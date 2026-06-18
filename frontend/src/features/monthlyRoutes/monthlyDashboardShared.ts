import type { MonthlyRouteSummary } from './monthlyRoutesShared'
import { effectiveRouteTestDayIso } from './monthlyRoutesShared'
import type { RunWorkflowStage } from './runWorkflowShared'
import { apiFetch, apiJson, formatApiErrorMessage, readApiErrorBody } from '../../lib/apiClient'

export type MonthlyDashboardIssueLocation = {
  id: number
  label: string
  address: string
  display_address?: string | null
  property_management_company: string | null
  test_day: string | null
  monthly_route_id?: number | null
  monthly_route?: MonthlyRouteSummary | null
  status_normalized: string
  price_per_month: number | null
  service_trade_site_location_id?: number | null
}

export type MonthlyDashboardIssueType =
  | 'missing_service_trade_link'
  | 'missing_price'
  | 'missing_key_link'
  | 'missing_map_pin'

export type MonthlyDashboardIssuesPayload = {
  missing_service_trade_link: MonthlyDashboardIssueLocation[]
  missing_price: MonthlyDashboardIssueLocation[]
  missing_key_link: MonthlyDashboardIssueLocation[]
  missing_map_pin: MonthlyDashboardIssueLocation[]
  counts: {
    missing_service_trade_link: number
    missing_price: number
    missing_key_link: number
    missing_map_pin: number
  }
}

export async function fetchDashboardIssues(): Promise<MonthlyDashboardIssuesPayload> {
  return apiJson<MonthlyDashboardIssuesPayload>('/api/monthly_routes/dashboard/issues')
}

export type DashboardRouteBreakdownCostConstants = {
  labour_rate_per_hour: number
  truck_charge_per_month: number
  default_tech_count: number
}

export type DashboardRouteBreakdownRevenueColumn = {
  month_key: string
  header: string
}

export type DashboardRouteBreakdownMonthRevenueStatus = 'no_data' | 'skipped'

export type DashboardRouteBreakdownMonthRevenue = {
  month_key: string
  revenue: number
  revenue_status?: DashboardRouteBreakdownMonthRevenueStatus
}

export type DashboardRouteBreakdownRow = {
  route: MonthlyRouteSummary
  building_count: number
  avg_hours: number | null
  avg_hours_billed: number | null
  avg_hours_capped_for_billing: boolean
  avg_hours_months_sampled: number
  has_sufficient_run_time_data: boolean
  tech_count: number
  monthly_expense: number
  monthly_revenues: DashboardRouteBreakdownMonthRevenue[]
  avg_monthly_revenue: number
  total_revenue: number
  revenue_months_sampled: number
  monthly_net: number | null
  monthly_net_pct: number | null
}

export type DashboardRouteBreakdownRange =
  | 'last_month'
  | 'last_quarter'
  | 'ytd'
  | 'last_12_months'

export type DashboardRouteBreakdownPayload = {
  range: DashboardRouteBreakdownRange
  period_label: string
  trailing_months: number
  period_start: string
  period_end: string
  revenue_columns: DashboardRouteBreakdownRevenueColumn[]
  show_avg_monthly_revenue: boolean
  show_total_revenue: boolean
  cost_constants: DashboardRouteBreakdownCostConstants
  rows: DashboardRouteBreakdownRow[]
}

export const DEFAULT_DASHBOARD_ROUTE_BREAKDOWN_RANGE: DashboardRouteBreakdownRange = 'last_month'

export const DASHBOARD_ROUTE_BREAKDOWN_RANGE_OPTIONS: {
  value: DashboardRouteBreakdownRange
  label: string
  hint?: string
}[] = [
  { value: 'last_month', label: 'Last month' },
  { value: 'last_quarter', label: 'Last quarter', hint: 'Jan–Mar, Apr–Jun, Jul–Sep, Oct–Dec' },
  { value: 'ytd', label: 'Year to date' },
  { value: 'last_12_months', label: 'Last 12 months' },
]

export async function fetchDashboardRouteBreakdown(
  range: DashboardRouteBreakdownRange = DEFAULT_DASHBOARD_ROUTE_BREAKDOWN_RANGE,
): Promise<DashboardRouteBreakdownPayload> {
  const path = `/api/monthly_routes/dashboard/route_breakdown?range=${encodeURIComponent(range)}`
  const res = await apiFetch(path)
  if (!res.ok) {
    const body = await readApiErrorBody(res)
    throw new Error(
      formatApiErrorMessage(
        res.status,
        body,
        'Unable to load route breakdown. Try again.',
      ),
    )
  }
  const text = await res.text()
  if (!text.trim()) {
    throw new Error('Route breakdown returned no data.')
  }
  return JSON.parse(text) as DashboardRouteBreakdownPayload
}

export type DashboardRoutePerformanceRow = {
  route: MonthlyRouteSummary
  building_count: number
  distance_meters: number | null
  duration_seconds: number | null
  /** ServiceTrade job clock-in to clock-out (median across range). */
  avg_hours: number | null
  avg_hours_months_sampled: number
  /** First stop time-in to route end (median across range). */
  field_avg_hours: number | null
  field_avg_hours_months_sampled: number
  /** Median minutes from ST job clock-in to first stop time-in. */
  pre_route_gap_minutes: number | null
  pre_route_gap_months_sampled: number
  skipped_non_annual: number | null
  skipped_months_sampled: number
  monitoring_site_count: number
  tech_count: number
  monthly_net_pct: number | null
  has_sufficient_run_time_data: boolean
}

export type DashboardRoutePerformancePayload = {
  range: DashboardRouteBreakdownRange
  period_label: string
  trailing_months: number
  period_start: string
  period_end: string
  rows: DashboardRoutePerformanceRow[]
}

export async function fetchDashboardRoutePerformance(
  range: DashboardRouteBreakdownRange = DEFAULT_DASHBOARD_ROUTE_BREAKDOWN_RANGE,
): Promise<DashboardRoutePerformancePayload> {
  const path = `/api/monthly_routes/dashboard/route_performance?range=${encodeURIComponent(range)}`
  const res = await apiFetch(path)
  if (!res.ok) {
    const body = await readApiErrorBody(res)
    throw new Error(
      formatApiErrorMessage(
        res.status,
        body,
        'Unable to load route performance. Try again.',
      ),
    )
  }
  const text = await res.text()
  if (!text.trim()) {
    throw new Error('Route performance returned no data.')
  }
  return JSON.parse(text) as DashboardRoutePerformancePayload
}

export type DashboardLocationMetricsRow = {
  location_id: number
  label: string
  address: string | null
  price_per_month: number | null
  route: MonthlyRouteSummary | null
  avg_visit_minutes: number | null
  price_per_hour: number | null
  visits_sampled: number
}

export type DashboardLocationPriceRow = {
  location_id: number
  label: string
  address: string | null
  price_per_month: number | null
  route: MonthlyRouteSummary | null
}

export type DashboardLocationMetricsPayload = {
  range: DashboardRouteBreakdownRange
  period_label: string
  trailing_months: number
  period_start: string
  period_end: string
  top_performers: DashboardLocationMetricsRow[]
  lowest_performers: DashboardLocationMetricsRow[]
  lowest_monthly_price_locations: DashboardLocationPriceRow[]
  eligible_location_count: number
  priced_location_count: number
}

export async function fetchDashboardLocationMetrics(
  range: DashboardRouteBreakdownRange = DEFAULT_DASHBOARD_ROUTE_BREAKDOWN_RANGE,
): Promise<DashboardLocationMetricsPayload> {
  const path = `/api/monthly_routes/dashboard/location_metrics?range=${encodeURIComponent(range)}`
  const res = await apiFetch(path)
  if (!res.ok) {
    const body = await readApiErrorBody(res)
    throw new Error(
      formatApiErrorMessage(
        res.status,
        body,
        'Unable to load location metrics. Try again.',
      ),
    )
  }
  const text = await res.text()
  if (!text.trim()) {
    throw new Error('Location metrics returned no data.')
  }
  return JSON.parse(text) as DashboardLocationMetricsPayload
}

export type RouteOverviewCardTone =
  | 'completed-light'
  | 'reviewed-closed'
  | 'skipped'
  | 'prepared'
  | 'field_active'
  | 'neutral'

export type MonthlyDashboardCurrentMonthRun = {
  run_id: number
  workflow_stage: string
  workflow_stage_label?: string
}

export type ServiceTradeJobDot = {
  color: 'green' | 'green_light' | 'blue_light' | 'grey' | 'red'
  tooltip: string
}

export type StScheduleMismatch = {
  route_date: string
  appointment_date: string
}

export type MonthlyDashboardRouteRow = {
  route: MonthlyRouteSummary
  current_month_run?: MonthlyDashboardCurrentMonthRun | null
  service_trade_job_dot: ServiceTradeJobDot
  st_schedule_mismatch?: StScheduleMismatch | null
}

export type MonthlyDashboardPayload = {
  month_date: string
  routes: MonthlyDashboardRouteRow[]
  open_ticket_count?: number
  open_tickets_open?: number
  open_tickets_in_progress?: number
}

export function dashboardRouteWorkflowStage(
  row: MonthlyDashboardRouteRow,
): RunWorkflowStage | 'skipped' {
  const stage = (row.current_month_run?.workflow_stage ?? 'draft').trim()
  if (stage === 'skipped') return 'skipped'
  if (
    stage === 'draft' ||
    stage === 'prepared' ||
    stage === 'field_in_progress' ||
    stage === 'awaiting_office_review' ||
    stage === 'ready_to_close' ||
    stage === 'completed'
  ) {
    return stage
  }
  return 'draft'
}

export function routeOverviewCardToneFromStage(
  stage: string | null | undefined,
): RouteOverviewCardTone {
  const normalized = (stage ?? 'draft').trim()
  if (normalized === 'completed') return 'reviewed-closed'
  if (normalized === 'skipped') return 'skipped'
  if (normalized === 'awaiting_office_review' || normalized === 'ready_to_close') {
    return 'completed-light'
  }
  if (normalized === 'prepared') return 'prepared'
  if (normalized === 'field_in_progress') return 'field_active'
  return 'neutral'
}

export function buildRouteOverviewCardToneMap(
  rows: MonthlyDashboardRouteRow[],
): Map<number, RouteOverviewCardTone> {
  const map = new Map<number, RouteOverviewCardTone>()
  for (const row of rows) {
    map.set(
      row.route.id,
      routeOverviewCardToneFromStage(dashboardRouteWorkflowStage(row)),
    )
  }
  return map
}

export function runAwaitingOfficePaperworkReview(
  run: { workflow_stage?: string } | null | undefined,
): boolean {
  return (run?.workflow_stage ?? '').trim() === 'awaiting_office_review'
}

export function countRoutesToProcess(rows: MonthlyDashboardRouteRow[]): number {
  return rows.filter((row) => runAwaitingOfficePaperworkReview(row.current_month_run)).length
}

export function routeScheduledInMonth(
  row: MonthlyDashboardRouteRow,
  monthFirstIso: string,
): boolean {
  const effectiveIso = effectiveRouteTestDayIso(monthFirstIso, row.route)
  if (!effectiveIso) return false
  return effectiveIso.startsWith(monthFirstIso.slice(0, 7))
}

export function countRoutesToPrepare(
  rows: MonthlyDashboardRouteRow[],
  monthFirstIso: string,
): number {
  return rows.filter(
    (row) =>
      routeScheduledInMonth(row, monthFirstIso) &&
      dashboardRouteWorkflowStage(row) === 'draft',
  ).length
}
