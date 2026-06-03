/**
 * BC richer statutory holiday set (mirrors ``app/monthly/bc_stat_holidays.py``).
 * Used for monthly route test-day scheduling — no testing on stat holidays.
 */

export type BcStatHolidayEntry = {
  name: string
  iso: string
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function isoFromUtcDate(d: Date): string {
  const y = d.getUTCFullYear()
  const mo = pad2(d.getUTCMonth() + 1)
  const day = pad2(d.getUTCDate())
  return `${y}-${mo}-${day}`
}

function utcDate(y: number, month: number, day: number): Date {
  return new Date(Date.UTC(y, month - 1, day))
}

function utcWeekday(y: number, month: number, day: number): number {
  return utcDate(y, month, day).getUTCDay()
}

/** Mon=0 … Sun=6 (Python ``weekday()``). */
function pythonWeekdayFromUtc(d: Date): number {
  const js = d.getUTCDay()
  return js === 0 ? 6 : js - 1
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function observed(dt: Date): Date {
  const wd = pythonWeekdayFromUtc(dt)
  if (wd === 5) {
    return utcDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate() + 2)
  }
  if (wd === 6) {
    return utcDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate() + 1)
  }
  return dt
}

function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekdayPython: number,
  n: number,
): Date | null {
  const targetJs = (weekdayPython + 1) % 7
  const last = daysInMonth(year, month)
  let count = 0
  for (let dom = 1; dom <= last; dom++) {
    if (utcWeekday(year, month, dom) === targetJs) {
      count += 1
      if (count === n) {
        return utcDate(year, month, dom)
      }
    }
  }
  return null
}

function weekdayBefore(year: number, month: number, day: number, weekdayPython: number): Date {
  let cur = utcDate(year, month, day)
  cur = utcDate(cur.getUTCFullYear(), cur.getUTCMonth() + 1, cur.getUTCDate() - 1)
  while (pythonWeekdayFromUtc(cur) !== weekdayPython) {
    cur = utcDate(cur.getUTCFullYear(), cur.getUTCMonth() + 1, cur.getUTCDate() - 1)
  }
  return cur
}

function easterSunday(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const easterMonth = Math.floor((h + l - 7 * m + 114) / 31)
  const easterDay = ((h + l - 7 * m + 114) % 31) + 1
  return utcDate(year, easterMonth, easterDay)
}

function company9Holidays(year: number): BcStatHolidayEntry[] {
  const easter = easterSunday(year)
  const goodFriday = utcDate(
    easter.getUTCFullYear(),
    easter.getUTCMonth() + 1,
    easter.getUTCDate() - 2,
  )

  const entries: Array<[string, Date | null]> = [
    ["New Year's Day", observed(utcDate(year, 1, 1))],
    ['Family Day (BC)', nthWeekdayOfMonth(year, 2, 0, 3)],
    ['Good Friday', goodFriday],
    ['Victoria Day', weekdayBefore(year, 5, 25, 0)],
    ['Canada Day', observed(utcDate(year, 7, 1))],
    ['Labour Day', nthWeekdayOfMonth(year, 9, 0, 1)],
    ['Thanksgiving', nthWeekdayOfMonth(year, 10, 0, 2)],
    ['Remembrance Day', observed(utcDate(year, 11, 11))],
    ['Christmas Day', observed(utcDate(year, 12, 25))],
  ]

  return entries
    .filter((pair): pair is [string, Date] => pair[1] != null)
    .map(([name, dt]) => ({ name, iso: isoFromUtcDate(dt) }))
}

/** BC richer stat set: company 9 + BC Day, Truth & Reconciliation, Boxing Day. */
export function bcRicherStatHolidays(year: number): BcStatHolidayEntry[] {
  const base = company9Holidays(year)
  const extra: Array<[string, Date | null]> = [
    ['BC Day', nthWeekdayOfMonth(year, 8, 0, 1)],
    ['National Day for Truth and Reconciliation', observed(utcDate(year, 9, 30))],
    ['Boxing Day', observed(utcDate(year, 12, 26))],
  ]
  const extras = extra
    .filter((pair): pair is [string, Date] => pair[1] != null)
    .map(([name, dt]) => ({ name, iso: isoFromUtcDate(dt) }))
  return [...base, ...extras]
}

const holidayCache = new Map<number, BcStatHolidayEntry[]>()

function holidaysForYear(year: number): BcStatHolidayEntry[] {
  let cached = holidayCache.get(year)
  if (!cached) {
    cached = bcRicherStatHolidays(year)
    holidayCache.set(year, cached)
  }
  return cached
}

export function bcStatHolidayDatesForYear(year: number): Set<string> {
  return new Set(holidaysForYear(year).map((h) => h.iso))
}

export function bcStatHolidayName(iso: string, year: number): string | null {
  const match = holidaysForYear(year).find((h) => h.iso === iso)
  return match?.name ?? null
}

export function isBcStatHoliday(iso: string): boolean {
  const y = parseInt(iso.slice(0, 4), 10)
  if (!Number.isFinite(y)) return false
  return bcStatHolidayDatesForYear(y).has(iso)
}
