import { invalidatePaperworkCacheForRoute } from './paperworkRouteCache'

const CHANNEL = 'paperwork-master-sync-v1'

export type PaperworkMasterSyncMessage = {
  routeId: number
}

/** Library master saved — bust paperwork cache and notify open paperwork tabs. */
export function notifyPaperworkMasterSiteUpdated(routeId: number): void {
  if (!Number.isFinite(routeId)) return
  invalidatePaperworkCacheForRoute(routeId)
  try {
    const channel = new BroadcastChannel(CHANNEL)
    channel.postMessage({ routeId } satisfies PaperworkMasterSyncMessage)
    channel.close()
  } catch {
    // BroadcastChannel unavailable (SSR / older browsers).
  }
}

/** Listen for library master edits affecting this route's paperwork view. */
export function subscribePaperworkMasterSync(
  routeId: number,
  onSync: () => void,
): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {}
  const channel = new BroadcastChannel(CHANNEL)
  channel.onmessage = (event: MessageEvent<PaperworkMasterSyncMessage>) => {
    if (event.data?.routeId === routeId) onSync()
  }
  return () => channel.close()
}
