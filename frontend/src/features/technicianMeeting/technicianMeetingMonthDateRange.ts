import {
  ALL_TIME_QUARTER_KEY,
  allTimeDateRange,
  formatYearDividerLabel,
  SERVICE_EARLIEST_YEAR,
  serviceDateRangeParams,
  serviceYearDateRange,
  toLocalIsoDate,
} from '../mondayMeeting/mondayMeetingServiceDateRange'

export { ALL_TIME_QUARTER_KEY as ALL_TIME_MONTH_KEY }

export type TechnicianMonthOption = {
  key: string
  label: string
  startDate: string
  endDate: string
}

export type TechnicianMonthSelectItem =
  | { type: 'all-time'; key: string; label: string; startDate: string; endDate: string }
  | { type: 'year'; key: string; label: string; startDate: string; endDate: string }
  | ({ type: 'month' } & TechnicianMonthOption)

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

export function parseMonthKey(key: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(key)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  if (month < 1 || month > 12) return null
  return { year, month }
}

export function monthToDateRange(
  year: number,
  month: number,
): { startDate: string; endDate: string } {
  const startDate = toLocalIsoDate(new Date(year, month - 1, 1))
  const endDate = toLocalIsoDate(new Date(year, month, 0))
  return { startDate, endDate }
}

export function formatMonthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`
}

/** Previous full calendar month (matches legacy Technician Meeting default). */
export function defaultTechnicianMonthKey(date = new Date()): string {
  const firstOfThisMonth = new Date(date.getFullYear(), date.getMonth(), 1)
  const lastOfPreviousMonth = new Date(firstOfThisMonth)
  lastOfPreviousMonth.setDate(0)
  return monthKey(lastOfPreviousMonth.getFullYear(), lastOfPreviousMonth.getMonth() + 1)
}

function buildMonthOptionsForYear(year: number, maxMonth: number): TechnicianMonthOption[] {
  const options: TechnicianMonthOption[] = []
  for (let month = maxMonth; month >= 1; month -= 1) {
    const { startDate, endDate } = monthToDateRange(year, month)
    options.push({
      key: monthKey(year, month),
      label: formatMonthLabel(year, month),
      startDate,
      endDate,
    })
  }
  return options
}

/** Months from earliestYear through the current month, newest first, with year header rows. */
export function listTechnicianMonthSelectItems(
  earliestYear = SERVICE_EARLIEST_YEAR,
  date = new Date(),
): TechnicianMonthSelectItem[] {
  const currentYear = date.getFullYear()
  const currentMonth = date.getMonth() + 1
  const items: TechnicianMonthSelectItem[] = [
    { type: 'all-time', key: ALL_TIME_QUARTER_KEY, label: 'All time', ...allTimeDateRange(date) },
  ]

  for (let year = currentYear; year >= earliestYear; year -= 1) {
    const maxMonth = year === currentYear ? currentMonth : 12
    items.push({
      type: 'year',
      key: String(year),
      label: formatYearDividerLabel(year),
      ...serviceYearDateRange(year, date),
    })
    for (const option of buildMonthOptionsForYear(year, maxMonth)) {
      items.push({ type: 'month', ...option })
    }
  }

  return items
}

export const technicianMeetingDateRangeParams = serviceDateRangeParams
