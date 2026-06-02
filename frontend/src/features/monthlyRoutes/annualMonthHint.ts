import type { MonthlyRunDetailLocationStop } from './monthlyRoutesShared'
import { locationStopAsWorksheetStop } from './runDetailsLocationReview'
import { officeStopStatus } from './officeWorksheetTableShared'

export function stopAnnualDueThisMonth(
  stop: MonthlyRunDetailLocationStop,
  locationLabel: string,
  monthDate: string,
): boolean {
  const ws = locationStopAsWorksheetStop(stop, locationLabel)
  return officeStopStatus(ws, monthDate) === 'annual'
}

/** Optional hint under the annual month field when unset. */
export function annualMonthHint(
  stop: MonthlyRunDetailLocationStop,
  _locationLabel: string,
  _monthDate: string,
): string | undefined {
  const annual = (stop.annual_month || '').trim()
  if (!annual) return 'No annual month set — verify before next run.'
  return undefined
}
