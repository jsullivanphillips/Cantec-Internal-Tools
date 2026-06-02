import { describe, expect, it } from 'vitest'
import type { MonthlyRunDetailLocation, TechnicianWorksheetStop } from './monthlyRoutesShared'
import {
  computeRunDetailsPrepSummary,
  countSubmittedLocations,
  countRunDetailFieldEditLocations,
  filterRunDetailFieldEditLocations,
  filterRunDetailLocations,
  flattenRunDetailReviewRows,
  stopHasNewCommentField,
  locationHasAllStopsSubmitted,
  locationIdentityTone,
  patchRunDetailLocationBilling,
  patchRunDetailPreRunMessage,
  patchRunDetailLocationStop,
  stopHasSubmittedTestResult,
} from './runDetailsLocationReview'
import { runReviewOutcomeBadgeClass, runReviewOutcomeIconKind } from './officeRunReviewShared'

const MONTH = '2026-05-01'

function worksheetStop(overrides: Partial<TechnicianWorksheetStop> = {}): TechnicianWorksheetStop {
  return {
    testing_site_id: 1,
    location_id: 101,
    history_month_row_id: 1,
    month_date: MONTH,
    display_address: '123 Main St',
    building_name: null,
    property_management_company: null,
    label: null,
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
    billing_status: 'unset',
    first_stop_number: 1,
    last_stop_number: 1,
    attention_flags: {
      billing_unset: true,
      has_field_edits: false,
      has_active_deficiencies: false,
      has_job_comment: false,
      needs_attention: true,
    },
    stops: [
      {
        testing_site_id: 1,
        location_id: 101,
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
      },
    ],
    ...overrides,
  }
}

describe('computeRunDetailsPrepSummary', () => {
  it('counts stops, locations, multi-site locations, and open deficiencies', () => {
    const locations: MonthlyRunDetailLocation[] = [
      baseLocation({
        stops: [
          {
            testing_site_id: 1,
            location_id: 101,
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
            deficiency_summaries: [{ id: 1, title: 'Bell', severity: 'deficient', status: 'new' }],
            has_active_deficiencies: true,
          },
          {
            testing_site_id: 2,
            location_id: 101,
            stop_number: 2,
            display_address: '123 Main St',
            label: 'Annex',
            month_date: MONTH,
            result_status: null,
            test_outcome: 'all_good',
            annual_month: null,
            run_comments: null,
            testing_procedures: null,
            inspection_tech_notes: null,
            has_field_edits: false,
            review_kind: 'tested_only',
            deficiency_summaries: [{ id: 2, title: 'Horn', severity: 'deficient', status: 'fixed' }],
            has_active_deficiencies: false,
          },
        ],
      }),
      baseLocation({ location_id: 102, location_label: '456 Oak Ave' }),
    ]
    const summary = computeRunDetailsPrepSummary(locations)
    expect(summary.stopCount).toBe(3)
    expect(summary.locationCount).toBe(2)
    expect(summary.multiSiteLocationCount).toBe(1)
    expect(summary.openDeficiencyCount).toBe(1)
  })
})

describe('patchRunDetailLocationBilling', () => {
  it('clears billing_unset and needs_attention when setting bill on a clean stop', () => {
    const locations = [baseLocation()]
    const next = patchRunDetailLocationBilling(locations, 101, 'bill', MONTH)
    expect(next[0].billing_status).toBe('bill')
    expect(next[0].attention_flags.billing_unset).toBe(false)
    expect(next[0].attention_flags.needs_attention).toBe(false)
  })

  it('sets billing_unset when reverting to unset', () => {
    const locations = [baseLocation({ billing_status: 'bill', attention_flags: {
      billing_unset: false,
      has_field_edits: false,
      has_active_deficiencies: false,
      has_job_comment: false,
      needs_attention: false,
    } })]
    const next = patchRunDetailLocationBilling(locations, 101, 'unset', MONTH)
    expect(next[0].attention_flags.billing_unset).toBe(true)
    expect(next[0].attention_flags.needs_attention).toBe(true)
  })

  it('keeps needs_attention when deficiencies remain after billing is decided', () => {
    const locations = [
      baseLocation({
        stops: [
          {
            testing_site_id: 1,
            location_id: 101,
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
            deficiency_summaries: [{ id: 1, title: 'Bell', severity: 'deficient', status: 'new' }],
            has_active_deficiencies: true,
          },
        ],
        attention_flags: {
          billing_unset: true,
          has_field_edits: false,
          has_active_deficiencies: true,
          has_job_comment: false,
          needs_attention: true,
        },
      }),
    ]
    const next = patchRunDetailLocationBilling(locations, 101, 'bill', MONTH)
    expect(next[0].attention_flags.billing_unset).toBe(false)
    expect(next[0].attention_flags.needs_attention).toBe(true)
    expect(next[0].attention_flags.has_active_deficiencies).toBe(true)
  })

  it('does not modify other locations', () => {
    const other = baseLocation({ location_id: 102, location_label: 'Other' })
    const locations = [baseLocation(), other]
    const next = patchRunDetailLocationBilling(locations, 101, 'do_not_bill', MONTH)
    expect(next[1].billing_status).toBe('unset')
  })
})

describe('patchRunDetailPreRunMessage', () => {
  it('normalizes empty text to null', () => {
    const run = {
      id: 1,
      monthly_route_id: 1,
      month_date: MONTH,
      status: 'open',
      opened_at: null,
      started_at: null,
      completed_at: null,
      source: 'office_manual',
      is_historical: false,
      pre_run_message: 'old',
    }
    expect(patchRunDetailPreRunMessage(run, '  hello  ').pre_run_message).toBe('hello')
    expect(patchRunDetailPreRunMessage(run, '   ').pre_run_message).toBeNull()
  })
})

describe('patchRunDetailLocationStop', () => {
  it('updates office_attention on the matching stop only', () => {
    const locations = [baseLocation()]
    const next = patchRunDetailLocationStop(locations, 1, MONTH, { office_attention: true })
    expect(next[0].stops[0].office_attention).toBe(true)
  })

  it('recomputes has_job_comment when run_comments changes', () => {
    const locations = [baseLocation()]
    const next = patchRunDetailLocationStop(locations, 1, MONTH, {
      run_comments: 'Battery bad',
    })
    expect(next[0].stops[0].run_comments).toBe('Battery bad')
    expect(next[0].attention_flags.has_job_comment).toBe(true)
  })
})

describe('locationIdentityTone', () => {
  it('uses annual orange tone for skipped annual stops', () => {
    const location = baseLocation({
      stops: [
        {
          testing_site_id: 2,
          location_id: 101,
          stop_number: 1,
          display_address: '123 Main St',
          label: null,
          month_date: MONTH,
          result_status: 'skipped',
          test_outcome: 'skipped',
          skip_reason: 'annual',
          annual_month: 'May',
          run_comments: null,
          testing_procedures: null,
          inspection_tech_notes: null,
          has_field_edits: false,
          review_kind: 'tested_only',
          deficiency_summaries: [],
          has_active_deficiencies: false,
        },
      ],
    })
    const stop = location.stops[0]
    const ws = worksheetStop({
      testing_site_id: stop.testing_site_id,
      location_id: stop.location_id,
      stop_number: stop.stop_number,
      display_address: stop.display_address,
      label: stop.label,
      month_date: stop.month_date,
      result_status: stop.result_status,
      test_outcome: stop.test_outcome,
      skip_reason: stop.skip_reason ?? null,
      annual_month: stop.annual_month,
      run_comments: stop.run_comments,
      testing_procedures: stop.testing_procedures,
      inspection_tech_notes: stop.inspection_tech_notes,
      skip_category: stop.skip_category ?? null,
      skip_note: stop.skip_note ?? null,
    })
    expect(locationIdentityTone(location, MONTH)).toBe('annual')
    expect(runReviewOutcomeBadgeClass(ws, MONTH)).toBe('run-detail-site-card__badge--annual')
    expect(runReviewOutcomeIconKind(ws, MONTH)).toBe('annual')
  })

  it('maps portal outcomes to run-review icon kinds', () => {
    const base = worksheetStop({ result_status: 'tested' })
    expect(runReviewOutcomeIconKind({ ...base, test_outcome: 'all_good' }, MONTH)).toBe('all_good')
    expect(runReviewOutcomeIconKind({ ...base, test_outcome: 'failed' }, MONTH)).toBe('failed')
    expect(
      runReviewOutcomeIconKind({ ...base, test_outcome: 'passed_with_problems' }, MONTH),
    ).toBe('passed_with_problems')
  })
})

describe('filterRunDetailLocations all_good', () => {
  it('includes legacy tested stops without test_outcome', () => {
    const locations = [
      baseLocation({
        stops: [
          {
            ...baseLocation().stops[0],
            result_status: 'tested',
            test_outcome: null,
          },
        ],
      }),
    ]
    expect(filterRunDetailLocations(locations, 'all_good', MONTH)).toHaveLength(1)
  })

  it('excludes stops with explicit failed or passed_with_problems outcomes', () => {
    const failed = baseLocation({
      location_id: 201,
      location_label: 'Failed site',
      stops: [{ ...baseLocation().stops[0], test_outcome: 'failed', result_status: 'tested' }],
    })
    const pwp = baseLocation({
      location_id: 202,
      location_label: 'PWP site',
      stops: [
        {
          ...baseLocation().stops[0],
          test_outcome: 'passed_with_problems',
          result_status: 'tested',
        },
      ],
    })
    const allGood = baseLocation({
      location_id: 203,
      location_label: 'Good site',
      stops: [{ ...baseLocation().stops[0], test_outcome: 'all_good' }],
    })
    const filtered = filterRunDetailLocations([failed, pwp, allGood], 'all_good', MONTH)
    expect(filtered.map((l) => l.location_id)).toEqual([203])
  })
})

describe('submitted filter', () => {
  it('stopHasSubmittedTestResult accepts portal test_outcome', () => {
    const stop = worksheetStop({ test_outcome: 'all_good', result_status: null })
    expect(stopHasSubmittedTestResult(stop)).toBe(true)
  })

  it('stopHasSubmittedTestResult accepts legacy tested/skipped', () => {
    expect(stopHasSubmittedTestResult(worksheetStop({ result_status: 'tested' }))).toBe(true)
    expect(stopHasSubmittedTestResult(worksheetStop({ result_status: 'skipped' }))).toBe(true)
  })

  it('stopHasSubmittedTestResult rejects pending and annual-month-only', () => {
    expect(stopHasSubmittedTestResult(worksheetStop())).toBe(false)
    expect(
      stopHasSubmittedTestResult(worksheetStop({ annual_month: 'May', result_status: null })),
    ).toBe(false)
  })

  it('includes single-stop location with test_outcome under submitted filter', () => {
    const loc = baseLocation()
    expect(locationHasAllStopsSubmitted(loc)).toBe(true)
    expect(filterRunDetailLocations([loc], 'submitted', MONTH)).toHaveLength(1)
    expect(countSubmittedLocations([loc])).toBe(1)
  })

  it('excludes multi-stop location when any stop is still pending', () => {
    const loc = baseLocation({
      stops: [
        { ...baseLocation().stops[0], testing_site_id: 1, test_outcome: 'all_good' },
        {
          ...baseLocation().stops[0],
          testing_site_id: 2,
          test_outcome: null,
          result_status: null,
        },
      ],
    })
    expect(locationHasAllStopsSubmitted(loc)).toBe(false)
    expect(filterRunDetailLocations([loc], 'submitted', MONTH)).toHaveLength(0)
  })

  it('includes multi-stop location when every stop has submitted results', () => {
    const loc = baseLocation({
      stops: [
        { ...baseLocation().stops[0], testing_site_id: 1, test_outcome: 'all_good' },
        {
          ...baseLocation().stops[0],
          testing_site_id: 2,
          test_outcome: 'skipped',
          skip_category: 'other',
        },
      ],
    })
    expect(locationHasAllStopsSubmitted(loc)).toBe(true)
    expect(filterRunDetailLocations([loc], 'submitted', MONTH)).toHaveLength(1)
  })

  it('includes legacy tested stop without test_outcome', () => {
    const loc = baseLocation({
      stops: [{ ...baseLocation().stops[0], result_status: 'tested', test_outcome: null }],
    })
    expect(filterRunDetailLocations([loc], 'submitted', MONTH)).toHaveLength(1)
  })

  it('excludes annual-month-only stop without outcome', () => {
    const loc = baseLocation({
      stops: [
        {
          ...baseLocation().stops[0],
          annual_month: 'May',
          result_status: null,
          test_outcome: null,
        },
      ],
    })
    expect(filterRunDetailLocations([loc], 'submitted', MONTH)).toHaveLength(0)
  })
})

describe('stopHasNewCommentField', () => {
  it('returns true when field is listed in new_comment_fields', () => {
    const stop = {
      ...baseLocation().stops[0],
      new_comment_fields: ['run_comments', 'testing_procedures'],
    }
    expect(stopHasNewCommentField(stop, 'run_comments')).toBe(true)
    expect(stopHasNewCommentField(stop, 'testing_procedures')).toBe(true)
    expect(stopHasNewCommentField(stop, 'inspection_tech_notes')).toBe(false)
  })

  it('returns false when new_comment_fields is missing or empty', () => {
    const stop = baseLocation().stops[0]
    expect(stopHasNewCommentField(stop, 'run_comments')).toBe(false)
  })
})

describe('flattenRunDetailReviewRows', () => {
  it('flattens stops in route order with billing on each row', () => {
    const locations = [
      baseLocation({
        location_id: 101,
        first_stop_number: 1,
        billing_status: 'bill',
        stops: [
          { ...baseLocation().stops[0], testing_site_id: 1, stop_number: 1 },
          { ...baseLocation().stops[0], testing_site_id: 2, stop_number: 2, label: 'Annex' },
        ],
      }),
      baseLocation({
        location_id: 102,
        location_label: '456 Oak',
        first_stop_number: 3,
        billing_status: 'unset',
        stops: [{ ...baseLocation().stops[0], testing_site_id: 3, stop_number: 3, location_id: 102 }],
      }),
    ]
    const rows = flattenRunDetailReviewRows(locations)
    expect(rows).toHaveLength(3)
    expect(rows[0].locationId).toBe(101)
    expect(rows[0].billingStatus).toBe('bill')
    expect(rows[0].siteCount).toBe(2)
    expect(rows[2].locationId).toBe(102)
    expect(rows[2].stop.stop_number).toBe(3)
  })
})

describe('filterRunDetailFieldEditLocations', () => {
  it('returns only locations flagged with field edits', () => {
    const withEdits = baseLocation({
      attention_flags: {
        billing_unset: false,
        has_field_edits: true,
        has_active_deficiencies: false,
        has_job_comment: false,
        needs_attention: false,
      },
    })
    const plain = baseLocation({ location_id: 102, location_label: '456 Oak' })
    const filtered = filterRunDetailFieldEditLocations([plain, withEdits])
    expect(filtered).toHaveLength(1)
    expect(filtered[0].location_id).toBe(101)
    expect(countRunDetailFieldEditLocations([plain, withEdits])).toBe(1)
  })
})
