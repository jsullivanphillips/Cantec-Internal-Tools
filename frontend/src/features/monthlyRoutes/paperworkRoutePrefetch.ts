import { apiJson } from '../../lib/apiClient'
import type { MonthlyRunDetailPayload } from './monthlyRoutesShared'
import { derivePaperworkViewMode } from './paperworkViewMode'
import type { PaperworkFieldSubmissionCache } from './paperworkRouteCache'
import {
  getCachedFieldSubmission,
  getCachedJobItems,
  getCachedRunDetails,
  setCachedFieldSubmission,
  setCachedJobItems,
  setCachedRunDetails,
} from './paperworkRouteCache'
import { runFieldEnded } from './runWorkflowShared'

function prefetchKey(routeId: number, monthIso: string): string {
  return `${routeId}::${monthIso}`
}

const inFlightRunDetails = new Set<string>()
const inFlightFieldSubmission = new Set<string>()
const inFlightJobItems = new Set<string>()

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

  const key = prefetchKey(routeId, monthIso)
  if (inFlightRunDetails.has(key)) return null

  inFlightRunDetails.add(key)
  try {
    const qs = new URLSearchParams({ month: monthIso })
    const data = await apiJson<MonthlyRunDetailPayload>(
      `/api/monthly_routes/routes/${routeId}/run_details?${qs.toString()}`,
    )
    if (data.month_date !== monthIso) return null
    setCachedRunDetails(routeId, monthIso, data)
    return data
  } catch {
    return null
  } finally {
    inFlightRunDetails.delete(key)
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

async function prefetchPaperworkJobItems(routeId: number, monthIso: string): Promise<void> {
  if (getCachedJobItems(routeId, monthIso)) return

  const key = prefetchKey(routeId, monthIso)
  if (inFlightJobItems.has(key)) return

  inFlightJobItems.add(key)
  try {
    const qs = new URLSearchParams({ month: monthIso })
    const data = await apiJson<{
      items: { location_id: number; description: string; quantity: number }[]
    }>(`/api/monthly_routes/routes/${routeId}/run_job_items?${qs.toString()}`)
    const byLoc: Record<number, { description: string; quantity: number }[]> = {}
    for (const item of data.items ?? []) {
      const lid = item.location_id
      if (!byLoc[lid]) byLoc[lid] = []
      byLoc[lid].push({ description: item.description, quantity: item.quantity })
    }
    setCachedJobItems(routeId, monthIso, byLoc)
  } catch {
    // Prefetch failures are silent.
  } finally {
    inFlightJobItems.delete(key)
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
    return
  }
  if (viewMode === 'run_review' && runFieldEnded(payload.run)) {
    await prefetchPaperworkJobItems(routeId, monthIso)
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
  inFlightRunDetails.clear()
  inFlightFieldSubmission.clear()
  inFlightJobItems.clear()
}
