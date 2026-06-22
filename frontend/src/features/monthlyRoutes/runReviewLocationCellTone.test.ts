import { describe, expect, it } from 'vitest'
import type { TechnicianWorksheetLocation } from './monthlyRoutesShared'
import {
  runReviewLocationCellClass,
  runReviewLocationCellTone,
  runReviewLocationResultCardClass,
  runReviewOutcomeHeadline,
  runReviewOutcomeIconKind,
} from './officeRunReviewShared'
import {
  OFFICE_OUTCOME_ON_HOLD_LABEL,
  OFFICE_OUTCOME_SKIPPED_ANNUAL_LABEL,
} from './portalWorkflowShared'
import { runDetailLocationAsWorksheetLocation } from './runDetailsLocationReview'

const MONTH = '2026-05-01'
const JUNE_MONTH = '2026-06-01'

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

  it('keeps explicit skip reason when site annual month matches run month', () => {
    expect(
      runReviewLocationCellTone(
        baseStop({
          test_outcome: 'skipped',
          result_status: 'skipped',
          skip_category: 'access_issues',
          annual_month: 'June',
          month_date: JUNE_MONTH,
        }),
        JUNE_MONTH,
      ),
    ).toBe('skipped')
    expect(
      runReviewOutcomeHeadline(
        baseStop({
          test_outcome: 'skipped',
          result_status: 'skipped',
          skip_reason: 'no_access',
          annual_month: 'June',
          month_date: JUNE_MONTH,
        }),
        JUNE_MONTH,
      ),
    ).not.toBe(OFFICE_OUTCOME_SKIPPED_ANNUAL_LABEL)
  })

  it('uses pending for stops without a recorded outcome', () => {
    expect(runReviewLocationCellTone(baseStop(), MONTH)).toBe('pending')
  })

  it('uses annual tone for auto annual-month stops without a recorded outcome', () => {
    expect(runReviewLocationCellTone(baseStop({ annual_month: 'May' }), MONTH)).toBe('annual')
  })

  it('shows orange on-hold styling when tech submitted no outcome', () => {
    const ws = runDetailLocationAsWorksheetLocation({
      location_id: 12,
      location_label: '200 Hold St',
      stop_number: 3,
      display_address: '200 Hold St',
      label: null,
      month_date: MONTH,
      result_status: null,
      test_outcome: null,
      annual_month: null,
      status_normalized: 'on_hold',
      run_comments: null,
      testing_procedures: null,
      inspection_tech_notes: null,
      has_field_edits: false,
      review_kind: 'with_changes',
      deficiency_summaries: [],
      has_active_deficiencies: false,
      billing_status: 'unset',
      attention_flags: {
        billing_unset: true,
        has_field_edits: false,
        has_active_deficiencies: false,
        has_job_comment: false,
        needs_attention: true,
      },
    })
    expect(runReviewLocationCellTone(ws, MONTH)).toBe('on_hold')
    expect(runReviewLocationCellClass('on_hold')).toBe('run-details-review-location-cell--on-hold')
    expect(runReviewOutcomeHeadline(ws, MONTH)).toBe(OFFICE_OUTCOME_ON_HOLD_LABEL)
    expect(runReviewOutcomeIconKind(ws, MONTH)).toBe('on_hold')
  })

  it('shows orange annual styling for June run review when tech submitted no outcome', () => {
    const ws = runDetailLocationAsWorksheetLocation({
      location_id: 500,
      location_label: '500 Fort Street',
      stop_number: 7,
      display_address: '500 Fort Street',
      label: null,
      month_date: JUNE_MONTH,
      result_status: null,
      test_outcome: null,
      annual_month: 'June',
      run_comments: null,
      testing_procedures: null,
      inspection_tech_notes: null,
      has_field_edits: false,
      review_kind: 'with_changes',
      deficiency_summaries: [],
      has_active_deficiencies: false,
      billing_status: 'unset',
      attention_flags: {
        billing_unset: true,
        has_field_edits: false,
        has_active_deficiencies: false,
        has_job_comment: false,
        needs_attention: true,
      },
    })
    expect(runReviewLocationCellTone(ws, JUNE_MONTH)).toBe('annual')
    expect(runReviewLocationCellClass('annual')).toBe('run-details-review-location-cell--annual')
    expect(runReviewLocationResultCardClass('annual')).toBe(
      'run-details-review-location-result-card--annual',
    )
    expect(runReviewOutcomeHeadline(ws, JUNE_MONTH)).toBe(OFFICE_OUTCOME_SKIPPED_ANNUAL_LABEL)
    expect(runReviewOutcomeIconKind(ws, JUNE_MONTH)).toBe('annual')
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
