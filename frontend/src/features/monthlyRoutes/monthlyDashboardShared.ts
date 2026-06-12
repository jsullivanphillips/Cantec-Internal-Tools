import type { MonthlyRouteSummary } from './monthlyRoutesShared'
import { effectiveRouteTestDayIso } from './monthlyRoutesShared'
import type { RunWorkflowStage } from './runWorkflowShared'

export type RouteOverviewCardTone =
  | 'completed-light'
  | 'reviewed-closed'
  | 'prepared'
  | 'field_active'
  | 'neutral'

export type MonthlyDashboardCurrentMonthRun = {
  run_id: number
  workflow_stage: string
  workflow_stage_label?: string
}

export type MonthlyDashboardRouteRow = {
  route: MonthlyRouteSummary
  current_month_run?: MonthlyDashboardCurrentMonthRun | null
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
  if (normalized === 'completed' || normalized === 'skipped') return 'reviewed-closed'
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
