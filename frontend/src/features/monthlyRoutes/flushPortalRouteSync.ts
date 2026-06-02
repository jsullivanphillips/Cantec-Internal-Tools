/**
 * Block run lifecycle actions until portal field + workflow queues for a route/month are idle.
 */

import { hasPendingSyncForRouteMonth } from './worksheetOfflineStore'

export type PortalRouteSyncRunners = {
  runFieldSyncQueue: () => Promise<void>
  runWorkflowSyncQueue: () => Promise<void>
  isFieldSyncing: () => boolean
  isWorkflowSyncing: () => boolean
}

const DEFAULT_MAX_WAIT_MS = 120_000
const POLL_MS = 50

/** Drain pending portal sync for one route/month; false if timed out or still offline with backlog. */
export async function waitForPortalRouteSyncIdle(
  routeId: number,
  monthIso: string,
  runners: PortalRouteSyncRunners,
  maxWaitMs: number = DEFAULT_MAX_WAIT_MS,
): Promise<boolean> {
  if (!navigator.onLine) {
    return !hasPendingSyncForRouteMonth(routeId, monthIso)
  }

  const deadline = Date.now() + maxWaitMs
  while (Date.now() < deadline) {
    await runners.runWorkflowSyncQueue()
    await runners.runFieldSyncQueue()

    const pending = hasPendingSyncForRouteMonth(routeId, monthIso)
    const busy = runners.isFieldSyncing() || runners.isWorkflowSyncing()
    if (!pending && !busy) {
      return true
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }

  return !hasPendingSyncForRouteMonth(routeId, monthIso) &&
    !runners.isFieldSyncing() &&
    !runners.isWorkflowSyncing()
}
