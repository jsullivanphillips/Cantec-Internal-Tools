import { describe, expect, it } from 'vitest'
import type { MonthlyRunDetailLocation } from './monthlyRoutesShared'
import {
  computeRunDetailsPrepSummary,
  filterRunDetailLocations,
  locationIdentityTone,
  patchRunDetailLocationBilling,
} from './runDetailsLocationReview'
import { runReviewOutcomeBadgeClass, runReviewOutcomeIconKind } from './officeRunReviewShared'

const MONTH = '2026-05-01'

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
    const ws = {
      ...location.stops[0],
      building_name: null,
      property_management_company: null,
      ring: null,
      key_number: null,
      door_code: null,
      panel: null,
      panel_location: null,
      monitoring_company: null,
      monitoring_notes: null,
      time_in: null,
      time_out: null,
      skip_category: null,
      skip_note: null,
    }
    expect(locationIdentityTone(location, MONTH)).toBe('annual')
    expect(runReviewOutcomeBadgeClass(ws, MONTH)).toBe('run-detail-site-card__badge--annual')
    expect(runReviewOutcomeIconKind(ws, MONTH)).toBe('annual')
  })

  it('maps portal outcomes to run-review icon kinds', () => {
    const base = {
      testing_site_id: 1,
      location_id: 101,
      stop_number: 1,
      display_address: '123 Main St',
      month_date: MONTH,
      result_status: 'tested' as const,
      annual_month: null,
      run_comments: null,
      testing_procedures: null,
      inspection_tech_notes: null,
      building_name: null,
      property_management_company: null,
      ring: null,
      key_number: null,
      door_code: null,
      panel: null,
      panel_location: null,
      monitoring_company: null,
      monitoring_notes: null,
      time_in: null,
      time_out: null,
      skip_reason: null,
      skip_category: null,
      skip_note: null,
    }
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
