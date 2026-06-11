/**
 * Serial workflow mutation queue: one server action at a time per route/month.
 * UI applies optimistic patches immediately; drain reconciles in enqueue order.
 */

import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { apiJson } from '../../lib/apiClient'
import {
  WORKSHEET_CLOCK_IN_BLOCKED_MESSAGE,
  type TechnicianWorksheetPayload,
  type TechnicianWorksheetLocation,
  withWorksheetLocations,
  worksheetPayloadLocations,
} from './monthlyRoutesShared'
import { classifyWorkflowError, workflowErrorMessage } from './portalWorkflowErrors'
import { portalStopHasOpenClock } from './portalWorkflowShared'
import type { PortalWorksheetSyncState } from './usePortalWorksheet'
import {
  backoffMs,
  hasPendingRunLifecycleForRouteMonth,
  hasPendingWorkflowForRouteMonth,
  loadSyncQueue,
  loadWorksheetCache,
  loadWorkflowSyncQueue,
  mergeWorkflowQueueIntoPayload,
  preserveWorksheetStopOrderFields,
  saveWorkflowSyncQueue,
  saveWorksheetCache,
  type PortalWorkflowQueueItem,
} from './worksheetOfflineStore'
import { resolveWorkflowQueueItem } from './portalWorkflowQueueWaiters'

export type PortalWorkflowDrainContext = {
  routeId: number
  monthIso: string
  setPayload: Dispatch<SetStateAction<TechnicianWorksheetPayload | null>>
  setSyncState: (s: PortalWorksheetSyncState) => void
  suppressRemoteRefreshUntilRef: MutableRefObject<number>
}

async function executeWorkflowItem(
  item: PortalWorkflowQueueItem,
): Promise<{ stop?: TechnicianWorksheetLocation; from_stop?: TechnicianWorksheetLocation; to_stop?: TechnicianWorksheetLocation }> {
  const qs = new URLSearchParams({ month: item.monthIso, tech_portal: '1' })
  const base = `/api/monthly_routes/routes/${item.routeId}/worksheet/locations/${item.locationId}`
  const q = `?${qs.toString()}`

  switch (item.action) {
    case 'transition_clock':
      return apiJson<{
        ok: boolean
        from_stop: TechnicianWorksheetLocation
        to_stop: TechnicianWorksheetLocation
      }>(`/api/monthly_routes/routes/${item.routeId}/worksheet/transition_clock${q}`, {
        method: 'POST',
        body: JSON.stringify(item.payload),
      })
    case 'clock_in':
      return apiJson<{ ok: boolean; stop: TechnicianWorksheetLocation }>(
        `${base}/clock_events/clock_in${q}`,
        { method: 'POST', body: JSON.stringify(item.payload) },
      )
    case 'clock_out':
      return apiJson<{ ok: boolean; stop: TechnicianWorksheetLocation }>(
        `${base}/clock_events/clock_out${q}`,
        { method: 'POST', body: JSON.stringify(item.payload) },
      )
    case 'cancel_clock_in':
      return apiJson<{ ok: boolean; stop: TechnicianWorksheetLocation }>(
        `${base}/clock_events/cancel_clock_in${q}`,
        { method: 'POST', body: JSON.stringify(item.payload) },
      )
    case 'test_outcome':
      return apiJson<{ ok: boolean; stop: TechnicianWorksheetLocation }>(
        `${base}/test_outcome${q}`,
        { method: 'PUT', body: JSON.stringify(item.payload) },
      )
    case 'create_deficiency':
      return apiJson<{ ok: boolean; stop: TechnicianWorksheetLocation }>(
        `${base}/deficiencies${q}`,
        { method: 'POST', body: JSON.stringify(item.payload) },
      )
    case 'update_deficiency': {
      const defId = item.payload.deficiency_id
      const body = { ...item.payload }
      delete body.deficiency_id
      return apiJson<{ ok: boolean; stop: TechnicianWorksheetLocation }>(
        `${base}/deficiencies/${defId}${q}`,
        { method: 'PATCH', body: JSON.stringify(body) },
      )
    }
    case 'verify_deficiency': {
      const defId = item.payload.deficiency_id
      return apiJson<{ ok: boolean; stop: TechnicianWorksheetLocation }>(
        `${base}/deficiencies/${defId}/verify${q}`,
        { method: 'POST', body: JSON.stringify({ note: item.payload.note }) },
      )
    }
    case 'reset_stop':
      return apiJson<{ ok: boolean; stop: TechnicianWorksheetLocation }>(
        `${base}/reset${q}`,
        { method: 'POST', body: '{}' },
      )
    default:
      throw new Error(`Unknown workflow action: ${item.action}`)
  }
}

function routeQueueItems(routeId: number, monthIso: string): PortalWorkflowQueueItem[] {
  return loadWorkflowSyncQueue()
    .filter((item) => item.routeId === routeId && item.monthIso === monthIso)
    .sort((a, b) => (a.enqueuedAt ?? 0) - (b.enqueuedAt ?? 0))
}

function mergeStopIntoPayload(
  ctx: PortalWorkflowDrainContext,
  stop: TechnicianWorksheetLocation,
): void {
  ctx.setPayload((prev) => {
    const base = worksheetPayloadLocations(prev)
    if (!base.length) return prev
    const prevStop = base.find((s) => s.location_id === stop.location_id)
    let mergedStop = stop
    if (
      prevStop &&
      portalStopHasOpenClock(prevStop) &&
      !portalStopHasOpenClock(stop) &&
      (stop.test_outcome || '').trim()
    ) {
      mergedStop = {
        ...stop,
        clock_events: prevStop.clock_events,
        time_in: prevStop.time_in,
        time_out: prevStop.time_out,
      }
    }
    if (prevStop) {
      mergedStop = preserveWorksheetStopOrderFields(prevStop, mergedStop)
    }
    const nextStops = base.map((s) =>
      s.location_id === stop.location_id ? mergedStop : s,
    )
    const next = mergeWorkflowQueueIntoPayload(
      withWorksheetLocations(prev!, nextStops),
      ctx.routeId,
      ctx.monthIso,
    )
    saveWorksheetCache(next)
    return next
  })
  ctx.suppressRemoteRefreshUntilRef.current = Date.now() + 2500
  if (hasPendingWorkflowForRouteMonth(ctx.routeId, ctx.monthIso)) {
    ctx.suppressRemoteRefreshUntilRef.current = Math.max(
      ctx.suppressRemoteRefreshUntilRef.current,
      Date.now() + 2500,
    )
  }
}

function updateSyncBadge(ctx: PortalWorkflowDrainContext): void {
  const workflowPending = loadWorkflowSyncQueue().some(
    (item) => item.routeId === ctx.routeId && item.monthIso === ctx.monthIso,
  )
  const fieldPending = loadSyncQueue().some(
    (item) =>
      item.routeId === ctx.routeId &&
      item.monthIso === ctx.monthIso &&
      item.locationId != null,
  )
  const runLifecyclePending = hasPendingRunLifecycleForRouteMonth(ctx.routeId, ctx.monthIso)
  ctx.setSyncState(
    workflowPending || fieldPending || runLifecyclePending ? 'saved_offline' : 'synced',
  )
}

function stopsForProjection(ctx: PortalWorkflowDrainContext): TechnicianWorksheetLocation[] {
  const cached = loadWorksheetCache(ctx.routeId, ctx.monthIso)
  return worksheetPayloadLocations(cached)
}

async function processOneItem(
  ctx: PortalWorkflowDrainContext,
  item: PortalWorkflowQueueItem,
): Promise<'done' | 'retry_later' | 'halt'> {
  if (item.nextAttemptAt > Date.now()) {
    return 'halt'
  }

  if (!navigator.onLine) {
    return 'halt'
  }

  try {
    const res = await executeWorkflowItem(item)
    if (item.action === 'transition_clock' && res.from_stop && res.to_stop) {
      mergeStopIntoPayload(ctx, res.from_stop)
      mergeStopIntoPayload(ctx, res.to_stop)
    } else if (res.stop) {
      mergeStopIntoPayload(ctx, res.stop)
    }
    const nextQueue = loadWorkflowSyncQueue().filter((q) => q.id !== item.id)
    saveWorkflowSyncQueue(nextQueue)
    resolveWorkflowQueueItem(item.id, {
      ok: true,
      stop: res.stop ?? res.to_stop,
    })
    return 'done'
  } catch (e) {
    const err = e as { code?: string; error?: string }
    const disposition = classifyWorkflowError(e, item.action, {
      item,
      stops: stopsForProjection(ctx),
      routeId: ctx.routeId,
      monthIso: ctx.monthIso,
    })

    if (disposition === 'idempotent_ok') {
      const nextQueue = loadWorkflowSyncQueue().filter((q) => q.id !== item.id)
      saveWorkflowSyncQueue(nextQueue)
      resolveWorkflowQueueItem(item.id, { ok: true })
      return 'done'
    }

    if (disposition === 'alert_drop') {
      if (err?.code === 'open_clock_in_conflict') {
        window.alert(WORKSHEET_CLOCK_IN_BLOCKED_MESSAGE)
      } else {
        window.alert(workflowErrorMessage(err?.code, err.error))
      }
      const nextQueue = loadWorkflowSyncQueue().filter((q) => q.id !== item.id)
      saveWorkflowSyncQueue(nextQueue)
      resolveWorkflowQueueItem(item.id, { ok: false })
      return 'done'
    }

    const nextQueue = loadWorkflowSyncQueue().map((q) =>
      q.id !== item.id
        ? q
        : {
            ...q,
            attempts: q.attempts + 1,
            nextAttemptAt: Date.now() + backoffMs(q.attempts + 1),
          },
    )
    saveWorkflowSyncQueue(nextQueue)
    resolveWorkflowQueueItem(item.id, { ok: false, queued: true })
    return 'retry_later'
  }
}

/**
 * Drain workflow mutations strictly in enqueue order (one in flight at a time).
 */
export async function drainPortalWorkflowQueue(
  ctx: PortalWorkflowDrainContext,
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
      if (hasPendingRunLifecycleForRouteMonth(ctx.routeId, ctx.monthIso)) {
        break
      }

      const head = routeQueueItems(ctx.routeId, ctx.monthIso)[0]
      if (!head) break

      const outcome = await processOneItem(ctx, head)
      if (outcome === 'halt') break
      // 'done' and 'retry_later' continue to next head
    }
  } finally {
    syncingRef.current = false
    updateSyncBadge(ctx)

    const stillReady = routeQueueItems(ctx.routeId, ctx.monthIso).some(
      (item) => item.nextAttemptAt <= Date.now(),
    )
    if (stillReady && navigator.onLine) {
      void drainPortalWorkflowQueue(ctx, syncingRef)
    }
  }
}
