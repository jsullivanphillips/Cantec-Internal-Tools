import type { MonthlyRouteHeroSummary } from './monthlyRoutesShared'

const CACHE_KEY_PREFIX = 'scheduleAssist.routeHeroSummary.v1'

/** Session cache TTL — instant hero performance metrics when revisiting a route. */
export const ROUTE_HERO_SUMMARY_CACHE_MAX_AGE_MS = 30 * 60 * 1000

type CacheEntry = {
  ts: number
  routeId: number
  heroSummary: MonthlyRouteHeroSummary
}

function cacheKey(routeId: number): string {
  return `${CACHE_KEY_PREFIX}:${routeId}`
}

export function readRouteHeroSummaryCache(routeId: number): MonthlyRouteHeroSummary | null {
  if (typeof sessionStorage === 'undefined' || !Number.isFinite(routeId)) return null
  try {
    const raw = sessionStorage.getItem(cacheKey(routeId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as CacheEntry
    if (
      !parsed ||
      typeof parsed.ts !== 'number' ||
      parsed.routeId !== routeId ||
      !parsed.heroSummary ||
      typeof parsed.heroSummary !== 'object'
    ) {
      return null
    }
    if (Date.now() - parsed.ts > ROUTE_HERO_SUMMARY_CACHE_MAX_AGE_MS) {
      sessionStorage.removeItem(cacheKey(routeId))
      return null
    }
    return parsed.heroSummary
  } catch {
    return null
  }
}

export function writeRouteHeroSummaryCache(
  routeId: number,
  heroSummary: MonthlyRouteHeroSummary,
): void {
  if (typeof sessionStorage === 'undefined' || !Number.isFinite(routeId)) return
  try {
    const entry: CacheEntry = { ts: Date.now(), routeId, heroSummary }
    sessionStorage.setItem(cacheKey(routeId), JSON.stringify(entry))
  } catch {
    /* storage full or disabled */
  }
}

export function clearRouteHeroSummaryCache(routeId: number): void {
  if (typeof sessionStorage === 'undefined' || !Number.isFinite(routeId)) return
  try {
    sessionStorage.removeItem(cacheKey(routeId))
  } catch {
    /* ignore */
  }
}
