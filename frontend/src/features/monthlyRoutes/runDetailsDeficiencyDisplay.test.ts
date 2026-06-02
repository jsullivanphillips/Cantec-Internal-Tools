import { describe, expect, it } from 'vitest'
import type { TechnicianWorksheetRun } from './monthlyRoutesShared'
import {
  deficiencyOnRunForReview,
  openDeficiencySummaries,
  runReviewDeficiencySummaries,
  stopShowsNoDeficienciesConfirmedPill,
} from './runDetailsDeficiencyDisplay'

const RUN: TechnicianWorksheetRun = {
  id: 9001,
  monthly_route_id: 1,
  month_date: '2026-05-01',
  status: 'open',
  opened_at: null,
  started_at: '2026-05-02T08:00:00-07:00',
  field_ended_at: '2026-05-02T16:00:00-07:00',
  completed_at: null,
  source: 'technician_app',
  is_historical: false,
}

describe('stopShowsNoDeficienciesConfirmedPill', () => {
  const pwpConfirmed = {
    test_outcome: 'passed_with_problems',
    confirmed_no_deficiencies: true,
  }

  it('shows when passed with problems and no active deficiencies', () => {
    expect(stopShowsNoDeficienciesConfirmedPill(pwpConfirmed, 0)).toBe(true)
  })

  it('hides when active deficiencies exist even if flag is still set', () => {
    expect(stopShowsNoDeficienciesConfirmedPill(pwpConfirmed, 1)).toBe(false)
  })

  it('hides for other outcomes', () => {
    expect(
      stopShowsNoDeficienciesConfirmedPill(
        { test_outcome: 'all_good', confirmed_no_deficiencies: true },
        0,
      ),
    ).toBe(false)
  })

  it('counts open deficiencies from summaries', () => {
    const open = openDeficiencySummaries([
      { id: 1, title: 'Bell', severity: 'deficient', status: 'new' },
      { id: 2, title: 'Fixed horn', severity: 'deficient', status: 'fixed' },
    ])
    expect(
      stopShowsNoDeficienciesConfirmedPill(pwpConfirmed, open.length),
    ).toBe(false)
  })
})

describe('runReviewDeficiencySummaries', () => {
  it('includes deficiencies reported on this run', () => {
    expect(
      deficiencyOnRunForReview(
        {
          id: 1,
          created_run_id: 9001,
          title: 'Bell',
          severity: 'deficient',
          status: 'new',
        },
        RUN,
      ),
    ).toBe(true)
  })

  it('excludes carry-over new deficiencies from a prior run', () => {
    expect(
      deficiencyOnRunForReview(
        {
          id: 2,
          created_run_id: 8000,
          title: 'Old horn',
          severity: 'deficient',
          status: 'new',
        },
        RUN,
      ),
    ).toBe(false)
  })

  it('includes prior deficiencies verified during this field visit', () => {
    expect(
      deficiencyOnRunForReview(
        {
          id: 3,
          created_run_id: 8000,
          title: 'Old bell',
          severity: 'deficient',
          status: 'verified',
          updated_at: '2026-05-02T10:00:00-07:00',
        },
        RUN,
      ),
    ).toBe(true)
  })

  it('excludes deficiencies verified before the run started', () => {
    expect(
      deficiencyOnRunForReview(
        {
          id: 4,
          created_run_id: 8000,
          title: 'Stale',
          severity: 'deficient',
          status: 'verified',
          updated_at: '2026-05-01T10:00:00-07:00',
        },
        RUN,
      ),
    ).toBe(false)
  })

  it('filters a mixed list for the run review column', () => {
    const filtered = runReviewDeficiencySummaries(
      [
        { id: 1, created_run_id: 9001, title: 'On run', severity: 'deficient', status: 'new' },
        { id: 2, created_run_id: 8000, title: 'Carry', severity: 'deficient', status: 'new' },
        {
          id: 3,
          created_run_id: 8000,
          title: 'Verified now',
          severity: 'deficient',
          status: 'verified',
          updated_at: '2026-05-02T11:00:00-07:00',
        },
      ],
      RUN,
    )
    expect(filtered.map((d) => d.id)).toEqual([1, 3])
  })
})
