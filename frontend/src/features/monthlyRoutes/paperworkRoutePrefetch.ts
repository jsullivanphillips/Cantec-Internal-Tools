import { apiJson, isAbortError } from '../../lib/apiClient'
import type { MonthlyRunDetailPayload } from './monthlyRoutesShared'
import { derivePaperworkViewMode } from './paperworkViewMode'
import type { PaperworkFieldSubmissionCache } from './paperworkRouteCache'
import {
  getCachedFieldSubmission,
  getCachedRunDetails,
  setCachedFieldSubmission,
  setCachedRunDetails,
} from './paperworkRouteCache'

function prefetchKey(routeId: number, monthIso: string): string {
  return `${routeId}::${monthIso}`
}

type RunDetailsInflight = {
  promise: Promise<MonthlyRunDetailPayload | null>
  abortController: AbortController
}

const inFlightRunDetails = new Map<string, RunDetailsInflight>()
const inFlightFieldSubmission = new Set<string>()

/** Shared GET ``run_details`` — one in-flight request per route/month (page load + prefetch). */
export function fetchPaperworkRunDetails(
  routeId: number,
  monthIso: string,
  options?: { signal?: AbortSignal; force?: boolean },
): Promise<MonthlyRunDetailPayload | null> {
  const key = prefetchKey(routeId, monthIso)
  if (options?.force) {
    abortPaperworkRunDetailsFetch(routeId, monthIso)
  } else {
    const existing = inFlightRunDetails.get(key)
    if (existing) {
      return existing.promise
    }
  }

  const abortController = new AbortController()
  if (options?.signal) {
    if (options.signal.aborted) {
      abortController.abort()
    } else {
      options.signal.addEventListener('abort', () => abortController.abort(), { once: true })
    }
  }

  let releaseInflight = true
  const promise = (async (): Promise<MonthlyRunDetailPayload | null> => {
    try {
      const qs = new URLSearchParams({ month: monthIso })
      const data = await apiJson<MonthlyRunDetailPayload>(
        `/api/monthly_routes/routes/${routeId}/run_details?${qs.toString()}`,
        { signal: abortController.signal },
      )
      if (abortController.signal.aborted) return null
      if (data.month_date !== monthIso) return null
      setCachedRunDetails(routeId, monthIso, data)
      return data
    } catch (e) {
      if (isAbortError(e)) return null
      throw e
    } finally {
      if (releaseInflight) {
        inFlightRunDetails.delete(key)
      }
    }
  })()

  inFlightRunDetails.set(key, { promise, abortController })
  return promise
}

export function abortPaperworkRunDetailsFetch(routeId: number, monthIso: string): void {
  const key = prefetchKey(routeId, monthIso)
  const entry = inFlightRunDetails.get(key)
  if (entry) {
    entry.abortController.abort()
    inFlightRunDetails.delete(key)
  }
}

export function adjacentSelectableMonths(
  monthIso: string,
  selectableMonths: ReadonlyArray<{ monthIso: string }>,
): string[] {
  const sorted = selectableMonths.map((m) => m.monthIso)
  const idx = sorted.indexOf(monthIso)
  if (idx < 0) return []
  const adjacent: string[] = []
  if (idx > 0) adjacent.push(sorted[idx - 1]!)
  if (idx < sorted.length - 1) adjacent.push(sorted[idx + 1]!)
  return adjacent
}

export async function prefetchPaperworkRunDetails(
  routeId: number,
  monthIso: string,
): Promise<MonthlyRunDetailPayload | null> {
  const cached = getCachedRunDetails(routeId, monthIso)
  if (cached) return cached
  try {
    return await fetchPaperworkRunDetails(routeId, monthIso)
  } catch {
    return null
  }
}

async function prefetchPaperworkFieldSubmission(routeId: number, monthIso: string): Promise<void> {
  if (getCachedFieldSubmission(routeId, monthIso)) return

  const key = prefetchKey(routeId, monthIso)
  if (inFlightFieldSubmission.has(key)) return

  inFlightFieldSubmission.add(key)
  try {
    const qs = new URLSearchParams({ month: monthIso })
    const data = await apiJson<{
      stops: PaperworkFieldSubmissionCache['stops']
      captured_at: string | null
      field_work_reopened: boolean
    }>(`/api/monthly_routes/routes/${routeId}/run_details/field_submission?${qs.toString()}`)
    setCachedFieldSubmission(routeId, monthIso, {
      stops: data.stops ?? [],
      capturedAt: data.captured_at,
      fieldWorkReopened: Boolean(data.field_work_reopened),
    })
  } catch {
    // Prefetch failures are silent — the page loads on demand.
  } finally {
    inFlightFieldSubmission.delete(key)
  }
}

export async function prefetchPaperworkSecondary(
  routeId: number,
  monthIso: string,
  payload: MonthlyRunDetailPayload,
  currentMonthIso: string,
): Promise<void> {
  const viewMode = derivePaperworkViewMode(payload.run, monthIso, currentMonthIso)
  if (viewMode === 'exact_history') {
    await prefetchPaperworkFieldSubmission(routeId, monthIso)
  }
}

/** Warm cache for one route month (run_details + view-specific secondary payload). */
export function prefetchPaperworkMonth(
  routeId: number,
  monthIso: string,
  currentMonthIso: string,
): void {
  if (!Number.isFinite(routeId)) return
  void (async () => {
    const payload = await prefetchPaperworkRunDetails(routeId, monthIso)
    if (payload) {
      await prefetchPaperworkSecondary(routeId, monthIso, payload, currentMonthIso)
    }
  })()
}

/** Warm cache for calendar-adjacent selectable months (typical back-and-forth navigation). */
export function prefetchAdjacentPaperworkMonths(
  routeId: number,
  monthIso: string,
  selectableMonths: ReadonlyArray<{ monthIso: string }>,
  currentMonthIso: string,
): void {
  for (const adjacent of adjacentSelectableMonths(monthIso, selectableMonths)) {
    prefetchPaperworkMonth(routeId, adjacent, currentMonthIso)
  }
}

/** Test helper — not used in production UI. */
export function clearPaperworkPrefetchInFlight(): void {
  for (const entry of inFlightRunDetails.values()) {
    entry.abortController.abort()
  }
  inFlightRunDetails.clear()
  inFlightFieldSubmission.clear()
}
