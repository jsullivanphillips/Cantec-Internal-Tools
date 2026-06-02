import { describe, expect, it } from 'vitest'
import type { TechnicianWorksheetStop } from './monthlyRoutesShared'
import {
  formatSkipReasonDisplayText,
  portalSkipReasonDetail,
  portalStopActiveDeficiencies,
  portalStopCanChooseAllGood,
  portalStopDockBand,
  portalStopHasOpenClock,
  portalStopNeedsDeficiencyVerify,
  portalStopNeedsNoDeficiencyConfirm,
  portalStopNewDeficiencies,
  portalStopNewDeficienciesFromPriorRuns,
  portalHeaderBandClass,
  portalStatusPillClass,
  portalStopVisitComplete,
  portalStopVisualTone,
} from './portalWorkflowShared'
import { runReviewOutcomeHeadline } from './officeRunReviewShared'
import type { PortalDeficiencySummary } from './portalWorkflowShared'

function baseStop(overrides: Partial<TechnicianWorksheetStop> = {}): TechnicianWorksheetStop {
  return {
    testing_site_id: 1,
    location_id: 1,
    stop_number: 1,
    display_address: 'Test',
    month_date: '2026-05-01',
    history_month_row_id: 0,
    route_stop_order: null,
    session_route_stop_order: null,
    version_updated_at: null,
    building_name: null,
    property_management_company: null,
    label: null,
    ring: null,
    key_number: null,
    annual_month: null,
    door_code: null,
    panel: null,
    panel_location: null,
    monitoring_company: null,
    monitoring_notes: null,
    testing_procedures: null,
    inspection_tech_notes: null,
    run_comments: null,
    time_in: null,
    time_out: null,
    result_status: null,
    skip_reason: null,
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
    monthly_testing_site_id: 1,
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
  })

  it('uses legacy skip_reason when portal fields are empty', () => {
    const stop = baseStop({
      test_outcome: 'skipped',
      skip_reason: 'No power to panel',
    })
    expect(portalSkipReasonDetail(stop)).toBe('No power to panel')
    expect(runReviewOutcomeHeadline(stop, '2026-05-01')).toBe('Skipped · No power to panel')
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
