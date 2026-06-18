import type {
  DashboardRouteBreakdownRange,
  DashboardRoutePerformanceRow,
} from './monthlyDashboardShared'

export type RouteCapacityBand = 'under' | 'healthy' | 'full' | 'over' | 'unknown'

export type RouteHealthScorecardRow = {
  source: DashboardRoutePerformanceRow
  monitoringPct: number | null
  kmPerBuilding: number | null
  capacityBand: RouteCapacityBand
}

export type RouteHealthSortKey =
  | 'route'
  | 'building_count'
  | 'avg_hours'
  | 'field_avg_hours'
  | 'capacity_hours'
  | 'pre_route_gap_minutes'
  | 'km_per_building'
  | 'monitoring_pct'
  | 'skipped_non_annual'
  | 'monthly_net_pct'

export type RouteHealthSortDir = 'asc' | 'desc'

const CAPACITY_UNDER_MAX_HOURS = 7
const CAPACITY_HEALTHY_MAX_HOURS = 8
const CAPACITY_FULL_MAX_HOURS = 8.5

export function skippedColumnLabel(range: DashboardRouteBreakdownRange): string {
  if (range === 'last_month') return 'Sites skipped'
  if (range === 'last_quarter') return 'Total sites skipped'
  return 'Avg sites skipped'
}

export function typicalDurationColumnLabel(range: DashboardRouteBreakdownRange): string {
  return range === 'last_month' ? 'Typical duration' : 'Avg typical duration'
}

export function stDurationColumnLabel(range: DashboardRouteBreakdownRange): string {
  return range === 'last_month' ? 'ST duration' : 'Avg ST duration'
}

export function fieldDurationColumnLabel(range: DashboardRouteBreakdownRange): string {
  return range === 'last_month' ? 'Field duration' : 'Avg field duration'
}

export function preRouteGapColumnLabel(range: DashboardRouteBreakdownRange): string {
  return range === 'last_month' ? 'Pre-route' : 'Avg pre-route'
}

/** Hours used for capacity band (field when available). */
export function capacityHoursForRow(row: DashboardRoutePerformanceRow): number | null {
  if (row.field_avg_hours != null && Number.isFinite(row.field_avg_hours)) {
    return row.field_avg_hours
  }
  if (row.avg_hours != null && Number.isFinite(row.avg_hours)) {
    return row.avg_hours
  }
  return null
}

export function capacityBandForHours(hours: number | null | undefined): RouteCapacityBand {
  if (hours == null || !Number.isFinite(hours)) return 'unknown'
  if (hours < CAPACITY_UNDER_MAX_HOURS) return 'under'
  if (hours < CAPACITY_HEALTHY_MAX_HOURS) return 'healthy'
  if (hours <= CAPACITY_FULL_MAX_HOURS) return 'full'
  return 'over'
}

export function capacityBandLabel(band: RouteCapacityBand): string {
  switch (band) {
    case 'under':
      return 'Under capacity'
    case 'healthy':
      return 'Healthy'
    case 'full':
      return 'Full'
    case 'over':
      return 'Over capacity'
    default:
      return '—'
  }
}

export function monitoringPctForRow(row: DashboardRoutePerformanceRow): number | null {
  if (row.building_count <= 0) return null
  return Math.round((row.monitoring_site_count / row.building_count) * 100)
}

export function kmPerBuildingForRow(row: DashboardRoutePerformanceRow): number | null {
  if (row.building_count <= 0 || row.distance_meters == null || !Number.isFinite(row.distance_meters)) {
    return null
  }
  return row.distance_meters / row.building_count / 1000
}

export function formatKmPerBuilding(km: number | null | undefined): string {
  if (km == null || !Number.isFinite(km)) return '—'
  return `${km.toFixed(2)} km`
}

export function formatSkippedValue(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

export function formatTypicalDuration(hours: number | null | undefined): string {
  if (hours == null || !Number.isFinite(hours)) return '—'
  return `${hours.toFixed(1)} hr`
}

export function formatPreRouteGap(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return '—'
  const rounded = Math.round(minutes)
  if (rounded < 60) return `${rounded} min`
  const hours = Math.floor(rounded / 60)
  const remainder = rounded % 60
  if (remainder === 0) return `${hours} hr`
  return `${hours} hr ${remainder} min`
}

export function enrichHealthRow(row: DashboardRoutePerformanceRow): RouteHealthScorecardRow {
  return {
    source: row,
    monitoringPct: monitoringPctForRow(row),
    kmPerBuilding: kmPerBuildingForRow(row),
    capacityBand: capacityBandForHours(capacityHoursForRow(row)),
  }
}

function compareHealthRows(
  a: RouteHealthScorecardRow,
  b: RouteHealthScorecardRow,
  key: RouteHealthSortKey,
): number {
  const rowA = a.source
  const rowB = b.source
  switch (key) {
    case 'route':
      return (rowA.route.route_number ?? 0) - (rowB.route.route_number ?? 0)
    case 'building_count':
      return rowA.building_count - rowB.building_count
    case 'avg_hours':
      return (rowA.avg_hours ?? -1) - (rowB.avg_hours ?? -1)
    case 'field_avg_hours':
      return (rowA.field_avg_hours ?? -1) - (rowB.field_avg_hours ?? -1)
    case 'capacity_hours':
      return (capacityHoursForRow(rowA) ?? -1) - (capacityHoursForRow(rowB) ?? -1)
    case 'pre_route_gap_minutes':
      return (rowA.pre_route_gap_minutes ?? -1) - (rowB.pre_route_gap_minutes ?? -1)
    case 'km_per_building':
      return (a.kmPerBuilding ?? -1) - (b.kmPerBuilding ?? -1)
    case 'monitoring_pct':
      return (a.monitoringPct ?? -1) - (b.monitoringPct ?? -1)
    case 'skipped_non_annual':
      return (rowA.skipped_non_annual ?? -1) - (rowB.skipped_non_annual ?? -1)
    case 'monthly_net_pct':
      return (rowA.monthly_net_pct ?? -1) - (rowB.monthly_net_pct ?? -1)
    default:
      return 0
  }
}

export function sortHealthRows(
  rows: RouteHealthScorecardRow[],
  sortKey: RouteHealthSortKey,
  sortDir: RouteHealthSortDir,
): RouteHealthScorecardRow[] {
  const copy = [...rows]
  copy.sort((a, b) => {
    const cmp = compareHealthRows(a, b, sortKey)
    return sortDir === 'asc' ? cmp : -cmp
  })
  return copy
}
