import { describe, expect, it } from 'vitest'

import type { DashboardRoutePerformanceRow } from './monthlyDashboardShared'
import {
  capacityBandForHours,
  capacityBandLabel,
  capacityHoursForRow,
  enrichHealthRow,
  formatKmPerBuilding,
  formatPreRouteGap,
  formatSkippedValue,
  formatTypicalDuration,
  kmPerBuildingForRow,
  monitoringPctForRow,
  skippedColumnLabel,
  sortHealthRows,
} from './routeHealthScorecard'

function performanceRow(
  overrides: Partial<DashboardRoutePerformanceRow> = {},
): DashboardRoutePerformanceRow {
  return {
    route: { id: 1, route_number: 1, name: 'Route 1' },
    building_count: 10,
    distance_meters: 25_000,
    duration_seconds: 3600,
    avg_hours: 8.6,
    avg_hours_months_sampled: 1,
    field_avg_hours: 8.1,
    field_avg_hours_months_sampled: 1,
    pre_route_gap_minutes: 20,
    pre_route_gap_months_sampled: 1,
    skipped_non_annual: 2,
    skipped_months_sampled: 1,
    monitoring_site_count: 3,
    tech_count: 2,
    monthly_net_pct: 0.55,
    has_sufficient_run_time_data: true,
    ...overrides,
  }
}

describe('capacityBandForHours', () => {
  it('maps duration bands', () => {
    expect(capacityBandForHours(6.5)).toBe('under')
    expect(capacityBandForHours(7.5)).toBe('healthy')
    expect(capacityBandForHours(8.2)).toBe('full')
    expect(capacityBandForHours(9)).toBe('over')
    expect(capacityBandForHours(null)).toBe('unknown')
  })
})

describe('capacityBandLabel', () => {
  it('returns readable labels', () => {
    expect(capacityBandLabel('healthy')).toBe('Healthy')
    expect(capacityBandLabel('unknown')).toBe('—')
  })
})

describe('skippedColumnLabel', () => {
  it('varies by range', () => {
    expect(skippedColumnLabel('last_month')).toBe('Sites skipped')
    expect(skippedColumnLabel('last_quarter')).toBe('Total sites skipped')
    expect(skippedColumnLabel('ytd')).toBe('Avg sites skipped')
  })
})

describe('monitoringPctForRow', () => {
  it('rounds monitoring share of buildings', () => {
    expect(monitoringPctForRow(performanceRow({ monitoring_site_count: 3, building_count: 10 }))).toBe(
      30,
    )
    expect(monitoringPctForRow(performanceRow({ building_count: 0 }))).toBeNull()
  })
})

describe('kmPerBuildingForRow', () => {
  it('converts meters to km per building', () => {
    expect(kmPerBuildingForRow(performanceRow({ distance_meters: 12_500, building_count: 5 }))).toBe(
      2.5,
    )
    expect(kmPerBuildingForRow(performanceRow({ distance_meters: null }))).toBeNull()
  })
})

describe('formatKmPerBuilding', () => {
  it('formats distances in km with consistent precision', () => {
    expect(formatKmPerBuilding(0.969)).toBe('0.97 km')
    expect(formatKmPerBuilding(1.3)).toBe('1.30 km')
    expect(formatKmPerBuilding(2.3)).toBe('2.30 km')
    expect(formatKmPerBuilding(null)).toBe('—')
  })
})

describe('formatSkippedValue', () => {
  it('formats integers without decimals', () => {
    expect(formatSkippedValue(3)).toBe('3')
    expect(formatSkippedValue(2.5)).toBe('2.50')
    expect(formatSkippedValue(null)).toBe('—')
  })
})

describe('formatTypicalDuration', () => {
  it('formats hours with one decimal', () => {
    expect(formatTypicalDuration(8.25)).toBe('8.3 hr')
    expect(formatTypicalDuration(null)).toBe('—')
  })
})

describe('formatPreRouteGap', () => {
  it('formats minutes and hours', () => {
    expect(formatPreRouteGap(20)).toBe('20 min')
    expect(formatPreRouteGap(65)).toBe('1 hr 5 min')
    expect(formatPreRouteGap(null)).toBe('—')
  })
})

describe('capacityHoursForRow', () => {
  it('prefers field duration over ST duration', () => {
    expect(capacityHoursForRow(performanceRow())).toBe(8.1)
    expect(capacityHoursForRow(performanceRow({ field_avg_hours: null, avg_hours: 8.6 }))).toBe(8.6)
  })
})

describe('enrichHealthRow', () => {
  it('derives scorecard fields from API row', () => {
    const enriched = enrichHealthRow(performanceRow())
    expect(enriched.monitoringPct).toBe(30)
    expect(enriched.kmPerBuilding).toBe(2.5)
    expect(enriched.capacityBand).toBe('full')
  })
})

describe('sortHealthRows', () => {
  it('sorts by monitoring pct descending', () => {
    const rows = [
      enrichHealthRow(performanceRow({ route: { id: 1, route_number: 1, name: 'A' }, monitoring_site_count: 1 })),
      enrichHealthRow(performanceRow({ route: { id: 2, route_number: 2, name: 'B' }, monitoring_site_count: 5 })),
    ]
    const sorted = sortHealthRows(rows, 'monitoring_pct', 'desc')
    expect(sorted[0].monitoringPct).toBe(50)
    expect(sorted[1].monitoringPct).toBe(10)
  })
})
