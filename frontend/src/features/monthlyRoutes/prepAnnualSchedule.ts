import type {
  AnnualScheduleCheckLocation,
  AnnualScheduleCheckStatus,
  PrepAnnualScheduleWarning,
  TechnicianWorksheetLocation,
} from './monthlyRoutesShared'
import { isAnnualForMonth } from './monthlyRoutesShared'

export function derivePrepAnnualScheduleWarning(
  annualMonthMatchesRun: boolean,
  hasServiceTradeLink: boolean,
  hasScheduledAnnualInMonth: boolean,
): PrepAnnualScheduleWarning | null {
  if (annualMonthMatchesRun) {
    if (!hasServiceTradeLink) return 'no_servicetrade_link'
    if (!hasScheduledAnnualInMonth) return 'no_annual_scheduled'
    return null
  }
  if (hasScheduledAnnualInMonth) return 'annual_scheduled_wrong_month'
  return null
}

/** Recompute ST prep flags from the live prep row annual month (cached check can be stale). */
export function mergePrepAnnualScheduleRow(
  scheduleRow: AnnualScheduleCheckLocation | null | undefined,
  annualMonth: string | null | undefined,
  monthDate: string,
): AnnualScheduleCheckLocation | null {
  if (!scheduleRow) return null
  const annualMonthMatchesRun = isAnnualForMonth(annualMonth, monthDate)
  return {
    ...scheduleRow,
    annual_month_matches_run: annualMonthMatchesRun,
    prep_warning: derivePrepAnnualScheduleWarning(
      annualMonthMatchesRun,
      scheduleRow.has_service_trade_link,
      scheduleRow.has_scheduled_annual_in_month,
    ),
  }
}

export function prepRowAnnualDue(
  locationId: number,
  scheduleStatus: AnnualScheduleCheckStatus,
  locationsById: Record<number, AnnualScheduleCheckLocation> | null,
): boolean {
  if (scheduleStatus !== 'ready' || locationsById == null) return false
  const row = locationsById[locationId]
  if (!row) return false
  return row.annual_month_matches_run && row.has_scheduled_annual_in_month
}

export function prepRowAnnualDueForStop(
  scheduleStatus: AnnualScheduleCheckStatus,
  scheduleRow: AnnualScheduleCheckLocation | null | undefined,
  annualMonth: string | null | undefined,
  monthDate: string,
): boolean {
  const merged = mergePrepAnnualScheduleRow(scheduleRow, annualMonth, monthDate)
  if (scheduleStatus !== 'ready' || !merged) return false
  return merged.annual_month_matches_run && merged.has_scheduled_annual_in_month
}

/** Worksheet stop flag from server (same gate as prep orange row / portal annual auto-skip). */
export function stopScheduledAnnualAutoSkipActive(
  stop: Pick<TechnicianWorksheetLocation, 'scheduled_annual_auto_skip'>,
): boolean {
  return stop.scheduled_annual_auto_skip === true
}

export function prepAnnualScheduleWarningLabel(
  warning: PrepAnnualScheduleWarning | null | undefined,
): string | null {
  if (warning === 'no_annual_scheduled') return 'No annual scheduled'
  if (warning === 'no_servicetrade_link') return 'No ServiceTrade link'
  if (warning === 'annual_scheduled_wrong_month') return 'Annual scheduled for this month'
  return null
}
