import { describe, expect, it } from 'vitest'
import type { TechnicianWorksheetRun } from './monthlyRoutesShared'
import {
  canOfficeEditBilling,
  canOfficeEditOutcomes,
  runDetailsOfficeReviewReadOnly,
} from './runWorkflowShared'

const MONTH = '2026-05-01'

function run(partial: Partial<TechnicianWorksheetRun> = {}): TechnicianWorksheetRun {
  return {
    id: 1,
    monthly_route_id: 1,
    month_date: MONTH,
    source: 'csv_import',
    status: 'open',
    opened_at: `${MONTH}T00:00:00Z`,
    prepared_at: `${MONTH}T00:00:00Z`,
    started_at: `${MONTH}T01:00:00Z`,
    field_ended_at: `${MONTH}T02:00:00Z`,
    office_review_completed_at: null,
    completed_at: null,
    pre_run_message: null,
    is_historical: true,
    ...partial,
  }
}

describe('runDetailsOfficeReviewReadOnly', () => {
  it('allows csv_import runs in office review after field end', () => {
    expect(runDetailsOfficeReviewReadOnly(run())).toBe(false)
    expect(canOfficeEditOutcomes(run())).toBe(true)
    expect(canOfficeEditBilling(run())).toBe(true)
  })

  it('locks csv_import runs while office-completed', () => {
    expect(
      runDetailsOfficeReviewReadOnly(
        run({ status: 'completed', completed_at: '2026-05-10T00:00:00Z' }),
      ),
    ).toBe(true)
  })

  it('locks csv_import runs before field end', () => {
    expect(runDetailsOfficeReviewReadOnly(run({ field_ended_at: null }))).toBe(true)
  })
})
