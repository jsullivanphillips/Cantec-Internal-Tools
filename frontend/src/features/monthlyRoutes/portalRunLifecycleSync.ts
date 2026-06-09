/** Offline sync entry — delegates to serial run lifecycle queue runner. */

import type { PortalRunLifecycleDrainContext } from './portalRunLifecycleQueueRunner'
import { drainPortalRunLifecycleQueue } from './portalRunLifecycleQueueRunner'

export async function runPortalRunLifecycleSyncQueue(
  ctx: PortalRunLifecycleDrainContext,
  syncingRef: { current: boolean },
): Promise<void> {
  await drainPortalRunLifecycleQueue(ctx, syncingRef)
}
