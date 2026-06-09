/**
 * Serial run lifecycle mutation queue: start run must commit before workflow drain.
 */

import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { apiJson } from '../../lib/apiClient'
import type { TechnicianWorksheetPayload, TechnicianWorksheetRun } from './monthlyRoutesShared'
import type { PortalWorksheetSyncState } from './usePortalWorksheet'
import {
  backoffMs,
  loadRunLifecycleSyncQueue,
  loadSyncQueue,
  loadWorkflowSyncQueue,
  saveRunLifecycleSyncQueue,
  saveWorksheetCache,
  type PortalRunLifecycleQueueItem,
} from './worksheetOfflineStore'

export type PortalRunLifecycleDrainContext = {
  routeId: number
  monthIso: string
  setPayload: Dispatch<SetStateAction<TechnicianWorksheetPayload | null>>
  setSyncState: (s: PortalWorksheetSyncState) => void
  suppressRemoteRefreshUntilRef: MutableRefObject<number>
}

function routeQueueItems(routeId: number, monthIso: string): PortalRunLifecycleQueueItem[] {
  return loadRunLifecycleSyncQueue()
    .filter((item) => item.routeId === routeId && item.monthIso === monthIso)
    .sort((a, b) => (a.enqueuedAt ?? 0) - (b.enqueuedAt ?? 0))
}

function mergeRunIntoPayload(ctx: PortalRunLifecycleDrainContext, run: TechnicianWorksheetRun): void {
  ctx.setPayload((prev) => {
    if (!prev) return prev
    const next = { ...prev, run }
    saveWorksheetCache(next)
    return next
  })
  ctx.suppressRemoteRefreshUntilRef.current = Date.now() + 2500
}

function revertOptimisticStartRun(ctx: PortalRunLifecycleDrainContext): void {
  ctx.setPayload((prev) => {
    if (!prev?.run) return prev
    const next = {
      ...prev,
      run: { ...prev.run, started_at: null },
    }
    saveWorksheetCache(next)
    return next
  })
}

function updateSyncBadge(ctx: PortalRunLifecycleDrainContext): void {
  const runLifecyclePending = loadRunLifecycleSyncQueue().some(
    (item) => item.routeId === ctx.routeId && item.monthIso === ctx.monthIso,
  )
  const workflowPending = loadWorkflowSyncQueue().some(
    (item) => item.routeId === ctx.routeId && item.monthIso === ctx.monthIso,
  )
  const fieldPending = loadSyncQueue().some(
    (item) =>
      item.routeId === ctx.routeId &&
      item.monthIso === ctx.monthIso &&
      item.testingSiteId != null,
  )
  ctx.setSyncState(
    runLifecyclePending || workflowPending || fieldPending ? 'saved_offline' : 'synced',
  )
}

async function executeRunLifecycleItem(
  item: PortalRunLifecycleQueueItem,
): Promise<{ run: TechnicianWorksheetRun }> {
  switch (item.action) {
    case 'start_run':
      return apiJson<{ run: TechnicianWorksheetRun }>(
        `/api/technician_portal/routes/${item.routeId}/runs`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        },
      )
    default:
      throw new Error(`Unknown run lifecycle action: ${item.action}`)
  }
}

async function processOneItem(
  ctx: PortalRunLifecycleDrainContext,
  item: PortalRunLifecycleQueueItem,
): Promise<'done' | 'retry_later' | 'halt'> {
  if (item.nextAttemptAt > Date.now()) {
    return 'halt'
  }

  if (!navigator.onLine) {
    return 'halt'
  }

  try {
    const res = await executeRunLifecycleItem(item)
    mergeRunIntoPayload(ctx, res.run)
    const nextQueue = loadRunLifecycleSyncQueue().filter((q) => q.id !== item.id)
    saveRunLifecycleSyncQueue(nextQueue)
    return 'done'
  } catch (e) {
    const err = e as { code?: string }
    if (err?.code === 'run_not_prepared') {
      window.alert('Office has not released this route for testing yet.')
      revertOptimisticStartRun(ctx)
      const nextQueue = loadRunLifecycleSyncQueue().filter((q) => q.id !== item.id)
      saveRunLifecycleSyncQueue(nextQueue)
      return 'done'
    }

    const nextQueue = loadRunLifecycleSyncQueue().map((q) =>
      q.id !== item.id
        ? q
        : {
            ...q,
            attempts: q.attempts + 1,
            nextAttemptAt: Date.now() + backoffMs(q.attempts + 1),
          },
    )
    saveRunLifecycleSyncQueue(nextQueue)
    return 'retry_later'
  }
}

/** Drain run lifecycle mutations strictly in enqueue order (one in flight at a time). */
export async function drainPortalRunLifecycleQueue(
  ctx: PortalRunLifecycleDrainContext,
  syncingRef: { current: boolean },
): Promise<void> {
  if (syncingRef.current) return

  const pending = routeQueueItems(ctx.routeId, ctx.monthIso)
  if (pending.length === 0) {
    updateSyncBadge(ctx)
    return
  }

  syncingRef.current = true
  ctx.setSyncState('syncing')

  try {
    while (navigator.onLine) {
      const head = routeQueueItems(ctx.routeId, ctx.monthIso)[0]
      if (!head) break

      const outcome = await processOneItem(ctx, head)
      if (outcome === 'halt') break
    }
  } finally {
    syncingRef.current = false
    updateSyncBadge(ctx)

    const stillReady = routeQueueItems(ctx.routeId, ctx.monthIso).some(
      (item) => item.nextAttemptAt <= Date.now(),
    )
    if (stillReady && navigator.onLine) {
      void drainPortalRunLifecycleQueue(ctx, syncingRef)
    }
  }
}
