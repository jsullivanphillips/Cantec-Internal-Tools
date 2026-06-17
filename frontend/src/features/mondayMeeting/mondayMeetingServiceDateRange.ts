export function toLocalIsoDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export type ServiceQuarter = 1 | 2 | 3 | 4

export const QUARTER_MONTH_LABELS: Record<ServiceQuarter, string> = {
  1: 'January to March',
  2: 'April to June',
  3: 'July to September',
  4: 'October to December',
}

const QUARTER_FIRST_MONTH: Record<ServiceQuarter, number> = {
  1: 0,
  2: 3,
  3: 6,
  4: 9,
}

export function quarterKey(year: number, quarter: ServiceQuarter): string {
  return `${year}-Q${quarter}`
}

export function parseQuarterKey(key: string): { year: number; quarter: ServiceQuarter } | null {
  const match = /^(\d{4})-Q([1-4])$/.exec(key)
  if (!match) return null
  return { year: Number(match[1]), quarter: Number(match[2]) as ServiceQuarter }
}

export function quarterToDateRange(
  year: number,
  quarter: ServiceQuarter,
): { startDate: string; endDate: string } {
  const startMonth = QUARTER_FIRST_MONTH[quarter]
  const startDate = toLocalIsoDate(new Date(year, startMonth, 1))
  const endDate = toLocalIsoDate(new Date(year, startMonth + 3, 0))
  return { startDate, endDate }
}

export function currentCalendarQuarter(date = new Date()): { year: number; quarter: ServiceQuarter } {
  const year = date.getFullYear()
  const quarter = (Math.floor(date.getMonth() / 3) + 1) as ServiceQuarter
  return { year, quarter }
}

/** Current calendar quarter (default for Service tab). */
export function defaultServiceQuarterKey(date = new Date()): string {
  const { year, quarter } = currentCalendarQuarter(date)
  return quarterKey(year, quarter)
}

export const ALL_TIME_QUARTER_KEY = 'all-time'
export const SERVICE_EARLIEST_YEAR = 2024

/** Full service reporting window: earliest synced year through today. */
export function allTimeDateRange(date = new Date()): { startDate: string; endDate: string } {
  return {
    startDate: toLocalIsoDate(new Date(SERVICE_EARLIEST_YEAR, 0, 1)),
    endDate: toLocalIsoDate(date),
  }
}

export function serviceYearDateRange(
  year: number,
  date = new Date(),
): { startDate: string; endDate: string } {
  const start = new Date(year, 0, 1)
  const endOfYear = new Date(year, 11, 31)
  const end = year === date.getFullYear() && date < endOfYear ? date : endOfYear
  return { startDate: toLocalIsoDate(start), endDate: toLocalIsoDate(end) }
}

function formatIsoDateLong(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return iso
  const [, year, month, day] = match
  const date = new Date(Number(year), Number(month) - 1, Number(day))
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

export function allTimeRangeTooltipText(range = allTimeDateRange()): string {
  return `All time includes data from ${formatIsoDateLong(range.startDate)} through ${formatIsoDateLong(range.endDate)}.`
}

export type ServiceQuarterOption = {
  key: string
  label: string
  startDate: string
  endDate: string
}

export type ServiceQuarterSelectItem =
  | { type: 'all-time'; key: string; label: string; startDate: string; endDate: string }
  | { type: 'year'; key: string; label: string; startDate: string; endDate: string }
  | ({ type: 'quarter' } & ServiceQuarterOption)

export function formatYearDividerLabel(year: number): string {
  return String(year)
}

function buildQuarterOptionsForYear(
  year: number,
  maxQuarter: number,
): ServiceQuarterOption[] {
  const options: ServiceQuarterOption[] = []
  for (let quarter = maxQuarter; quarter >= 1; quarter -= 1) {
    const q = quarter as ServiceQuarter
    const { startDate, endDate } = quarterToDateRange(year, q)
    options.push({
      key: quarterKey(year, q),
      label: `Q${q} ${year} - ${QUARTER_MONTH_LABELS[q]}`,
      startDate,
      endDate,
    })
  }
  return options
}

/** Quarters from earliestYear through the current quarter, newest first. */
export function listServiceQuarterOptions(earliestYear = SERVICE_EARLIEST_YEAR, date = new Date()): ServiceQuarterOption[] {
  const { year: currentYear, quarter: currentQuarter } = currentCalendarQuarter(date)
  const options: ServiceQuarterOption[] = []

  for (let year = currentYear; year >= earliestYear; year -= 1) {
    const maxQuarter = year === currentYear ? currentQuarter : 4
    options.push(...buildQuarterOptionsForYear(year, maxQuarter))
  }

  return options
}

/** Quarter options with a selectable year row before each year's quarters. */
export function listServiceQuarterSelectItems(
  earliestYear = SERVICE_EARLIEST_YEAR,
  date = new Date(),
): ServiceQuarterSelectItem[] {
  const { year: currentYear, quarter: currentQuarter } = currentCalendarQuarter(date)
  const items: ServiceQuarterSelectItem[] = [
    { type: 'all-time', key: ALL_TIME_QUARTER_KEY, label: 'All time', ...allTimeDateRange(date) },
  ]

  for (let year = currentYear; year >= earliestYear; year -= 1) {
    const maxQuarter = year === currentYear ? currentQuarter : 4
    items.push({ type: 'year', key: String(year), label: formatYearDividerLabel(year), ...serviceYearDateRange(year, date) })
    for (const option of buildQuarterOptionsForYear(year, maxQuarter)) {
      items.push({ type: 'quarter', ...option })
    }
  }

  return items
}

/** Same default as the Service tab before quarters: previous full calendar month. */
export function defaultServiceDateRange() {
  const today = new Date()
  const firstOfThisMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  const lastOfPreviousMonth = new Date(firstOfThisMonth)
  lastOfPreviousMonth.setDate(0)
  const firstOfPreviousMonth = new Date(
    lastOfPreviousMonth.getFullYear(),
    lastOfPreviousMonth.getMonth(),
    1,
  )
  return {
    startDate: toLocalIsoDate(firstOfPreviousMonth),
    endDate: toLocalIsoDate(lastOfPreviousMonth),
  }
}

export function serviceDateRangeParams(startDate: string, endDate: string): string {
  const q = new URLSearchParams()
  if (startDate) q.set('start_date', startDate)
  if (endDate) q.set('end_date', endDate)
  const s = q.toString()
  return s ? `?${s}` : ''
}
