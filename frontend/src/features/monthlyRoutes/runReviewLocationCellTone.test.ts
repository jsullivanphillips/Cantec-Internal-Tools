import { describe, expect, it } from 'vitest'
import type { TechnicianWorksheetLocation } from './monthlyRoutesShared'
import {
  runReviewLocationCellClass,
  runReviewLocationCellTone,
  runReviewLocationResultCardClass,
  runReviewOutcomeIconKind,
} from './officeRunReviewShared'

const MONTH = '2026-05-01'

function baseStop(overrides: Partial<TechnicianWorksheetLocation> = {}): TechnicianWorksheetLocation {
  return {
    location_id: 1,
    location_month_row_id: 0,
    month_date: MONTH,
    display_address: '123 Main St',
    label: null,
    property_management_company: null,
    panel: null,
    panel_location: null,
    door_code: null,
    ring: null,
    key_number: null,
    annual_month: null,
    monitoring_company: null,
    monitoring_notes: null,
    result_status: null,
    skip_reason: null,
    testing_procedures: null,
    inspection_tech_notes: null,
    run_comments: null,
    time_in: null,
    time_out: null,
    route_stop_order: null,
    session_route_stop_order: null,
    stop_number: 1,
    version_updated_at: null,
    ...overrides,
  }
}

describe('runReviewLocationCellTone', () => {
  it('maps portal outcomes to cell tones', () => {
    expect(runReviewLocationCellTone(baseStop({ test_outcome: 'all_good' }), MONTH)).toBe('all_good')
    expect(runReviewLocationCellTone(baseStop({ test_outcome: 'passed_with_problems' }), MONTH)).toBe(
      'passed_with_problems',
    )
    expect(runReviewLocationCellTone(baseStop({ test_outcome: 'failed' }), MONTH)).toBe('failed')
  })

  it('maps legacy tested to all_good', () => {
    expect(runReviewLocationCellTone(baseStop({ result_status: 'tested' }), MONTH)).toBe('all_good')
  })

  it('distinguishes annual skip from generic skip', () => {
    expect(
      runReviewLocationCellTone(
        baseStop({
          test_outcome: 'skipped',
          result_status: 'skipped',
          skip_reason: 'annual',
          annual_month: 'May',
        }),
        MONTH,
      ),
    ).toBe('annual')
    expect(
      runReviewLocationCellTone(
        baseStop({
          test_outcome: 'skipped',
          result_status: 'skipped',
          skip_reason: 'no_access',
        }),
        MONTH,
      ),
    ).toBe('skipped')
  })

  it('uses pending for stops without a recorded outcome', () => {
    expect(runReviewLocationCellTone(baseStop(), MONTH)).toBe('pending')
    expect(
      runReviewLocationCellTone(baseStop({ annual_month: 'May', status_normalized: 'on_hold' }), MONTH),
    ).toBe('pending')
  })

  it('maps tone to css class suffix', () => {
    expect(runReviewLocationCellClass('all_good')).toBe('run-details-review-location-cell--all-good')
    expect(runReviewLocationCellClass('pending')).toBe('run-details-review-location-cell--pending')
    expect(runReviewLocationResultCardClass('passed_with_problems')).toBe(
      'run-details-review-location-result-card--passed-problems',
    )
  })
})

describe('runReviewOutcomeIconKind', () => {
  it('shows skip icon for generic skipped stops and building icon for annual', () => {
    expect(
      runReviewOutcomeIconKind(
        baseStop({
          test_outcome: 'skipped',
          result_status: 'skipped',
          skip_category: 'access_issues',
        }),
        MONTH,
      ),
    ).toBe('skipped')
    expect(
      runReviewOutcomeIconKind(
        baseStop({
          test_outcome: 'skipped',
          result_status: 'skipped',
          skip_reason: 'annual',
          annual_month: 'May',
        }),
        MONTH,
      ),
    ).toBe('annual')
  })
})
