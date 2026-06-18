import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DashboardRouteBreakdownPayload } from './monthlyDashboardShared'
import {
  readRouteBreakdownCache,
  ROUTE_BREAKDOWN_CACHE_MAX_AGE_MS,
  writeRouteBreakdownCache,
} from './routeBreakdownCache'

const samplePayload = {
  range: 'last_month',
  period_label: 'Last month',
  trailing_months: 1,
  period_start: '2026-05-01',
  period_end: '2026-05-01',
  revenue_columns: [{ month_key: '2026-05-01', header: 'MAY REVENUE' }],
  show_avg_monthly_revenue: false,
  show_total_revenue: false,
  cost_constants: {
    labour_rate_per_hour: 45,
    truck_charge_per_month: 25,
    default_tech_count: 2,
  },
  rows: [],
} satisfies DashboardRouteBreakdownPayload

describe('routeBreakdownCache', () => {
  const storage = new Map<string, string>()

  beforeEach(() => {
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value)
      },
      removeItem: (key: string) => {
        storage.delete(key)
      },
    })
    storage.clear()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('returns cached payload within ttl', () => {
    writeRouteBreakdownCache('last_month', samplePayload)
    expect(readRouteBreakdownCache('last_month')).toEqual(samplePayload)
  })

  it('returns null after ttl expires', () => {
    writeRouteBreakdownCache('last_month', samplePayload)
    vi.setSystemTime(new Date(Date.now() + ROUTE_BREAKDOWN_CACHE_MAX_AGE_MS + 1))
    expect(readRouteBreakdownCache('last_month')).toBeNull()
  })

  it('keeps ranges separate', () => {
    writeRouteBreakdownCache('last_month', samplePayload)
    expect(readRouteBreakdownCache('last_12_months')).toBeNull()
  })
})
