import { describe, expect, it } from 'vitest'
import {
  computeSelectablePaperworkMonths,
  derivePaperworkViewMode,
  isFutureMonthPrepBlocked,
  resolvePaperworkMonthQuery,
} from './paperworkViewMode'
import type { RouteRunMonthSummary, TechnicianWorksheetRun } from './monthlyRoutesShared'

const CURRENT = '2026-06-01'

function run(partial: Partial<TechnicianWorksheetRun> = {}): TechnicianWorksheetRun {
  return {
    id: 1,
    monthly_route_id: 1,
    month_date: CURRENT,
    source: 'technician_app',
    status: 'open',
    opened_at: '2026-06-01T00:00:00Z',
    prepared_at: null,
    started_at: null,
    field_ended_at: null,
    office_review_completed_at: null,
    completed_at: null,
    pre_run_message: null,
    is_historical: false,
    ...partial,
  }
}

function runSummary(monthIso: string): RouteRunMonthSummary {
  return {
    run_id: 1,
    source: 'technician_app',
    status: 'open',
    opened_at: `${monthIso}T00:00:00Z`,
    started_at: null,
    completed_at: null,
    workflow_stage: 'draft',
    workflow_stage_label: 'Draft',
  }
}

describe('derivePaperworkViewMode', () => {
  it('returns exact_history for past months with no run header', () => {
    expect(derivePaperworkViewMode(null, '2026-05-01', CURRENT)).toBe('exact_history')
  })

  it('returns exact_history for completed past-month run', () => {
    expect(
      derivePaperworkViewMode(
        run({
          month_date: '2026-05-01',
          started_at: '2026-05-02T00:00:00Z',
          field_ended_at: '2026-05-03T00:00:00Z',
          completed_at: '2026-05-04T00:00:00Z',
          status: 'completed',
        }),
        '2026-05-01',
        CURRENT,
      ),
    ).toBe('exact_history')
  })

  it('returns run_review for reopened past-month run after office completion cleared', () => {
    expect(
      derivePaperworkViewMode(
        run({
          month_date: '2026-05-01',
          started_at: '2026-05-02T00:00:00Z',
          field_ended_at: '2026-05-03T00:00:00Z',
          completed_at: null,
          status: 'open',
        }),
        '2026-05-01',
        CURRENT,
      ),
    ).toBe('run_review')
  })

  it('returns exact_history for completed current-month run', () => {
    expect(
      derivePaperworkViewMode(
        run({ completed_at: '2026-06-15T00:00:00Z', status: 'completed' }),
        CURRENT,
        CURRENT,
      ),
    ).toBe('exact_history')
  })

  it('returns preparation for draft/prepared current month', () => {
    expect(derivePaperworkViewMode(null, CURRENT, CURRENT)).toBe('preparation')
    expect(derivePaperworkViewMode(run({ prepared_at: '2026-06-01T00:00:00Z' }), CURRENT, CURRENT)).toBe(
      'preparation',
    )
  })

  it('returns preparation for next month in prep phase', () => {
    expect(derivePaperworkViewMode(null, '2026-07-01', CURRENT)).toBe('preparation')
  })

  it('ignores a completed run from another month while switching months', () => {
    expect(
      derivePaperworkViewMode(
        run({
          month_date: '2026-06-01',
          completed_at: '2026-06-15T00:00:00Z',
          status: 'completed',
        }),
        '2026-07-01',
        CURRENT,
      ),
    ).toBe('preparation')
  })

  it('returns run_review for field-in-progress current month', () => {
    expect(
      derivePaperworkViewMode(run({ started_at: '2026-06-02T00:00:00Z' }), CURRENT, CURRENT),
    ).toBe('run_review')
  })

  it('returns run_review for awaiting office review and ready_to_close', () => {
    expect(
      derivePaperworkViewMode(run({ started_at: 'x', field_ended_at: 'y' }), CURRENT, CURRENT),
    ).toBe('run_review')
    expect(
      derivePaperworkViewMode(
        run({ started_at: 'x', field_ended_at: 'y', office_review_completed_at: 'z' }),
        CURRENT,
        CURRENT,
      ),
    ).toBe('run_review')
  })

  it('returns run_review for reopened current-month run', () => {
    expect(
      derivePaperworkViewMode(
        run({
          started_at: '2026-06-02T00:00:00Z',
          field_ended_at: '2026-06-10T00:00:00Z',
          completed_at: null,
          status: 'open',
        }),
        CURRENT,
        CURRENT,
      ),
    ).toBe('run_review')
  })
})

describe('computeSelectablePaperworkMonths', () => {
  it('includes every run file month plus current and next calendar month', () => {
    const runsByMonth: Record<string, RouteRunMonthSummary> = {
      '2026-03-01': runSummary('2026-03-01'),
      '2026-05-01': runSummary('2026-05-01'),
      '2026-08-01': runSummary('2026-08-01'),
    }
    const months = computeSelectablePaperworkMonths(runsByMonth, CURRENT).map((m) => m.monthIso)
    expect(months).toEqual(['2026-03-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01'])
  })

  it('always includes current and next even with no run files', () => {
    const months = computeSelectablePaperworkMonths({}, CURRENT).map((m) => m.monthIso)
    expect(months).toEqual(['2026-06-01', '2026-07-01'])
  })
})

describe('resolvePaperworkMonthQuery', () => {
  const selectable = computeSelectablePaperworkMonths(
    { '2026-05-01': runSummary('2026-05-01') },
    CURRENT,
  )

  it('uses valid month param when selectable', () => {
    expect(resolvePaperworkMonthQuery('2026-05-01', CURRENT, selectable)).toBe('2026-05-01')
  })

  it('falls back to current month for invalid param', () => {
    expect(resolvePaperworkMonthQuery('2026-01-01', CURRENT, selectable)).toBe(CURRENT)
    expect(resolvePaperworkMonthQuery('', CURRENT, selectable)).toBe(CURRENT)
  })
})

describe('isFutureMonthPrepBlocked', () => {
  it('blocks next month when current month run is not closed', () => {
    expect(
      isFutureMonthPrepBlocked('2026-07-01', CURRENT, {
        [CURRENT]: { ...runSummary(CURRENT), workflow_stage: 'field_in_progress' },
      }),
    ).toBe(true)
  })

  it('allows next month when current month is completed', () => {
    expect(
      isFutureMonthPrepBlocked('2026-07-01', CURRENT, {
        [CURRENT]: {
          ...runSummary(CURRENT),
          workflow_stage: 'completed',
          completed_at: '2026-06-20T00:00:00Z',
        },
      }),
    ).toBe(false)
  })

  it('does not block current month prep', () => {
    expect(isFutureMonthPrepBlocked(CURRENT, CURRENT, {})).toBe(false)
  })
})
