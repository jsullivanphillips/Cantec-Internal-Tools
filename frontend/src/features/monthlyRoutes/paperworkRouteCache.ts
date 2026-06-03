import type {
  MonthlyRunDetailPayload,
  TechnicianWorksheetStop,
} from './monthlyRoutesShared'

export type PaperworkFieldSubmissionCache = {
  stops: TechnicianWorksheetStop[]
  capturedAt: string | null
  fieldWorkReopened: boolean
}

export type PaperworkJobItemRow = { description: string; quantity: number }

export type PaperworkJobItemsCache = Record<number, PaperworkJobItemRow[]>

function cacheKey(routeId: number, monthIso: string): string {
  return `${routeId}::${monthIso}`
}

const runDetailsByKey = new Map<string, MonthlyRunDetailPayload>()
const fieldSubmissionByKey = new Map<string, PaperworkFieldSubmissionCache>()
const jobItemsByKey = new Map<string, PaperworkJobItemsCache>()

export function getCachedRunDetails(
  routeId: number,
  monthIso: string,
): MonthlyRunDetailPayload | null {
  const cached = runDetailsByKey.get(cacheKey(routeId, monthIso)) ?? null
  if (cached && cached.month_date !== monthIso) return null
  return cached
}

export function setCachedRunDetails(
  routeId: number,
  monthIso: string,
  payload: MonthlyRunDetailPayload,
): void {
  runDetailsByKey.set(cacheKey(routeId, monthIso), payload)
}

export function getCachedFieldSubmission(
  routeId: number,
  monthIso: string,
): PaperworkFieldSubmissionCache | null {
  return fieldSubmissionByKey.get(cacheKey(routeId, monthIso)) ?? null
}

export function setCachedFieldSubmission(
  routeId: number,
  monthIso: string,
  entry: PaperworkFieldSubmissionCache,
): void {
  fieldSubmissionByKey.set(cacheKey(routeId, monthIso), entry)
}

export function getCachedJobItems(routeId: number, monthIso: string): PaperworkJobItemsCache | null {
  return jobItemsByKey.get(cacheKey(routeId, monthIso)) ?? null
}

export function setCachedJobItems(
  routeId: number,
  monthIso: string,
  items: PaperworkJobItemsCache,
): void {
  jobItemsByKey.set(cacheKey(routeId, monthIso), items)
}

/** Drop cached paperwork for one route month (after lifecycle or reset). */
export function invalidatePaperworkRouteMonth(routeId: number, monthIso: string): void {
  const key = cacheKey(routeId, monthIso)
  runDetailsByKey.delete(key)
  fieldSubmissionByKey.delete(key)
  jobItemsByKey.delete(key)
}

/** Drop exact-history and run-review secondary payloads; run_details may stay patched in place. */
export function invalidatePaperworkSecondaryCaches(routeId: number, monthIso: string): void {
  const key = cacheKey(routeId, monthIso)
  fieldSubmissionByKey.delete(key)
  jobItemsByKey.delete(key)
}

/** Drop all cached paperwork payloads for one route (after library master edits). */
export function invalidatePaperworkCacheForRoute(routeId: number): void {
  const prefix = `${routeId}::`
  for (const key of [...runDetailsByKey.keys()]) {
    if (key.startsWith(prefix)) runDetailsByKey.delete(key)
  }
  for (const key of [...fieldSubmissionByKey.keys()]) {
    if (key.startsWith(prefix)) fieldSubmissionByKey.delete(key)
  }
  for (const key of [...jobItemsByKey.keys()]) {
    if (key.startsWith(prefix)) jobItemsByKey.delete(key)
  }
}

/** Test helper — not used in production UI. */
export function clearPaperworkRouteCache(): void {
  runDetailsByKey.clear()
  fieldSubmissionByKey.clear()
  jobItemsByKey.clear()
}
