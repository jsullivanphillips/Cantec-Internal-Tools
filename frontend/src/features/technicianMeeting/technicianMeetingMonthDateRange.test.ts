import { describe, expect, it } from 'vitest'
import {
  defaultTechnicianMonthKey,
  formatMonthLabel,
  listTechnicianMonthSelectItems,
  monthKey,
  monthToDateRange,
  parseMonthKey,
} from './technicianMeetingMonthDateRange'

describe('technicianMeetingMonthDateRange', () => {
  const june2025 = new Date(2025, 5, 17)

  it('builds month keys and date ranges', () => {
    expect(monthKey(2025, 3)).toBe('2025-03')
    expect(parseMonthKey('2025-03')).toEqual({ year: 2025, month: 3 })
    expect(monthToDateRange(2025, 3)).toEqual({ startDate: '2025-03-01', endDate: '2025-03-31' })
    expect(formatMonthLabel(2025, 3)).toBe('March 2025')
  })

  it('defaults to the previous full calendar month', () => {
    expect(defaultTechnicianMonthKey(june2025)).toBe('2025-05')
  })

  it('lists all time, year headers, and months newest first', () => {
    const items = listTechnicianMonthSelectItems(2025, june2025)
    expect(items[0]).toMatchObject({ type: 'all-time', key: 'all-time', label: 'All time' })
    expect(items[1]).toMatchObject({ type: 'year', key: '2025', label: '2025' })
    expect(items[2]).toMatchObject({ type: 'month', key: '2025-06', label: 'June 2025' })
    expect(items[3]).toMatchObject({ type: 'month', key: '2025-05', label: 'May 2025' })
  })
})
