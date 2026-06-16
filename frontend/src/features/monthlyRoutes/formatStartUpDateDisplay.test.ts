import { describe, expect, it } from 'vitest'
import { formatStartUpDateDisplay } from './monthlyRoutesShared'

describe('formatStartUpDateDisplay', () => {
  it('formats ISO dates as full month, ordinal day, and year', () => {
    expect(formatStartUpDateDisplay('2024-10-01')).toBe('October 1st, 2024')
    expect(formatStartUpDateDisplay('2024-08-01')).toBe('August 1st, 2024')
    expect(formatStartUpDateDisplay('2026-06-16')).toBe('June 16th, 2026')
    expect(formatStartUpDateDisplay('2023-01-05')).toBe('January 5th, 2023')
    expect(formatStartUpDateDisplay('2024-10-02')).toBe('October 2nd, 2024')
    expect(formatStartUpDateDisplay('2024-10-03')).toBe('October 3rd, 2024')
    expect(formatStartUpDateDisplay('2024-10-11')).toBe('October 11th, 2024')
  })

  it('returns em dash for empty values', () => {
    expect(formatStartUpDateDisplay(null)).toBe('—')
    expect(formatStartUpDateDisplay('')).toBe('—')
    expect(formatStartUpDateDisplay('   ')).toBe('—')
  })
})
