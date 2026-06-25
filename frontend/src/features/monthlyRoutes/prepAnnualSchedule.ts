import type {
  AnnualScheduleCheckLocation,
  AnnualScheduleCheckStatus,
  PrepAnnualScheduleWarning,
  TechnicianWorksheetLocation,
} from './monthlyRoutesShared'

export function derivePrepAnnualScheduleWarning(
  hasServiceTradeLink: boolean,
  hasScheduledAnnualInMonth: boolean,
  annualSpansMonths: boolean,
  annualSkipTie: boolean,
): PrepAnnualScheduleWarning | null {
  if (!hasServiceTradeLink && hasScheduledAnnualInMonth) return 'no_servicetrade_link'
  if (annualSkipTie) return 'annual_skip_tie'
  if (annualSpansMonths) return 'annual_spans_months'
  return null
}

function annualScheduleRowReady(
  scheduleStatus: AnnualScheduleCheckStatus,
  scheduleRow: AnnualScheduleCheckLocation | null | undefined,
): boolean {
  if (scheduleStatus === 'ready') return scheduleRow != null
  if (scheduleStatus === 'syncing') return scheduleRow != null
  return false
}

export function prepRowAnnualDue(
  locationId: number,
  scheduleStatus: AnnualScheduleCheckStatus,
  locationsById: Record<number, AnnualScheduleCheckLocation> | null,
  stop: Pick<TechnicianWorksheetLocation, 'annual_test_override'> | null | undefined,
): boolean {
  if (locationsById == null) return false
  const row = locationsById[locationId]
  if (!annualScheduleRowReady(scheduleStatus, row)) return false
  if (stop?.annual_test_override) return false
  return row!.annual_skip_recommended
}

export function prepRowAnnualDueForStop(
  scheduleStatus: AnnualScheduleCheckStatus,
  scheduleRow: AnnualScheduleCheckLocation | null | undefined,
  stop: Pick<TechnicianWorksheetLocation, 'annual_test_override'> | null | undefined,
): boolean {
  if (!annualScheduleRowReady(scheduleStatus, scheduleRow)) return false
  if (stop?.annual_test_override) return false
  return scheduleRow!.annual_skip_recommended
}

export function annualScheduleRowHasActivity(
  scheduleRow: AnnualScheduleCheckLocation | null | undefined,
): boolean {
  if (!scheduleRow) return false
  return (
    scheduleRow.has_scheduled_annual_in_month ||
    scheduleRow.annual_spans_months ||
    scheduleRow.annual_skip_recommended
  )
}

export function prepRowHasAnnualScheduleActivity(
  scheduleStatus: AnnualScheduleCheckStatus,
  scheduleRow: AnnualScheduleCheckLocation | null | undefined,
): boolean {
  if (!annualScheduleRowReady(scheduleStatus, scheduleRow)) return false
  return annualScheduleRowHasActivity(scheduleRow)
}

export function prepRowShowsAnnualOverriddenPill(
  scheduleStatus: AnnualScheduleCheckStatus,
  scheduleRow: AnnualScheduleCheckLocation | null | undefined,
  stop: Pick<TechnicianWorksheetLocation, 'annual_test_override'> | null | undefined,
): boolean {
  if (!annualScheduleRowReady(scheduleStatus, scheduleRow)) return false
  if (!stop?.annual_test_override) return false
  return annualScheduleRowHasActivity(scheduleRow)
}

export function prepRowShowsAnnualTestControl(
  scheduleStatus: AnnualScheduleCheckStatus,
  scheduleRow: AnnualScheduleCheckLocation | null | undefined,
  stop: Pick<TechnicianWorksheetLocation, 'annual_test_override'> | null | undefined,
): boolean {
  if (stop?.annual_test_override) return false
  return prepRowHasAnnualScheduleActivity(scheduleStatus, scheduleRow)
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
  if (warning === 'no_servicetrade_link') return 'No ServiceTrade link'
  if (warning === 'annual_spans_months') return 'Annual spans months'
  if (warning === 'annual_skip_tie') return 'Annual skip tie — review'
  return null
}
