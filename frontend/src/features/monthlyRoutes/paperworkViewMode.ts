import {
  addCalendarMonths,
  parseYearMonth,
  type RouteRunMonthSummary,
  worksheetRunExplicitlyCompleted,
  type TechnicianWorksheetRun,
} from './monthlyRoutesShared'
import { runInOfficePrepPhase } from './runWorkflowShared'

export type PaperworkViewMode = 'preparation' | 'exact_history' | 'run_review'

export const PAPERWORK_VIEW_LABELS: Record<PaperworkViewMode, string> = {
  preparation: 'Run preparation',
  exact_history: 'Exact history',
  run_review: 'Run review',
}

function compareMonthFirstIso(a: string, b: string): number {
  const ya = parseYearMonth(a)
  const yb = parseYearMonth(b)
  if (!ya || !yb) return a.localeCompare(b)
  if (ya.year !== yb.year) return ya.year - yb.year
  return ya.month - yb.month
}

export function isMonthBefore(monthIso: string, currentMonthIso: string): boolean {
  return compareMonthFirstIso(monthIso, currentMonthIso) < 0
}

export function isMonthAfter(monthIso: string, currentMonthIso: string): boolean {
  return compareMonthFirstIso(monthIso, currentMonthIso) > 0
}

/** True when office must close the Pacific current month before prepping this month. */
export function isFutureMonthPrepBlocked(
  monthIso: string,
  currentMonthIso: string,
  runsByMonth: Record<string, RouteRunMonthSummary>,
): boolean {
  if (!isMonthAfter(monthIso, currentMonthIso)) return false
  const currentRun = runsByMonth[currentMonthIso]
  if (!currentRun) return true
  if ((currentRun.completed_at ?? '').trim().length > 0) return false
  return (currentRun.workflow_stage ?? '') !== 'completed'
}

export const FUTURE_MONTH_PREP_BLOCKED_MESSAGE =
  "Close the current month's paperwork before preparing a future month."

/** Ignore a run header left over from another month while ``run_details`` is reloading. */
export function runForPaperworkMonth(
  run: TechnicianWorksheetRun | null | undefined,
  monthIso: string,
): TechnicianWorksheetRun | null {
  if (!run) return null
  if ((run.month_date ?? '').trim() !== monthIso.trim()) return null
  return run
}

/**
 * Locked view for Paperwork — derived from run phase and calendar month.
 *
 * Exact history is reserved for office-completed runs (and past months with no
 * run header yet). After **Reopen job**, the run returns to prep/review even
 * when the calendar month is in the past.
 */
export function derivePaperworkViewMode(
  run: TechnicianWorksheetRun | null | undefined,
  monthIso: string,
  currentMonthIso: string,
): PaperworkViewMode {
  const monthRun = runForPaperworkMonth(run, monthIso)
  if (monthRun && worksheetRunExplicitlyCompleted(monthRun)) {
    return 'exact_history'
  }
  if (isMonthBefore(monthIso, currentMonthIso) && monthRun == null) {
    return 'exact_history'
  }
  if (runInOfficePrepPhase(monthRun)) {
    return 'preparation'
  }
  return 'run_review'
}

export type SelectablePaperworkMonth = {
  monthIso: string
  runSummary: RouteRunMonthSummary | null
}

/**
 * Every month with a run file, plus current and next calendar month (even before a run exists).
 */
export function computeSelectablePaperworkMonths(
  runsByMonth: Record<string, RouteRunMonthSummary>,
  currentMonthIso: string,
): SelectablePaperworkMonth[] {
  const nextMonthIso = addCalendarMonths(currentMonthIso, 1)
  const allowed = new Set<string>(Object.keys(runsByMonth))

  allowed.add(currentMonthIso)
  if (nextMonthIso) {
    allowed.add(nextMonthIso)
  }

  return Array.from(allowed)
    .sort(compareMonthFirstIso)
    .map((monthIso) => ({
      monthIso,
      runSummary: runsByMonth[monthIso] ?? null,
    }))
}

export function paperworkViewModeLabel(mode: PaperworkViewMode): string {
  return PAPERWORK_VIEW_LABELS[mode] ?? mode
}

/** Normalize month query param; fall back to current Pacific month when invalid. */
export function resolvePaperworkMonthQuery(
  monthParam: string | null | undefined,
  currentMonthIso: string,
  selectableMonths: SelectablePaperworkMonth[],
): string {
  const trimmed = (monthParam ?? '').trim()
  const selectableSet = new Set(selectableMonths.map((m) => m.monthIso))
  if (trimmed && selectableSet.has(trimmed)) {
    return trimmed
  }
  if (selectableSet.has(currentMonthIso)) {
    return currentMonthIso
  }
  return selectableMonths[selectableMonths.length - 1]?.monthIso ?? currentMonthIso
}
