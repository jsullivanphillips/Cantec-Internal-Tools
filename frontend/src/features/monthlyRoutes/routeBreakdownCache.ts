import type {
  DashboardRouteBreakdownPayload,
  DashboardRouteBreakdownRange,
} from './monthlyDashboardShared'

const CACHE_KEY_PREFIX = 'scheduleAssist.routeBreakdown.v1'

/** Session cache TTL — instant paint when revisiting Metrics within this window. */
export const ROUTE_BREAKDOWN_CACHE_MAX_AGE_MS = 30 * 60 * 1000

type CacheEntry = {
  ts: number
  range: DashboardRouteBreakdownRange
  payload: DashboardRouteBreakdownPayload
}

function cacheKey(range: DashboardRouteBreakdownRange): string {
  return `${CACHE_KEY_PREFIX}:${range}`
}

export function readRouteBreakdownCache(
  range: DashboardRouteBreakdownRange,
): DashboardRouteBreakdownPayload | null {
  if (typeof sessionStorage === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(cacheKey(range))
    if (!raw) return null
    const parsed = JSON.parse(raw) as CacheEntry
    if (
      !parsed ||
      typeof parsed.ts !== 'number' ||
      parsed.range !== range ||
      !parsed.payload ||
      typeof parsed.payload !== 'object'
    ) {
      return null
    }
    if (Date.now() - parsed.ts > ROUTE_BREAKDOWN_CACHE_MAX_AGE_MS) {
      sessionStorage.removeItem(cacheKey(range))
      return null
    }
    return parsed.payload
  } catch {
    return null
  }
}

export function writeRouteBreakdownCache(
  range: DashboardRouteBreakdownRange,
  payload: DashboardRouteBreakdownPayload,
): void {
  if (typeof sessionStorage === 'undefined') return
  try {
    const entry: CacheEntry = { ts: Date.now(), range, payload }
    sessionStorage.setItem(cacheKey(range), JSON.stringify(entry))
  } catch {
    /* storage full or disabled */
  }
}
