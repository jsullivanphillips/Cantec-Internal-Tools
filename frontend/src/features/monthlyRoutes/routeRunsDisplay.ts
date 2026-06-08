import type {
  MonthlyRouteSpecialistMonthPayload,
  RouteRunMonthSummary,
} from './monthlyRoutesShared'

export type RouteRunTableRow = {
  monthIso: string
  run: RouteRunMonthSummary
  specialistMonth: MonthlyRouteSpecialistMonthPayload | null
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
