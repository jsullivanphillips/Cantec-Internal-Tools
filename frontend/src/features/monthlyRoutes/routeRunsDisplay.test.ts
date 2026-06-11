import { describe, expect, it } from 'vitest'
import {
  availableRunsCardYears,
  buildRouteRunTableRows,
  buildRunsCardRowsForYear,
  defaultRunsCardYear,
  formatRunDisplayDate,
  formatRunsCardStageLabel,
  formatSitesTestedRatio,
} from './routeRunsDisplay'
import type { RouteRunMonthSummary } from './monthlyRoutesShared'

function run(overrides: Partial<RouteRunMonthSummary> = {}): RouteRunMonthSummary {
  return {
    run_id: 1,
    source: 'technician_app',
    status: 'open',
    opened_at: null,
    started_at: null,
    completed_at: null,
    ...overrides,
  }
}

describe('routeRunsDisplay', () => {
  it('formatRunDisplayDate prefers route_tested_on then started_at then completed_at', () => {
    expect(
      formatRunDisplayDate(run({ started_at: '2026-05-02T15:00:00Z' }), {
        route_tested_on: '2026-05-10',
        top_technicians: [],
        completed_jobs_attributed: 0,
        last_updated_at: null,
      }),
    ).toMatch(/May 10, 2026/)

    expect(formatRunDisplayDate(run({ started_at: '2026-05-02T15:00:00Z' }), null)).toMatch(/May/)

    expect(
      formatRunDisplayDate(
        run({ completed_at: '2026-05-28T12:00:00Z' }),
        null,
      ),
    ).toMatch(/May/)

    expect(formatRunDisplayDate(run(), null)).toBe('—')
  })

  it('formatSitesTestedRatio renders tested/total or dash when total missing', () => {
    expect(formatSitesTestedRatio(run({ stops_tested_count: 29, stops_on_route_count: 31 }))).toBe(
      '29/31',
    )
    expect(formatSitesTestedRatio(run({ stops_on_route_count: 0 }))).toBe('—')
  })

  it('buildRouteRunTableRows sorts newest month first', () => {
    const rows = buildRouteRunTableRows(
      {
        '2026-04-01': run({ run_id: 2 }),
        '2026-06-01': run({ run_id: 3 }),
        '2026-05-01': run({ run_id: 1 }),
      },
      {},
    )
    expect(rows.map((row) => row.monthIso)).toEqual(['2026-06-01', '2026-05-01', '2026-04-01'])
  })

  it('buildRunsCardRowsForYear includes Jan through current+1 for selected year', () => {
    const rows = buildRunsCardRowsForYear(
      2026,
      '2026-06-01',
      {
        '2026-04-01': run({ run_id: 2, workflow_stage_label: 'Completed' }),
      },
      {},
    )
    expect(rows.map((row) => row.monthIso)).toEqual([
      '2026-07-01',
      '2026-06-01',
      '2026-05-01',
      '2026-04-01',
      '2026-03-01',
      '2026-02-01',
      '2026-01-01',
    ])
    const april = rows.find((row) => row.monthIso === '2026-04-01')
    expect(april?.hasRunData).toBe(true)
    const may = rows.find((row) => row.monthIso === '2026-05-01')
    expect(may?.hasRunData).toBe(false)
  })

  it('formatRunsCardStageLabel shows No data for empty months', () => {
    expect(
      formatRunsCardStageLabel({
        monthIso: '2026-05-01',
        run: null,
        specialistMonth: null,
        hasRunData: false,
      }),
    ).toBe('No data')
    expect(
      formatRunsCardStageLabel({
        monthIso: '2026-04-01',
        run: run({ workflow_stage_label: 'Skipped' }),
        specialistMonth: null,
        hasRunData: true,
      }),
    ).toBe('Skipped')
  })

  it('availableRunsCardYears always includes current year', () => {
    const years = availableRunsCardYears('2026-06-01', {}, {})
    expect(years).toEqual([2026])
    const mixed = availableRunsCardYears(
      '2026-06-01',
      { '2025-03-01': run({ run_id: 1 }) },
      { '2024-08-01': { sites_tested_count: 1, skipped_non_annual_count: 0, skipped_annual_count: 0 } },
    )
    expect(mixed).toEqual([2024, 2025, 2026])
  })

  it('defaultRunsCardYear prefers current calendar year', () => {
    expect(defaultRunsCardYear([2024, 2025, 2026], '2026-06-01')).toBe(2026)
    expect(defaultRunsCardYear([2024, 2025], '2026-06-01')).toBe(2025)
  })
})
