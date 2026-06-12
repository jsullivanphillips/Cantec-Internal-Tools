import { describe, expect, it } from 'vitest'
import type { TechnicianWorksheetLocation } from './monthlyRoutesShared'
import {
  formatSkipReasonDisplayText,
  portalSkipReasonDetail,
  portalStopActiveDeficiencies,
  portalStopCanChooseAllGood,
  portalStopCanReset,
  portalStopDockBand,
  optimisticClockInPatch,
  portalStopHasOpenClock,
  portalStopNeedsDeficiencyVerify,
  portalStopNeedsNoDeficiencyConfirm,
  portalStopNewDeficiencies,
  portalStopNewDeficienciesFromPriorRuns,
  officeOutcomeSelectValue,
  OFFICE_OUTCOME_ON_HOLD_VALUE,
  OFFICE_OUTCOME_PENDING_VALUE,
  OFFICE_OUTCOME_SKIPPED_ANNUAL_LABEL,
  OFFICE_OUTCOME_SKIPPED_ANNUAL_VALUE,
  portalHeaderBandClass,
  portalKeyViewOutcomeStatusClass,
  portalNavStopStatusClass,
  portalStatusPillClass,
  portalStopVisitComplete,
  portalStopVisualTone,
} from './portalWorkflowShared'
import {
  runReviewOutcomeHeadline,
  runReviewSkippedCategoryHeadline,
  runReviewSkippedTechNote,
} from './officeRunReviewShared'
import type { PortalDeficiencySummary } from './portalWorkflowShared'

function baseStop(overrides: Partial<TechnicianWorksheetLocation> = {}): TechnicianWorksheetLocation {
  return {
    location_id: 1,
    location_month_row_id: 0,
    month_date: '2026-05-01',
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

describe('portalStopHasOpenClock', () => {
  it('detects open clock_events row', () => {
    const stop = baseStop({
      clock_events: [{ id: 1, sort_order: 1, time_in: '9:00 AM', time_out: null }],
    })
    expect(portalStopHasOpenClock(stop)).toBe(true)
  })

  it('returns false when visit has outcome and closed clocks', () => {
    const stop = baseStop({
      test_outcome: 'all_good',
      clock_events: [{ id: 1, sort_order: 1, time_in: '9:00 AM', time_out: '9:30 AM' }],
    })
    expect(portalStopHasOpenClock(stop)).toBe(false)
    expect(portalStopVisitComplete(stop)).toBe(true)
  })

  it('stays open when outcome saved but clock event still open', () => {
    const stop = baseStop({
      test_outcome: 'all_good',
      result_status: 'tested',
      clock_events: [{ id: 1, sort_order: 1, time_in: '9:00 AM', time_out: null }],
    })
    expect(portalStopHasOpenClock(stop)).toBe(true)
    expect(portalStopVisitComplete(stop)).toBe(false)
    expect(portalStopDockBand(stop, false)).toBe('B')
  })
})

describe('portalStopDockBand', () => {
  it('band A when not clocked in and visit incomplete', () => {
    const stop = baseStop()
    expect(portalStopDockBand(stop, false)).toBe('A')
  })

  it('band B when clocked in on this stop', () => {
    const stop = baseStop({
      clock_events: [{ id: 1, sort_order: 1, time_in: '9:00 AM', time_out: null }],
    })
    expect(portalStopDockBand(stop, false)).toBe('B')
  })

  it('band C when outcome set and no open clock', () => {
    const stop = baseStop({
      test_outcome: 'failed',
      clock_events: [{ id: 1, sort_order: 1, time_in: '9:00 AM', time_out: '9:30 AM' }],
    })
    expect(portalStopDockBand(stop, true)).toBe('C')
  })

  it('band C even if clocked in elsewhere', () => {
    const stop = baseStop({
      test_outcome: 'all_good',
      clock_events: [],
    })
    expect(portalStopDockBand(stop, true)).toBe('C')
  })
})

function def(status: string, id = 1, createdRunId: number | null = 1): PortalDeficiencySummary {
  return {
    id,
    monthly_location_id: 1,
    created_run_id: createdRunId,
    title: 'Bell',
    severity: 'deficient',
    status,
    description: null,
    verification_notes: null,
  }
}

describe('deficiency outcome helpers', () => {
  it('blocks All good when New or Verified deficiencies exist', () => {
    const withNew = baseStop({ deficiencies: [def('new')] })
    const withVerified = baseStop({ deficiencies: [def('verified', 2)] })
    const hidden = baseStop({ deficiencies: [def('invalid', 3)] })
    expect(portalStopCanChooseAllGood(withNew)).toBe(false)
    expect(portalStopCanChooseAllGood(withVerified)).toBe(false)
    expect(portalStopCanChooseAllGood(hidden)).toBe(true)
    expect(portalStopActiveDeficiencies(withNew)).toHaveLength(1)
    expect(portalStopNewDeficiencies(withNew)).toHaveLength(1)
  })

  it('requires verify step for passed_with_problems / failed when prior-run New exist', () => {
    const stop = baseStop({ deficiencies: [def('new', 1, 99)] })
    expect(portalStopNeedsDeficiencyVerify('passed_with_problems', stop, 1)).toBe(true)
    expect(portalStopNeedsDeficiencyVerify('failed', stop, 1)).toBe(true)
    expect(portalStopNeedsDeficiencyVerify('all_good', stop, 1)).toBe(false)
  })

  it('skips verify step for deficiencies logged on the active run', () => {
    const stop = baseStop({ deficiencies: [def('new', 1, 1)] })
    expect(portalStopNewDeficienciesFromPriorRuns(stop, 1)).toHaveLength(0)
    expect(portalStopNeedsDeficiencyVerify('passed_with_problems', stop, 1)).toBe(false)
    expect(portalStopNeedsDeficiencyVerify('failed', stop, 1)).toBe(false)
  })

  it('requires no-deficiency confirm for passed_with_problems with zero active', () => {
    const stop = baseStop({ deficiencies: [def('fixed')] })
    expect(portalStopNeedsNoDeficiencyConfirm('passed_with_problems', stop)).toBe(true)
    expect(portalStopNeedsNoDeficiencyConfirm('failed', stop)).toBe(false)
  })
})

describe('portalSkipReasonDetail', () => {
  it('joins category, note, and legacy skip_reason', () => {
    const stop = baseStop({
      test_outcome: 'skipped',
      skip_category: 'access_issues',
      skip_note: 'Gate code changed',
      skip_reason: 'access_issues: Gate code changed',
    })
    expect(portalSkipReasonDetail(stop)).toBe('Access issues · Gate code changed')
    expect(runReviewSkippedCategoryHeadline(stop)).toBe('Access issues')
    expect(runReviewSkippedTechNote(stop)).toBe('Gate code changed')
    expect(runReviewOutcomeHeadline(stop, '2026-05-01')).toBe('Access issues')
  })

  it('uses legacy skip_reason when portal fields are empty', () => {
    const stop = baseStop({
      test_outcome: 'skipped',
      skip_reason: 'No power to panel',
    })
    expect(portalSkipReasonDetail(stop)).toBe('No power to panel')
    expect(runReviewOutcomeHeadline(stop, '2026-05-01')).toBe('No power to panel')
  })

  it('formats category keys in skip_reason', () => {
    expect(formatSkipReasonDisplayText('lack_of_time')).toBe('Lack of time')
    expect(formatSkipReasonDisplayText('lack_of_time: Ran out of daylight')).toBe(
      'Lack of time · Ran out of daylight',
    )
  })

  it('passed_with_problems uses a distinct visual tone from annual', () => {
    const passedProblems = baseStop({ test_outcome: 'passed_with_problems' })
    expect(portalStopVisualTone(passedProblems, '2026-05-01')).toBe('passed_with_problems')
    expect(portalStatusPillClass(passedProblems, '2026-05-01')).toBe('passed-problems')
    expect(portalHeaderBandClass(passedProblems, '2026-05-01')).toBe(
      'pw-mock-header--passed-problems',
    )

    const annualDue = baseStop({ annual_month: 'May' })
    expect(portalStopVisualTone(annualDue, '2026-05-01')).toBe('annual')
    expect(portalStatusPillClass(annualDue, '2026-05-01')).toBe('pending')
  })
})

describe('portalStopVisualTone', () => {
  it('ignores stray result_status unless is_legacy_outcome', () => {
    const stop = baseStop({ result_status: 'tested' })
    expect(portalStopVisualTone(stop, '2026-05-01')).toBe('pending')
    expect(portalNavStopStatusClass(stop, '2026-05-01')).toBe('')

    const legacy = baseStop({ result_status: 'tested', is_legacy_outcome: true })
    expect(portalStopVisualTone(legacy, '2026-05-01')).toBe('all_good')
    expect(portalNavStopStatusClass(legacy, '2026-05-01')).toBe('pw-mock-nav-stop--tested')
  })
})

describe('officeOutcomeSelectValue', () => {
  it('maps legacy tested/skipped result_status when test_outcome is unset', () => {
    expect(
      officeOutcomeSelectValue(baseStop({ result_status: 'tested', is_legacy_outcome: true })),
    ).toBe('all_good')
    expect(
      officeOutcomeSelectValue(baseStop({ result_status: 'skipped', is_legacy_outcome: true })),
    ).toBe('skipped')
    expect(officeOutcomeSelectValue(baseStop({ result_status: 'tested' }))).toBe('all_good')
  })

  it('prefers portal test_outcome over legacy result_status', () => {
    expect(
      officeOutcomeSelectValue(
        baseStop({ test_outcome: 'failed', result_status: 'tested', is_legacy_outcome: false }),
      ),
    ).toBe('failed')
  })

  it('returns pending when no outcome is recorded', () => {
    expect(officeOutcomeSelectValue(baseStop())).toBe(OFFICE_OUTCOME_PENDING_VALUE)
  })

  it('maps auto annual-month stops without an outcome to the office annual select value', () => {
    expect(
      officeOutcomeSelectValue(baseStop({ annual_month: 'May' })),
    ).toBe(OFFICE_OUTCOME_SKIPPED_ANNUAL_VALUE)
    expect(runReviewOutcomeHeadline(baseStop({ annual_month: 'May' }), '2026-05-01')).toBe(
      OFFICE_OUTCOME_SKIPPED_ANNUAL_LABEL,
    )
  })

  it('maps on-hold stops without an outcome to the office on-hold select value', () => {
    expect(
      officeOutcomeSelectValue(baseStop({ status_normalized: 'on_hold' })),
    ).toBe(OFFICE_OUTCOME_ON_HOLD_VALUE)
  })

  it('maps annual skips to the office annual select value', () => {
    expect(
      officeOutcomeSelectValue(
        baseStop({
          test_outcome: 'skipped',
          result_status: 'skipped',
          skip_category: 'annual',
          skip_reason: 'annual',
        }),
      ),
    ).toBe(OFFICE_OUTCOME_SKIPPED_ANNUAL_VALUE)
    expect(
      officeOutcomeSelectValue(
        baseStop({
          test_outcome: 'skipped',
          result_status: 'skipped',
          skip_category: 'access_issues',
          skip_reason: 'access_issues',
        }),
      ),
    ).toBe('skipped')
  })
})

describe('portalStopCanReset', () => {
  it('is true immediately after optimistic clock-in', () => {
    const stop = baseStop()
    const patched = { ...stop, ...optimisticClockInPatch(stop, '9:00 AM') }
    expect(patched.has_run_changes).toBe(true)
    expect(portalStopCanReset(patched)).toBe(true)
  })

  it('is true when an open clock is present', () => {
    const stop = baseStop({
      clock_events: [{ id: 1, sort_order: 1, time_in: '9:00 AM', time_out: null }],
    })
    expect(portalStopCanReset(stop)).toBe(true)
  })
})

describe('portalKeyViewOutcomeStatusClass', () => {
  it('returns no class for pending stops', () => {
    expect(portalKeyViewOutcomeStatusClass(baseStop())).toBe('')
    expect(
      portalKeyViewOutcomeStatusClass(baseStop({ annual_month: 'May', result_status: null })),
    ).toBe('')
    expect(
      portalKeyViewOutcomeStatusClass(baseStop({ office_attention: true })),
    ).toBe('')
  })

  it('maps portal test outcomes to key view classes', () => {
    expect(
      portalKeyViewOutcomeStatusClass(baseStop({ test_outcome: 'all_good' })),
    ).toBe('pw-key-view-item--tested')
    expect(
      portalKeyViewOutcomeStatusClass(baseStop({ test_outcome: 'passed_with_problems' })),
    ).toBe('pw-key-view-item--passed-problems')
    expect(
      portalKeyViewOutcomeStatusClass(baseStop({ test_outcome: 'failed' })),
    ).toBe('pw-key-view-item--failed')
    expect(
      portalKeyViewOutcomeStatusClass(baseStop({ test_outcome: 'skipped' })),
    ).toBe('pw-key-view-item--skipped')
  })

  it('maps legacy outcomes', () => {
    expect(
      portalKeyViewOutcomeStatusClass(
        baseStop({ is_legacy_outcome: true, result_status: 'tested' }),
      ),
    ).toBe('pw-key-view-item--tested')
    expect(
      portalKeyViewOutcomeStatusClass(
        baseStop({ is_legacy_outcome: true, result_status: 'skipped' }),
      ),
    ).toBe('pw-key-view-item--skipped')
  })
})

describe('portalStopOfficeAttention', () => {
  it('shows purple nav class until a test outcome is recorded', () => {
    const flagged = baseStop({ office_attention: true })
    expect(portalNavStopStatusClass(flagged, '2026-05-01')).toBe('pw-mock-nav-stop--office-attention')
    expect(portalHeaderBandClass(flagged, '2026-05-01')).toBe('pw-mock-header--office-attention')

    const done = baseStop({ office_attention: true, test_outcome: 'skipped' })
    expect(portalNavStopStatusClass(done, '2026-05-01')).toBe('pw-mock-nav-stop--skipped')
    expect(portalHeaderBandClass(done, '2026-05-01')).toBe('pw-mock-header--skipped')
  })
})

describe('portalStopOnHold', () => {
  it('shows yellow nav/header styling until a test outcome is recorded', () => {
    const onHold = baseStop({ status_normalized: 'on_hold' })
    expect(portalNavStopStatusClass(onHold, '2026-05-01')).toBe('pw-mock-nav-stop--on-hold')
    expect(portalHeaderBandClass(onHold, '2026-05-01')).toBe('pw-mock-header--on-hold')

    const done = baseStop({ status_normalized: 'on_hold', test_outcome: 'all_good' })
    expect(portalNavStopStatusClass(done, '2026-05-01')).toBe('pw-mock-nav-stop--tested')
    expect(portalHeaderBandClass(done, '2026-05-01')).toBe('pw-mock-header--tested')
  })
})
