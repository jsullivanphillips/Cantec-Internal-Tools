import type {
  MonthlyRouteSpecialistMonthPayload,
  RouteRunMonthSummary,
  RouteTestingMonthCell,
} from './monthlyRoutesShared'
import { addCalendarMonths, parseYearMonth } from './monthlyRoutesShared'

export type RouteRunTableRow = {
  monthIso: string
  run: RouteRunMonthSummary
  specialistMonth: MonthlyRouteSpecialistMonthPayload | null
}

export type RunsCardRow = {
  monthIso: string
  run: RouteRunMonthSummary | null
  specialistMonth: MonthlyRouteSpecialistMonthPayload | null
  hasRunData: boolean
}

function compareMonthFirstIso(a: string, b: string): number {
  const ya = parseYearMonth(a)
  const yb = parseYearMonth(b)
  if (!ya || !yb) return a.localeCompare(b)
  if (ya.year !== yb.year) return ya.year - yb.year
  return ya.month - yb.month
}

function monthIsoForYearMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-01`
}

export function maxSelectableRunsMonthIso(currentMonthIso: string): string | null {
  return addCalendarMonths(currentMonthIso, 1)
}

export function availableRunsCardYears(
  currentMonthIso: string,
  runsByMonth: Record<string, RouteRunMonthSummary>,
  testingByMonth: Record<string, RouteTestingMonthCell>,
): number[] {
  const years = new Set<number>()
  const currentYear = parseYearMonth(currentMonthIso)?.year
  if (currentYear != null) years.add(currentYear)
  for (const key of [...Object.keys(runsByMonth), ...Object.keys(testingByMonth)]) {
    const ym = parseYearMonth(key)
    if (ym) years.add(ym.year)
  }
  return Array.from(years).sort((a, b) => a - b)
}

export function defaultRunsCardYear(years: number[], currentMonthIso: string): number | null {
  if (years.length === 0) return null
  const currentYear = parseYearMonth(currentMonthIso)?.year
  if (currentYear != null && years.includes(currentYear)) return currentYear
  return years[years.length - 1] ?? null
}

export function buildRunsCardRowsForYear(
  year: number,
  currentMonthIso: string,
  runsByMonth: Record<string, RouteRunMonthSummary>,
  specialistsByMonth: Record<string, MonthlyRouteSpecialistMonthPayload>,
): RunsCardRow[] {
  const maxMonthIso = maxSelectableRunsMonthIso(currentMonthIso)
  if (!maxMonthIso) return []

  const rows: RunsCardRow[] = []
  for (let month = 1; month <= 12; month += 1) {
    const monthIso = monthIsoForYearMonth(year, month)
    if (compareMonthFirstIso(monthIso, maxMonthIso) > 0) continue
    const run = runsByMonth[monthIso] ?? null
    rows.push({
      monthIso,
      run,
      specialistMonth: specialistsByMonth[monthIso] ?? null,
      hasRunData: run != null,
    })
  }
  return rows.sort((a, b) => b.monthIso.localeCompare(a.monthIso))
}

export function formatRunsCardStageLabel(row: RunsCardRow): string {
  if (!row.hasRunData || !row.run) return 'No data'
  return row.run.workflow_stage_label?.trim() || '—'
}

type ApiRunSummary = {
  id?: number
  run_id?: number
  source?: string
  status?: string
  opened_at?: string | null
  started_at?: string | null
  completed_at?: string | null
  workflow_stage?: string
  workflow_stage_label?: string
  stops_on_route_count?: number
  stops_tested_count?: number
}

/** Normalize run payloads from skip/import API responses for ``runs_by_month`` patches. */
export function routeRunSummaryFromApi(run: ApiRunSummary): RouteRunMonthSummary {
  return {
    run_id: Number(run.run_id ?? run.id),
    source: String(run.source ?? ''),
    status: String(run.status ?? ''),
    opened_at: run.opened_at ?? null,
    started_at: run.started_at ?? null,
    completed_at: run.completed_at ?? null,
    workflow_stage: run.workflow_stage,
    workflow_stage_label: run.workflow_stage_label,
    stops_on_route_count: run.stops_on_route_count,
    stops_tested_count: run.stops_tested_count,
  }
}

function formatPacificDateOnly(isoDate: string): string | null {
  const trimmed = isoDate.trim()
  if (!trimmed) return null
  const [y, m, d] = trimmed.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Intl.DateTimeFormat('en-CA', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)))
}

function formatTimestamp(iso: string): string | null {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return null
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(parsed)
}

/** Best available run date: ST route test date → field start → run closed. */
export function formatRunDisplayDate(
  run: RouteRunMonthSummary,
  specialistMonth: MonthlyRouteSpecialistMonthPayload | null | undefined,
): string {
  const testedOn = (specialistMonth?.route_tested_on || '').trim()
  if (testedOn) {
    const formatted = formatPacificDateOnly(testedOn)
    if (formatted) return formatted
  }
  if (run.started_at) {
    const formatted = formatTimestamp(run.started_at)
    if (formatted) return formatted
  }
  if (run.completed_at) {
    const formatted = formatTimestamp(run.completed_at)
    if (formatted) return formatted
  }
  return '—'
}

export function formatSitesTestedRatio(run: RouteRunMonthSummary): string {
  const total = run.stops_on_route_count
  const tested = run.stops_tested_count
  if (typeof total !== 'number' || total <= 0) return '—'
  const testedCount = typeof tested === 'number' && tested >= 0 ? tested : 0
  return `${testedCount}/${total}`
}

export function buildRouteRunTableRows(
  runsByMonth: Record<string, RouteRunMonthSummary>,
  specialistsByMonth: Record<string, MonthlyRouteSpecialistMonthPayload>,
): RouteRunTableRow[] {
  return Object.entries(runsByMonth)
    .map(([monthIso, run]) => ({
      monthIso,
      run,
      specialistMonth: specialistsByMonth[monthIso] ?? null,
    }))
    .sort((a, b) => b.monthIso.localeCompare(a.monthIso))
}
