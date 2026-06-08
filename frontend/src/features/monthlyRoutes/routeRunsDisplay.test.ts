import { describe, expect, it } from 'vitest'
import {
  buildRouteRunTableRows,
  formatRunDisplayDate,
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
})
