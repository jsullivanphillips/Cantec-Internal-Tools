/**
 * Cancel clock-in coordination when a pending clock_in has not yet reached the server.
 */

import { applyWorkflowActionToStop } from './portalRouteProjection'
import type { TechnicianWorksheetLocation } from './monthlyRoutesShared'
import { optimisticCancelClockInPatch } from './portalWorkflowShared'
import {
  loadWorkflowSyncQueue,
  type PortalWorkflowQueueItem,
} from './worksheetOfflineStore'

export function routeWorkflowQueueItems(
  routeId: number,
  monthIso: string,
  queue?: PortalWorkflowQueueItem[],
): PortalWorkflowQueueItem[] {
  const source = queue ?? loadWorkflowSyncQueue()
  return source
    .filter((item) => item.routeId === routeId && item.monthIso === monthIso)
    .sort((a, b) => (a.enqueuedAt ?? 0) - (b.enqueuedAt ?? 0))
}

export function pendingClockInForStop(
  queue: PortalWorkflowQueueItem[],
  locationId: number,
): PortalWorkflowQueueItem | undefined {
  return queue.find((q) => q.locationId === locationId && q.action === 'clock_in')
}

/** Revert optimistic clock-in intent for a stop that never committed on the server. */
export function cancelClockInRevertPatch(
  stop: TechnicianWorksheetLocation,
  pendingClockIn: PortalWorkflowQueueItem,
): Partial<TechnicianWorksheetLocation> {
  const withClock = applyWorkflowActionToStop(stop, 'clock_in', pendingClockIn.payload)
  return optimisticCancelClockInPatch(withClock)
}

/** True when clock_in is at the head of the route queue (next to run or in flight). */
export function isPendingClockInQueueHead(
  queue: PortalWorkflowQueueItem[],
  pendingClockIn: PortalWorkflowQueueItem,
): boolean {
  return queue[0]?.id === pendingClockIn.id
}

/** @deprecated Use isPendingClockInQueueHead */
export const shouldChainCancelAfterClockIn = isPendingClockInQueueHead
