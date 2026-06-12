import { describe, expect, it } from 'vitest'
import {
  billingBoardPillTone,
  billingBoardShowUnsetDash,
  billingMonthPaperworkRouteId,
  billingMonthPillClickable,
  currentBillingQuarter,
  isPastPacificMonth,
  quarterFromCalendarMonth,
  quarterOptionLabel,
  quarterSelectionKey,
  quarterSelectionOptions,
  parseQuarterSelectionKey,
  type BillingBoardLocationRow,
  type BillingBoardMonthCell,
} from './monthlyBillingBoard'

const refJune2026 = new Date('2026-06-15T12:00:00-07:00')

function unsetCell(fieldWorkEnded = false): BillingBoardMonthCell {
  return {
    billing_status: 'unset',
    field_work_ended: fieldWorkEnded,
    test_monthly_route_id: 1,
    test_summary: {
      summary_key: 'pending',
      outcomes: [],
      testing_site_count: 1,
    },
  }
}

function billingRow(overrides: Partial<BillingBoardLocationRow> = {}): BillingBoardLocationRow {
  return {
    location_id: 101,
    address: '123 Main St',
    display_address: null,
    location_label: '123 Main St',
    building: null,
    property_management_company: null,
    billing_comments: null,
    test_day: 'R10',
    route_number: 10,
    monthly_route_id: 5,
    rollup_price_per_month: null,
    months: {},
    quarter_billed: false,
    billed_at: null,
    billed_by: null,
    ...overrides,
  }
}

function monthCell(billingStatus: string, overrides: Partial<BillingBoardMonthCell> = {}): BillingBoardMonthCell {
  return {
    billing_status: billingStatus,
    test_monthly_route_id: 9,
    test_summary: {
      summary_key: 'all_good',
      outcomes: [],
      testing_site_count: 1,
    },
    ...overrides,
  }
}

describe('isPastPacificMonth', () => {
  it('treats earlier calendar months as past', () => {
    expect(isPastPacificMonth('2026-05-01', refJune2026)).toBe(true)
  })

  it('treats current and future months as not past', () => {
    expect(isPastPacificMonth('2026-06-01', refJune2026)).toBe(false)
    expect(isPastPacificMonth('2026-07-01', refJune2026)).toBe(false)
  })
})

describe('billingBoardShowUnsetDash', () => {
  it('shows dash for current-month unset before field end', () => {
    expect(billingBoardShowUnsetDash(unsetCell(false), '2026-06-01', refJune2026)).toBe(true)
  })

  it('shows unset badge for past-month unset before field end', () => {
    expect(billingBoardShowUnsetDash(unsetCell(false), '2026-05-01', refJune2026)).toBe(false)
  })

  it('shows unset badge after field end', () => {
    expect(billingBoardShowUnsetDash(unsetCell(true), '2026-06-01', refJune2026)).toBe(false)
  })
})

describe('calendar quarter helpers', () => {
  it('maps months to calendar quarters', () => {
    expect(quarterFromCalendarMonth(1)).toBe(1)
    expect(quarterFromCalendarMonth(3)).toBe(1)
    expect(quarterFromCalendarMonth(4)).toBe(2)
    expect(quarterFromCalendarMonth(12)).toBe(4)
  })

  it('labels quarters with their months', () => {
    expect(quarterOptionLabel(2026, 1)).toBe('Q1 2026 (January, February, March)')
    expect(quarterOptionLabel(2026, 2)).toBe('Q2 2026 (April, May, June)')
  })

  it('round-trips quarter selection keys', () => {
    const key = quarterSelectionKey(2026, 2)
    expect(parseQuarterSelectionKey(key)).toEqual({ year: 2026, quarter: 2 })
  })

  it('derives the current billing quarter from Pacific time', () => {
    expect(currentBillingQuarter(refJune2026)).toEqual({ year: 2026, quarter: 2 })
  })

  it('builds recent quarter options with the current quarter included', () => {
    const options = quarterSelectionOptions(2, 0, refJune2026)
    expect(options).toContain('2026-Q2')
    expect(options[0]).toBe('2026-Q2')
  })
})

describe('billingBoardPillTone', () => {
  it('maps billing statuses to pill tones', () => {
    expect(billingBoardPillTone('bill')).toBe('bill')
    expect(billingBoardPillTone('do_not_bill')).toBe('do_not_bill')
    expect(billingBoardPillTone('legacy')).toBe('legacy')
    expect(billingBoardPillTone('unset')).toBe('unset')
    expect(billingBoardPillTone(null)).toBe('unset')
  })
})

describe('billingMonthPaperworkRouteId', () => {
  it('prefers test_monthly_route_id over monthly_route_id', () => {
    const row = billingRow({ monthly_route_id: 5 })
    const cell = monthCell('bill', { test_monthly_route_id: 9 })
    expect(billingMonthPaperworkRouteId(row, cell)).toBe(9)
  })

  it('falls back to monthly_route_id when test route is missing', () => {
    const row = billingRow({ monthly_route_id: 5 })
    const cell = monthCell('bill', { test_monthly_route_id: null })
    expect(billingMonthPaperworkRouteId(row, cell)).toBe(5)
  })

  it('returns null when no route can be resolved', () => {
    const row = billingRow({ monthly_route_id: null })
    const cell = monthCell('bill', { test_monthly_route_id: null })
    expect(billingMonthPaperworkRouteId(row, cell)).toBeNull()
  })
})

describe('billingMonthPillClickable', () => {
  const row = billingRow()

  it('is true for bill, waive, and legacy when route exists', () => {
    expect(billingMonthPillClickable(row, monthCell('bill'), '2026-05-01', refJune2026)).toBe(true)
    expect(billingMonthPillClickable(row, monthCell('do_not_bill'), '2026-05-01', refJune2026)).toBe(
      true,
    )
    expect(billingMonthPillClickable(row, monthCell('legacy'), '2026-05-01', refJune2026)).toBe(true)
  })

  it('is false for unset and dash cases', () => {
    expect(billingMonthPillClickable(row, unsetCell(false), '2026-06-01', refJune2026)).toBe(false)
    expect(billingMonthPillClickable(row, unsetCell(true), '2026-05-01', refJune2026)).toBe(false)
    expect(billingMonthPillClickable(row, monthCell('unset'), '2026-05-01', refJune2026)).toBe(false)
  })

  it('is false when no route id can be resolved', () => {
    const noRouteRow = billingRow({ monthly_route_id: null })
    const cell = monthCell('bill', { test_monthly_route_id: null })
    expect(billingMonthPillClickable(noRouteRow, cell, '2026-05-01', refJune2026)).toBe(false)
  })
})
