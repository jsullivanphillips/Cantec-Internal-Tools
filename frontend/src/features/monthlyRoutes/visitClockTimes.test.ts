import { describe, expect, it } from 'vitest'
import {
  formatVisitClockMinutes,
  normalizePortalClockTimeInput,
  parseVisitClockMinutes,
} from './visitClockTimes'

describe('parseVisitClockMinutes', () => {
  it('parses AM/PM times', () => {
    expect(parseVisitClockMinutes('3:05 PM')).toBe(15 * 60 + 5)
    expect(parseVisitClockMinutes('12:30 AM')).toBe(30)
    expect(parseVisitClockMinutes('12:00 PM')).toBe(12 * 60)
  })

  it('parses 24-hour times', () => {
    expect(parseVisitClockMinutes('15:45')).toBe(15 * 60 + 45)
    expect(parseVisitClockMinutes('09:00')).toBe(9 * 60)
  })

  it('infers meridiem for ambiguous times', () => {
    expect(parseVisitClockMinutes('8:30')).toBe(8 * 60 + 30)
    expect(parseVisitClockMinutes('1:04')).toBe(13 * 60 + 4)
  })

  it('rejects non-clock text', () => {
    expect(parseVisitClockMinutes('')).toBeNull()
    expect(parseVisitClockMinutes('abc')).toBeNull()
    expect(parseVisitClockMinutes('annual booked')).toBeNull()
  })
})

describe('normalizePortalClockTimeInput', () => {
  it('formats valid input consistently', () => {
    expect(normalizePortalClockTimeInput('3:05 pm')).toBe('3:05 PM')
    expect(normalizePortalClockTimeInput('15:45')).toBe('3:45 PM')
  })

  it('returns null for invalid input', () => {
    expect(normalizePortalClockTimeInput('not a time')).toBeNull()
  })
})

describe('formatVisitClockMinutes', () => {
  it('formats minutes since midnight', () => {
    expect(formatVisitClockMinutes(15 * 60 + 5)).toBe('3:05 PM')
  })
})
