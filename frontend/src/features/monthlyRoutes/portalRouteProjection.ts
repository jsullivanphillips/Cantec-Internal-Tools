/**
 * Project route worksheet state by applying pending portal workflow queue items in order.
 * Used for UI gating (open clock) and refresh merge so intent wins over stale server snapshots.
 */

import { worksheetStopIsOpenClockIn, type TechnicianWorksheetStop } from './monthlyRoutesShared'
import {
  optimisticCancelClockInPatch,
  optimisticClockInPatch,
  optimisticClockOutPatch,
  optimisticOutcomePatch,
  portalHhmmNow,
  type PortalSkipCategory,
  type PortalTestOutcome,
} from './portalWorkflowShared'
import {
  loadWorkflowSyncQueue,
  type PortalWorkflowAction,
  type PortalWorkflowQueueItem,
} from './worksheetOfflineStore'

export function applyWorkflowActionToStop(
  stop: TechnicianWorksheetStop,
  action: PortalWorkflowAction,
  payload: Record<string, unknown>,
): TechnicianWorksheetStop {
  switch (action) {
    case 'clock_in': {
      const timeIn = String(payload.time_in || portalHhmmNow())
      return { ...stop, ...optimisticClockInPatch(stop, timeIn) }
    }
    case 'clock_out': {
      const timeOut = String(payload.time_out || portalHhmmNow())
      return { ...stop, ...optimisticClockOutPatch(stop, timeOut) }
    }
    case 'cancel_clock_in':
      return { ...stop, ...optimisticCancelClockInPatch(stop) }
    case 'test_outcome': {
      const outcome = payload.test_outcome as PortalTestOutcome
      return {
        ...stop,
        ...optimisticOutcomePatch(stop, outcome, {
          skipCategory: payload.skip_category as PortalSkipCategory | undefined,
          skipNote: String(payload.skip_note ?? ''),
          confirmedNoDeficiencies: Boolean(payload.confirmed_no_deficiencies),
        }),
      }
    }
    case 'reset_stop':
      return {
        ...stop,
        test_outcome: null,
        skip_category: null,
        skip_note: null,
        clock_events: [],
        deficiencies: [],
        time_in: null,
        time_out: null,
        result_status: null,
        skip_reason: null,
        has_run_changes: false,
      }
    default:
      return stop
  }
}

function routeQueueItems(
  routeId: number,
  monthIso: string,
  queue?: PortalWorkflowQueueItem[],
): PortalWorkflowQueueItem[] {
  const source = queue ?? loadWorkflowSyncQueue()
  return source
    .filter((item) => item.routeId === routeId && item.monthIso === monthIso)
    .sort((a, b) => (a.enqueuedAt ?? 0) - (b.enqueuedAt ?? 0))
}

export function projectStopsWithWorkflowQueue(
  stops: TechnicianWorksheetStop[],
  routeId: number,
  monthIso: string,
  queue?: PortalWorkflowQueueItem[],
): TechnicianWorksheetStop[] {
  const items = routeQueueItems(routeId, monthIso, queue)
  if (!items.length) return stops

  const byId = new Map(stops.map((s) => [s.testing_site_id, { ...s }]))
  for (const item of items) {
    if (item.action === 'transition_clock') {
      const fromId = Number(item.payload.from_testing_site_id)
      const toId = Number(item.payload.to_testing_site_id)
      const timeOut = String(item.payload.time_out || portalHhmmNow())
      const timeIn = String(item.payload.time_in || portalHhmmNow())
      const fromStop = byId.get(fromId)
      if (fromStop) {
        byId.set(fromId, { ...fromStop, ...optimisticClockOutPatch(fromStop, timeOut) })
      }
      const toStop = byId.get(toId)
      if (toStop) {
        byId.set(toId, { ...toStop, ...optimisticClockInPatch(toStop, timeIn) })
      }
      continue
    }
    const current = byId.get(item.testingSiteId)
    if (!current) continue
    byId.set(
      item.testingSiteId,
      applyWorkflowActionToStop(current, item.action, item.payload),
    )
  }

  return stops.map((s) => byId.get(s.testing_site_id) ?? s)
}

export function projectedOpenClockSiteId(
  stops: TechnicianWorksheetStop[],
  routeId: number,
  monthIso: string,
  queue?: PortalWorkflowQueueItem[],
): number | null {
  const items = routeQueueItems(routeId, monthIso, queue)
  const projected = projectStopsWithWorkflowQueue(stops, routeId, monthIso, items)
  const openStops = projected.filter(worksheetStopIsOpenClockIn)
  if (openStops.length === 0) return null
  if (openStops.length === 1) return openStops[0].testing_site_id

  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (item.action === 'clock_in') {
      const id = item.testingSiteId
      if (openStops.some((s) => s.testing_site_id === id)) return id
    }
    if (item.action === 'transition_clock') {
      const id = Number(item.payload.to_testing_site_id)
      if (openStops.some((s) => s.testing_site_id === id)) return id
    }
  }
  return openStops[openStops.length - 1].testing_site_id
}

export function projectedOpenClockStop(
  stops: TechnicianWorksheetStop[],
  routeId: number,
  monthIso: string,
  queue?: PortalWorkflowQueueItem[],
): TechnicianWorksheetStop | null {
  const id = projectedOpenClockSiteId(stops, routeId, monthIso, queue)
  if (id == null) return null
  return projectStopsWithWorkflowQueue(stops, routeId, monthIso, queue).find(
    (s) => s.testing_site_id === id,
  ) ?? null
}

export function projectedClockInBlockedForStop(
  stop: TechnicianWorksheetStop,
  stops: TechnicianWorksheetStop[],
  routeId: number,
  monthIso: string,
  queue?: PortalWorkflowQueueItem[],
): boolean {
  const openId = projectedOpenClockSiteId(stops, routeId, monthIso, queue)
  return openId != null && openId !== stop.testing_site_id
}

/** True when clock_in is queued ahead of an earlier clock_out on another site (transient server lag). */
export function isTransientClockInConflict(
  item: PortalWorkflowQueueItem,
  routeId: number,
  monthIso: string,
  stops: TechnicianWorksheetStop[],
  queue?: PortalWorkflowQueueItem[],
): boolean {
  if (item.action !== 'clock_in') return false
  const items = routeQueueItems(routeId, monthIso, queue)
  const idx = items.findIndex((q) => q.id === item.id)
  if (idx < 0) return false
  const prior = items.slice(0, idx)
  const hasPriorClockOutElsewhere = prior.some((q) => {
    if (q.action === 'clock_out') {
      return q.testingSiteId !== item.testingSiteId
    }
    if (q.action === 'transition_clock') {
      return Number(q.payload.to_testing_site_id) === item.testingSiteId
    }
    return false
  })
  if (hasPriorClockOutElsewhere) return true
  const openId = projectedOpenClockSiteId(stops, routeId, monthIso, items)
  return openId == null || openId === item.testingSiteId
}
