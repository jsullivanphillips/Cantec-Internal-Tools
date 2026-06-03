import { describe, expect, it } from 'vitest'
import {
  billingBoardShowUnsetDash,
  isPastPacificMonth,
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
