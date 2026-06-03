import { describe, expect, it } from 'vitest'
import {
  bcRicherStatHolidays,
  bcStatHolidayDatesForYear,
  bcStatHolidayName,
  isBcStatHoliday,
} from './bcStatHolidays'

describe('bcStatHolidays', () => {
  it('includes BC richer holidays for 2026', () => {
    const dates = bcStatHolidayDatesForYear(2026)
    expect(dates.has('2026-02-16')).toBe(true) // Family Day (3rd Mon Feb)
    expect(dates.has('2026-04-03')).toBe(true) // Good Friday
    expect(dates.has('2026-05-18')).toBe(true) // Victoria Day (Mon before May 25)
    expect(dates.has('2026-07-01')).toBe(true) // Canada Day
    expect(dates.has('2026-08-03')).toBe(true) // BC Day
    expect(dates.has('2026-09-30')).toBe(true) // Truth & Reconciliation
    expect(dates.has('2026-12-25')).toBe(true) // Christmas
    expect(dates.has('2026-12-28')).toBe(true) // Boxing Day observed (Dec 26 Sat -> Mon)
  })

  it('resolves holiday name by iso', () => {
    expect(bcStatHolidayName('2026-05-18', 2026)).toBe('Victoria Day')
    expect(bcStatHolidayName('2026-07-01', 2026)).toBe('Canada Day')
    expect(bcStatHolidayName('2026-06-03', 2026)).toBeNull()
  })

  it('isBcStatHoliday checks year from iso prefix', () => {
    expect(isBcStatHoliday('2026-05-18')).toBe(true)
    expect(isBcStatHoliday('2026-06-03')).toBe(false)
  })

  it('returns twelve named holidays for a typical year', () => {
    expect(bcRicherStatHolidays(2026)).toHaveLength(12)
  })
})
