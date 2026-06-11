import type { MonthlyRunDetailLocation } from './monthlyRoutesShared'
import { runDetailLocationAsWorksheetLocation } from './runDetailsLocationReview'
import { officeStopStatus } from './officeWorksheetTableShared'

export function stopAnnualDueThisMonth(
  stop: MonthlyRunDetailLocation,
  locationLabel: string,
  monthDate: string,
): boolean {
  const ws = runDetailLocationAsWorksheetLocation({
    ...stop,
    display_address: stop.display_address || locationLabel,
  })
  return officeStopStatus(ws, monthDate) === 'annual'
}

/** Optional hint under the annual month field when unset. */
export function annualMonthHint(
  stop: MonthlyRunDetailLocation,
  _locationLabel: string,
  _monthDate: string,
): string | undefined {
  const annual = (stop.annual_month || '').trim()
  if (!annual) return 'No annual month set — verify before next run.'
  return undefined
}
