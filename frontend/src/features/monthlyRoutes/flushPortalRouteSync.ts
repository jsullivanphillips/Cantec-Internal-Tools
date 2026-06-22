/**
 * Block run lifecycle actions until portal field + workflow queues for a route/month are idle.
 */

import type { PortalSyncProgressSnapshot } from './portalRunLifecycleProgress'
import {
  countPendingSyncBreakdownForRouteMonth,
  hasPendingSyncForRouteMonth,
} from './worksheetOfflineStore'

export type PortalRouteSyncRunners = {
  runRunLifecycleSyncQueue: () => Promise<void>
  runFieldSyncQueue: () => Promise<void>
  runWorkflowSyncQueue: () => Promise<void>
  isFieldSyncing: () => boolean
  isWorkflowSyncing: () => boolean
  isRunLifecycleSyncing: () => boolean
}

const DEFAULT_MAX_WAIT_MS = 120_000
const POLL_MS = 50

export type PortalRouteSyncWaitOptions = {
  maxWaitMs?: number
  onProgress?: (snapshot: PortalSyncProgressSnapshot) => void
}

function activeSyncQueue(runners: PortalRouteSyncRunners): PortalSyncProgressSnapshot['activeQueue'] {
  if (runners.isRunLifecycleSyncing()) return 'run_lifecycle'
  if (runners.isWorkflowSyncing()) return 'workflow'
  if (runners.isFieldSyncing()) return 'field'
  return null
}

function buildSyncProgressSnapshot(
  routeId: number,
  monthIso: string,
  runners: PortalRouteSyncRunners,
  initialTotal: number,
): PortalSyncProgressSnapshot {
  const breakdown = countPendingSyncBreakdownForRouteMonth(routeId, monthIso)
  return {
    initialTotal,
    remaining: breakdown.total,
    breakdown,
    activeQueue: activeSyncQueue(runners),
  }
}

/** Drain pending portal sync for one route/month; false if timed out or still offline with backlog. */
export async function waitForPortalRouteSyncIdle(
  routeId: number,
  monthIso: string,
  runners: PortalRouteSyncRunners,
  options: PortalRouteSyncWaitOptions | number = {},
): Promise<boolean> {
  const maxWaitMs =
    typeof options === 'number' ? options : (options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS)
  const onProgress = typeof options === 'number' ? undefined : options.onProgress

  if (!navigator.onLine) {
    return !hasPendingSyncForRouteMonth(routeId, monthIso)
  }

  const initialTotal = countPendingSyncBreakdownForRouteMonth(routeId, monthIso).total
  onProgress?.(buildSyncProgressSnapshot(routeId, monthIso, runners, initialTotal))

  const deadline = Date.now() + maxWaitMs
  while (Date.now() < deadline) {
    await runners.runRunLifecycleSyncQueue()
    await runners.runWorkflowSyncQueue()
    await runners.runFieldSyncQueue()

    onProgress?.(buildSyncProgressSnapshot(routeId, monthIso, runners, initialTotal))

    const pending = hasPendingSyncForRouteMonth(routeId, monthIso)
    const busy =
      runners.isFieldSyncing() ||
      runners.isWorkflowSyncing() ||
      runners.isRunLifecycleSyncing()
    if (!pending && !busy) {
      onProgress?.(buildSyncProgressSnapshot(routeId, monthIso, runners, initialTotal))
      return true
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }

  onProgress?.(buildSyncProgressSnapshot(routeId, monthIso, runners, initialTotal))
  return (
    !hasPendingSyncForRouteMonth(routeId, monthIso) &&
    !runners.isFieldSyncing() &&
    !runners.isWorkflowSyncing() &&
    !runners.isRunLifecycleSyncing()
  )
}
