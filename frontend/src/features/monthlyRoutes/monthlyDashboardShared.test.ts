import { describe, expect, it } from 'vitest'
import {
  buildRouteOverviewCardToneMap,
  countRoutesToPrepare,
  countRoutesToProcess,
  routeOverviewCardToneFromStage,
  routeScheduledInMonth,
  type MonthlyDashboardRouteRow,
} from './monthlyDashboardShared'
import type { MonthlyRouteSummary } from './monthlyRoutesShared'

function dashboardRow(
  route: Partial<MonthlyRouteSummary> & Pick<MonthlyRouteSummary, 'id' | 'route_number'>,
  run?: { workflow_stage: string } | null,
): MonthlyDashboardRouteRow {
  return {
    route: {
      weekday_iso: 0,
      week_occurrence: 1,
      label: `R${route.route_number}`,
      ...route,
    },
    service_trade_job_dot: { color: 'grey', tooltip: 'No ServiceTrade route link' },
    current_month_run: run
      ? { run_id: 1, workflow_stage: run.workflow_stage, workflow_stage_label: run.workflow_stage }
      : undefined,
  }
}

describe('monthlyDashboardShared', () => {
  it('maps workflow stages to calendar card tones', () => {
    expect(routeOverviewCardToneFromStage('completed')).toBe('reviewed-closed')
    expect(routeOverviewCardToneFromStage('skipped')).toBe('skipped')
    expect(routeOverviewCardToneFromStage('ready_to_close')).toBe('completed-light')
    expect(routeOverviewCardToneFromStage('awaiting_office_review')).toBe('completed-light')
    expect(routeOverviewCardToneFromStage('prepared')).toBe('prepared')
    expect(routeOverviewCardToneFromStage('field_in_progress')).toBe('field_active')
    expect(routeOverviewCardToneFromStage('draft')).toBe('neutral')
  })

  it('counts routes awaiting office review only', () => {
    const rows = [
      dashboardRow({ id: 1, route_number: 1 }, { workflow_stage: 'awaiting_office_review' }),
      dashboardRow({ id: 2, route_number: 2 }, { workflow_stage: 'ready_to_close' }),
      dashboardRow({ id: 3, route_number: 3 }, { workflow_stage: 'awaiting_office_review' }),
    ]
    expect(countRoutesToProcess(rows)).toBe(2)
  })

  it('counts scheduled draft routes as needing preparation', () => {
    const rows = [
      dashboardRow({ id: 1, route_number: 1, weekday_iso: 2, week_occurrence: 1 }),
      dashboardRow(
        { id: 2, route_number: 2, weekday_iso: 2, week_occurrence: 1 },
        { workflow_stage: 'prepared' },
      ),
      dashboardRow({ id: 3, route_number: 3, weekday_iso: 0, week_occurrence: 6 }),
    ]
    expect(routeScheduledInMonth(rows[0], '2026-06-01')).toBe(true)
    expect(routeScheduledInMonth(rows[2], '2026-05-01')).toBe(false)
    expect(countRoutesToPrepare(rows, '2026-06-01')).toBe(1)
  })

  it('treats missing current_month_run as draft for prep counts', () => {
    const rows = [dashboardRow({ id: 1, route_number: 1, weekday_iso: 2, week_occurrence: 1 })]
    expect(countRoutesToPrepare(rows, '2026-06-01')).toBe(1)
  })

  it('builds a tone map keyed by route id', () => {
    const rows = [
      dashboardRow({ id: 10, route_number: 10 }, { workflow_stage: 'prepared' }),
      dashboardRow({ id: 11, route_number: 11 }, { workflow_stage: 'field_in_progress' }),
    ]
    const map = buildRouteOverviewCardToneMap(rows)
    expect(map.get(10)).toBe('prepared')
    expect(map.get(11)).toBe('field_active')
  })
})
