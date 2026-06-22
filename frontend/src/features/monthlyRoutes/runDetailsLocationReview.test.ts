import { describe, expect, it } from 'vitest'
import type { MonthlyRunDetailLocation, MonthlyRunDetailPayload, MonthlyRouteDetailPayload, TechnicianWorksheetLocation } from './monthlyRoutesShared'
import {
  computeRunDetailsPrepSummary,
  countBillingUnsetLocations,
  countNoTestResultLocations,
  countSubmittedLocations,
  filterRunDetailLocations,
  filterRunDetailLocationsByOutcomes,
  flattenRunDetailPrepRows,
  flattenRunDetailReviewRows,
  listAutoOfficeBillingUpdates,
  patchRunDetailLocationBilling,
  patchRunDetailLocationStop,
  patchRunDetailPayloadRun,
  patchRouteMetaRunMonth,
  patchRunDetailPreRunMessage,
  patchRunDetailFieldEndSummary,
  priorMonthFieldEditsHint,
  stopHasSubmittedTestResult,
  locationHasAllStopsSubmitted,
} from './runDetailsLocationReview'

const MONTH = '2026-05-01'

function worksheetStop(overrides: Partial<TechnicianWorksheetLocation> = {}): TechnicianWorksheetLocation {
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

function baseLocation(overrides: Partial<MonthlyRunDetailLocation> = {}): MonthlyRunDetailLocation {
  return {
    location_id: 101,
    location_label: '123 Main St',
    stop_number: 1,
    display_address: '123 Main St',
    label: null,
    month_date: MONTH,
    result_status: null,
    test_outcome: 'all_good',
    annual_month: null,
    run_comments: null,
    testing_procedures: null,
    inspection_tech_notes: null,
    has_field_edits: false,
    review_kind: 'tested_only',
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
    ...overrides,
  }
}

describe('computeRunDetailsPrepSummary', () => {
  it('counts flat locations and open deficiencies', () => {
    const locations: MonthlyRunDetailLocation[] = [
      baseLocation({
        deficiency_summaries: [{ id: 1, title: 'Bell', severity: 'deficient', status: 'new' }],
        has_active_deficiencies: true,
      }),
      baseLocation({ location_id: 102, location_label: '456 Oak Ave', stop_number: 2 }),
    ]
    const summary = computeRunDetailsPrepSummary(locations)
    expect(summary.stopCount).toBe(2)
    expect(summary.locationCount).toBe(2)
    expect(summary.openDeficiencyCount).toBe(1)
  })
})

describe('patchRunDetailLocationBilling', () => {
  it('clears billing_unset when setting bill on a clean location', () => {
    const next = patchRunDetailLocationBilling([baseLocation()], 101, 'bill', MONTH)
    expect(next[0].billing_status).toBe('bill')
    expect(next[0].attention_flags.billing_unset).toBe(false)
    expect(next[0].attention_flags.needs_attention).toBe(false)
  })

  it('does not modify other locations', () => {
    const other = baseLocation({ location_id: 102, location_label: 'Other', stop_number: 2 })
    const next = patchRunDetailLocationBilling([baseLocation(), other], 101, 'do_not_bill', MONTH)
    expect(next[1].billing_status).toBe('unset')
  })
})

describe('flattenRunDetailPrepRows', () => {
  it('sorts by stop_number and wraps locations', () => {
    const rows = flattenRunDetailPrepRows([
      baseLocation({ location_id: 2, stop_number: 2 }),
      baseLocation({ location_id: 1, stop_number: 1 }),
    ])
    expect(rows.map((r) => r.location.location_id)).toEqual([1, 2])
  })
})

describe('flattenRunDetailReviewRows', () => {
  it('includes open ticket counts from attention flags', () => {
    const rows = flattenRunDetailReviewRows([
      baseLocation({
        attention_flags: {
          billing_unset: false,
          has_field_edits: false,
          has_active_deficiencies: false,
          has_job_comment: false,
          needs_attention: false,
          open_tickets: 3,
        },
      }),
    ])
    expect(rows[0].openTickets).toBe(3)
  })
})

describe('submission helpers', () => {
  it('stopHasSubmittedTestResult respects portal outcomes', () => {
    expect(stopHasSubmittedTestResult(worksheetStop({ test_outcome: 'all_good' }))).toBe(true)
    expect(stopHasSubmittedTestResult(worksheetStop())).toBe(false)
  })

  it('countSubmittedLocations counts flat rows', () => {
    const n = countSubmittedLocations([
      baseLocation({ result_status: 'tested', test_outcome: 'all_good' }),
      baseLocation({ location_id: 102, stop_number: 2, test_outcome: null, result_status: null }),
    ])
    expect(n).toBe(1)
  })

  it('locationHasAllStopsSubmitted aliases single-location check', () => {
    expect(locationHasAllStopsSubmitted(baseLocation({ result_status: 'tested' }))).toBe(true)
  })
})

describe('priorMonthFieldEditsHint', () => {
  it('lists edited field labels and explains they are not route order', () => {
    const hint = priorMonthFieldEditsHint({
      prior_month_field_edits: true,
      prior_month_edited_fields: ['Ring', 'Door code', 'Testing procedures'],
    })
    expect(hint?.title).toBe('Edited last month')
    expect(hint?.detail).toBe('Ring · Door code · Testing procedures')
    expect(hint?.tooltip).toContain('Route stop order')
    expect(hint?.tooltip).toContain('Ring')
  })

  it('returns null when the location was not edited last month', () => {
    expect(priorMonthFieldEditsHint({ prior_month_field_edits: false })).toBeNull()
  })
})

describe('listAutoOfficeBillingUpdates', () => {
  it('suggests bill for all_good outcomes', () => {
    const updates = listAutoOfficeBillingUpdates(
      [baseLocation({ test_outcome: 'all_good', result_status: 'tested' })],
      MONTH,
    )
    expect(updates).toEqual([{ locationId: 101, billingStatus: 'bill' }])
  })

  it('suggests do_not_bill for annual skips and auto annual-month stops', () => {
    expect(
      listAutoOfficeBillingUpdates(
        [
          baseLocation({
            test_outcome: 'skipped',
            result_status: 'skipped',
            skip_category: 'annual',
            skip_reason: 'annual',
          }),
        ],
        MONTH,
      ),
    ).toEqual([{ locationId: 101, billingStatus: 'do_not_bill' }])

    expect(
      listAutoOfficeBillingUpdates(
        [baseLocation({ test_outcome: null, result_status: null, annual_month: 'May' })],
        MONTH,
      ),
    ).toEqual([{ locationId: 101, billingStatus: 'do_not_bill' }])
  })

  it('leaves generic skips unchanged for auto billing', () => {
    const updates = listAutoOfficeBillingUpdates(
      [
        baseLocation({
          test_outcome: 'skipped',
          result_status: 'skipped',
          skip_category: 'access_issues',
          skip_reason: 'access_issues',
        }),
      ],
      MONTH,
    )
    expect(updates).toEqual([])
  })
})

describe('patchRunDetailLocationStop', () => {
  it('merges partial fields onto matching location_id', () => {
    const next = patchRunDetailLocationStop(
      [baseLocation()],
      101,
      MONTH,
      { run_comments: 'Battery bad', office_attention: true },
    )
    expect(next[0].run_comments).toBe('Battery bad')
    expect(next[0].office_attention).toBe(true)
  })
})

describe('patchRunDetailPayloadRun', () => {
  it('preserves field_submission meta without stops payload', () => {
    const payload = {
      route: { id: 1, route_number: 1, weekday_iso: 1, week_occurrence: 1, label: 'Mon' },
      month_date: MONTH,
      locations: [baseLocation()],
      run: null,
      field_submission: { available: true, captured_at: '2026-05-02', field_work_reopened: false },
    }
    const next = patchRunDetailPayloadRun(payload as MonthlyRunDetailPayload, {
      monthly_route_id: 1,
      month_date: MONTH,
      is_historical: false,
      id: 9,
      source: 'technician_app',
      status: 'active',
      opened_at: null,
      started_at: null,
      completed_at: null,
      workflow_stage: 'field',
      workflow_stage_label: 'Field',
      pre_run_message: null,
    })
    expect(next.run?.id).toBe(9)
    expect(next.field_submission?.available).toBe(true)
  })
})

describe('patchRouteMetaRunMonth', () => {
  it('updates runs_by_month entry', () => {
    const meta = {
      route: { id: 1, route_number: 1, weekday_iso: 1, week_occurrence: 1, label: 'Mon' },
      runs_by_month: {},
    }
    const next = patchRouteMetaRunMonth(meta as MonthlyRouteDetailPayload, MONTH, {
      monthly_route_id: 1,
      month_date: MONTH,
      is_historical: false,
      id: 2,
      source: 'technician_app',
      status: 'active',
      opened_at: null,
      started_at: '2026-05-01',
      completed_at: null,
      workflow_stage: 'field',
      workflow_stage_label: 'Field',
      pre_run_message: null,
    })
    expect(next?.runs_by_month[MONTH]?.run_id).toBe(2)
  })
})

describe('patchRunDetailPreRunMessage', () => {
  it('trims empty pre-run text to null', () => {
    const run = patchRunDetailPreRunMessage({
        monthly_route_id: 1,
        month_date: MONTH,
        is_historical: false,
        id: 1,
        source: 'technician_app',
        status: 'active',
        opened_at: null,
        started_at: null,
        completed_at: null,
        workflow_stage: 'field',
        workflow_stage_label: 'Field',
        pre_run_message: '  ',
      },
      '  ',
    )
    expect(run.pre_run_message).toBeNull()
  })
})

describe('patchRunDetailFieldEndSummary', () => {
  it('trims empty rich text to null', () => {
    const run = patchRunDetailFieldEndSummary(
      {
        monthly_route_id: 1,
        month_date: MONTH,
        is_historical: false,
        id: 1,
        source: 'technician_app',
        status: 'active',
        opened_at: null,
        started_at: null,
        completed_at: null,
        workflow_stage: 'awaiting_office_review',
        workflow_stage_label: 'Awaiting office review',
        field_end_summary: '<p> </p>',
      },
      '<p> </p>',
    )
    expect(run.field_end_summary).toBeNull()
  })
})

describe('filterRunDetailLocations', () => {
  it('filters billing_unset locations', () => {
    const filtered = filterRunDetailLocations(
      [
        baseLocation(),
        baseLocation({
          location_id: 102,
          stop_number: 2,
          billing_status: 'bill',
          attention_flags: {
            billing_unset: false,
            has_field_edits: false,
            has_active_deficiencies: false,
            has_job_comment: false,
            needs_attention: false,
          },
        }),
      ],
      'billing_unset',
      MONTH,
    )
    expect(filtered).toHaveLength(1)
    expect(filtered[0].location_id).toBe(101)
  })
})

describe('countBillingUnsetLocations', () => {
  it('counts locations with billing_unset attention flag', () => {
    const locations = [
      baseLocation(),
      baseLocation({
        location_id: 102,
        stop_number: 2,
        billing_status: 'bill',
        attention_flags: {
          billing_unset: false,
          has_field_edits: false,
          has_active_deficiencies: false,
          has_job_comment: false,
          needs_attention: false,
        },
      }),
    ]
    expect(countBillingUnsetLocations(locations)).toBe(1)
  })
})

describe('filterRunDetailLocationsByOutcomes', () => {
  it('returns all locations when no outcome filters are selected', () => {
    const locations = [
      baseLocation({ test_outcome: 'all_good' }),
      baseLocation({ location_id: 102, stop_number: 2, test_outcome: 'failed' }),
    ]
    expect(filterRunDetailLocationsByOutcomes(locations, [], MONTH)).toHaveLength(2)
  })

  it('filters by one or more outcome filters (OR)', () => {
    const locations = [
      baseLocation({ location_id: 101, test_outcome: 'all_good' }),
      baseLocation({ location_id: 102, stop_number: 2, test_outcome: 'failed' }),
      baseLocation({ location_id: 103, stop_number: 3, test_outcome: 'skipped', result_status: 'skipped' }),
    ]
    const failedOnly = filterRunDetailLocationsByOutcomes(locations, ['failed'], MONTH)
    expect(failedOnly.map((loc) => loc.location_id)).toEqual([102])

    const failedOrSkipped = filterRunDetailLocationsByOutcomes(
      locations,
      ['failed', 'skipped'],
      MONTH,
    )
    expect(failedOrSkipped.map((loc) => loc.location_id)).toEqual([102, 103])
  })

  it('filters billing_unset together with outcome filters (OR)', () => {
    const locations = [
      baseLocation({ location_id: 101, test_outcome: 'all_good' }),
      baseLocation({
        location_id: 102,
        stop_number: 2,
        test_outcome: 'failed',
        billing_status: 'bill',
        attention_flags: {
          billing_unset: false,
          has_field_edits: false,
          has_active_deficiencies: false,
          has_job_comment: false,
          needs_attention: false,
        },
      }),
      baseLocation({
        location_id: 103,
        stop_number: 3,
        test_outcome: 'all_good',
        billing_status: 'bill',
        attention_flags: {
          billing_unset: false,
          has_field_edits: false,
          has_active_deficiencies: false,
          has_job_comment: false,
          needs_attention: false,
        },
      }),
    ]
    const filtered = filterRunDetailLocationsByOutcomes(locations, ['billing_unset', 'failed'], MONTH)
    expect(filtered.map((loc) => loc.location_id)).toEqual([101, 102])
  })

  it('filters no_test_result stops without a recorded outcome', () => {
    const locations = [
      baseLocation({ location_id: 101, test_outcome: 'all_good' }),
      baseLocation({ location_id: 102, stop_number: 2, test_outcome: null, result_status: null }),
      baseLocation({
        location_id: 103,
        stop_number: 3,
        test_outcome: null,
        result_status: null,
        annual_month: 'May',
      }),
    ]
    const filtered = filterRunDetailLocationsByOutcomes(locations, ['no_test_result'], MONTH)
    expect(filtered.map((loc) => loc.location_id)).toEqual([102])
    expect(countNoTestResultLocations(locations, MONTH)).toBe(1)
  })
})
