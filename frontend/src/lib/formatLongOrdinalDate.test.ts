import { describe, expect, it } from 'vitest'
import { formatLongOrdinalDate } from './formatLongOrdinalDate'

describe('formatLongOrdinalDate', () => {
  it('formats ISO datetimes as month, ordinal day, and year', () => {
    expect(formatLongOrdinalDate('2026-10-01T15:30:00')).toBe('October 1st, 2026')
    expect(formatLongOrdinalDate('2024-10-02T00:00:00')).toBe('October 2nd, 2024')
    expect(formatLongOrdinalDate('2024-10-03T00:00:00')).toBe('October 3rd, 2024')
    expect(formatLongOrdinalDate('2024-10-11T00:00:00')).toBe('October 11th, 2024')
  })

  it('returns em dash for empty values', () => {
    expect(formatLongOrdinalDate(null)).toBe('—')
    expect(formatLongOrdinalDate('')).toBe('—')
  })
})
