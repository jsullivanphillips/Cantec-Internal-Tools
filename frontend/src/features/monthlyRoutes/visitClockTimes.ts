/** Parse technician visit clock strings (sheet + portal). Mirrors app.monthly.visit_clock_times. */

export function looksLikeSheetClock(cell: string | null | undefined): boolean {
  const s = (cell ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
  if (!s) return false
  return (s.includes('am') || s.includes('pm') || s.includes(':')) && /\d/.test(s)
}

const AMPM_RE = /^\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s*$/i
const H24_RE = /^\s*(\d{1,2}):(\d{2})\s*$/

function inferVisitClockIsAm(hour12: number): boolean {
  if (hour12 >= 1 && hour12 <= 6) return false
  if (hour12 >= 7 && hour12 <= 11) return true
  if (hour12 === 12) return false
  return false
}

function hour12ToMinutesSinceMidnight(hour12: number, minute: number, isAm: boolean): number {
  const hour24 = isAm ? (hour12 === 12 ? 0 : hour12) : hour12 === 12 ? 12 : hour12 + 12
  return hour24 * 60 + minute
}

export function parseVisitClockMinutes(raw: string | null | undefined): number | null {
  const text = (raw ?? '').trim().replace(/\s+/g, ' ')
  if (!text || !looksLikeSheetClock(text)) return null

  const ampmMatch = text.match(AMPM_RE)
  if (ampmMatch) {
    const hour = Number(ampmMatch[1])
    const minute = Number(ampmMatch[2] ?? '0')
    const meridiem = ampmMatch[3].toUpperCase()
    if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null
    if (meridiem === 'AM') {
      const hour24 = hour === 12 ? 0 : hour
      return hour24 * 60 + minute
    }
    const hour24 = hour === 12 ? 12 : hour + 12
    return hour24 * 60 + minute
  }

  const h24Match = text.match(H24_RE)
  if (h24Match) {
    const hour = Number(h24Match[1])
    const minute = Number(h24Match[2])
    if (minute < 0 || minute > 59) return null
    if (hour >= 13) {
      if (hour > 23) return null
      return hour * 60 + minute
    }
    if (hour === 0) return minute
    if (hour >= 1 && hour <= 12) {
      return hour12ToMinutesSinceMidnight(hour, minute, inferVisitClockIsAm(hour))
    }
    return null
  }

  return null
}

export function formatVisitClockMinutes(minutes: number): string {
  const normalized = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60)
  const hour24 = Math.floor(normalized / 60)
  const minute = normalized % 60
  const meridiem = hour24 < 12 ? 'AM' : 'PM'
  const hour12 = hour24 % 12 || 12
  return `${hour12}:${String(minute).padStart(2, '0')} ${meridiem}`
}

export function normalizePortalClockTimeInput(raw: string): string | null {
  const minutes = parseVisitClockMinutes(raw)
  if (minutes === null) return null
  return formatVisitClockMinutes(minutes)
}

export const PORTAL_CLOCK_TIME_HINT = 'e.g. 9:00 AM or 14:30'
export const PORTAL_CLOCK_TIME_INVALID_MESSAGE =
  'Enter a valid time (e.g. 9:00 AM or 14:30).'
