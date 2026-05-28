/** Offline sync entry — delegates to serial workflow queue runner. */

import type { PortalWorkflowDrainContext } from './portalWorkflowQueueRunner'
import { drainPortalWorkflowQueue } from './portalWorkflowQueueRunner'

export type PortalWorkflowSyncContext = PortalWorkflowDrainContext

export async function runPortalWorkflowSyncQueue(
  ctx: PortalWorkflowDrainContext,
  syncingRef: { current: boolean },
): Promise<void> {
  await drainPortalWorkflowQueue(ctx, syncingRef)
}
