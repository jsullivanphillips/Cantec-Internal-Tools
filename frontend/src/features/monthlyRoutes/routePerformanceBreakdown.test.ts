import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  performanceTableRouteEndTime,
  performanceTableRouteStartTime,
  pickDefaultPerformanceMonth,
} from './RoutePerformanceBreakdown'
import type {
  RoutePerformanceBreakdownStop,
  RoutePerformanceBreakdownSummary,
} from './monthlyRoutesShared'

function summary(
  overrides: Partial<RoutePerformanceBreakdownSummary> = {},
): RoutePerformanceBreakdownSummary {
  return {
    tested_revenue_total: 0,
    tested_count: 0,
    skipped_annual_count: 0,
    skipped_non_annual_count: 0,
    pending_count: 0,
    active_stop_count: 0,
    route_duration_minutes: null,
    route_hours: null,
    route_duration_source: null,
    route_clock_in: null,
    route_clock_out: null,
    avg_hours_billed: null,
    avg_hours_capped_for_billing: false,
    tech_count: 2,
    monthly_expense: 0,
    monthly_net: null,
    monthly_net_pct: null,
    revenue_per_route_hour: null,
    sum_visit_minutes: 0,
    visit_time_coverage: 'none',
    unaccounted_minutes: null,
    ...overrides,
  }
}

function stop(
  overrides: Partial<RoutePerformanceBreakdownStop> = {},
): RoutePerformanceBreakdownStop {
  return {
    location_id: 1,
    label: 'Site',
    stop_order: 1,
    outcome: 'tested',
    billing_status: 'bill',
    revenue: 0,
    price_per_month: null,
    has_price: true,
    visit_minutes: null,
    time_in: null,
    time_out: null,
    visit_time_source: null,
    ...overrides,
  }
}

describe('performanceTableRouteStartTime', () => {
  it('prefers ServiceTrade route clock-in', () => {
    expect(
      performanceTableRouteStartTime(summary({ route_clock_in: '8:00 AM' }), [
        stop({ stop_order: 1, time_in: '9:00 AM' }),
      ]),
    ).toBe('8:00 AM')
  })

  it('falls back to the first stop time-in by stop order', () => {
    expect(
      performanceTableRouteStartTime(summary(), [
        stop({ stop_order: 3, time_in: '11:00 AM' }),
        stop({ stop_order: 1, time_in: '8:30 AM' }),
        stop({ stop_order: 2, time_in: '9:45 AM' }),
      ]),
    ).toBe('8:30 AM')
  })
})

describe('performanceTableRouteEndTime', () => {
  it('prefers ServiceTrade route clock-out', () => {
    expect(
      performanceTableRouteEndTime(summary({ route_clock_out: '3:45 PM' }), [
        stop({ stop_order: 2, time_out: '2:00 PM' }),
      ]),
    ).toBe('3:45 PM')
  })

  it('falls back to the last stop time-out by stop order', () => {
    expect(
      performanceTableRouteEndTime(summary(), [
        stop({ stop_order: 1, time_out: '10:00 AM' }),
        stop({ stop_order: 3, time_out: '2:30 PM' }),
        stop({ stop_order: 2, time_out: '11:15 AM' }),
      ]),
    ).toBe('2:30 PM')
  })
})

describe('pickDefaultPerformanceMonth', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-15T12:00:00-07:00'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('selects the previous Pacific calendar month when available', () => {
    expect(
      pickDefaultPerformanceMonth(['2026-08-01', '2026-05-01', '2026-06-01']),
    ).toBe('2026-05-01')
  })

  it('falls back to the newest month on or before the previous month', () => {
    expect(pickDefaultPerformanceMonth(['2026-08-01', '2026-06-01', '2026-04-01'])).toBe('2026-04-01')
  })

  it('falls back to the newest available month when nothing is on or before the previous month', () => {
    expect(pickDefaultPerformanceMonth(['2026-08-01', '2026-07-01'])).toBe('2026-08-01')
  })
})
