/**
 * Project route worksheet state by applying pending portal workflow queue items in order.
 * Used for UI gating (open clock) and refresh merge so intent wins over stale server snapshots.
 */

import { worksheetLocationIsOpenClockIn, type TechnicianWorksheetLocation } from './monthlyRoutesShared'
import {
  optimisticCancelClockInPatch,
  optimisticClockInPatch,
  optimisticClockOutPatch,
  optimisticCreateDeficiencyPatch,
  optimisticOutcomePatch,
  optimisticUpdateDeficiencyPatch,
  optimisticVerifyDeficiencyPatch,
  optimisticResetStopPatch,
  optimisticUpdateClockEventPatch,
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
  stop: TechnicianWorksheetLocation,
  action: PortalWorkflowAction,
  payload: Record<string, unknown>,
): TechnicianWorksheetLocation {
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
    case 'update_clock_event': {
      const clockEventId = Number(payload.clock_event_id)
      const patch: { time_in?: string; time_out?: string | null } = {}
      if (payload.time_in != null) patch.time_in = String(payload.time_in)
      if ('time_out' in payload) {
        patch.time_out =
          payload.time_out == null || payload.time_out === ''
            ? null
            : String(payload.time_out)
      }
      return { ...stop, ...optimisticUpdateClockEventPatch(stop, clockEventId, patch) }
    }
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
    case 'create_deficiency':
      return {
        ...stop,
        ...optimisticCreateDeficiencyPatch(
          stop,
          {
            title: String(payload.title ?? ''),
            severity: String(payload.severity ?? 'deficient'),
            status: String(payload.status ?? 'new'),
            description: payload.description ? String(payload.description) : undefined,
          },
          payload.run_id != null ? Number(payload.run_id) : null,
        ),
      }
    case 'update_deficiency': {
      const deficiencyId = Number(payload.deficiency_id)
      const body = {
        title: payload.title != null ? String(payload.title) : undefined,
        severity: payload.severity != null ? String(payload.severity) : undefined,
        status: payload.status != null ? String(payload.status) : undefined,
        description: payload.description != null ? String(payload.description) : undefined,
      }
      return { ...stop, ...optimisticUpdateDeficiencyPatch(stop, deficiencyId, body) }
    }
    case 'verify_deficiency':
      return {
        ...stop,
        ...optimisticVerifyDeficiencyPatch(stop, Number(payload.deficiency_id)),
      }
    case 'reset_stop':
      return {
        ...stop,
        ...optimisticResetStopPatch(),
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
  stops: TechnicianWorksheetLocation[],
  routeId: number,
  monthIso: string,
  queue?: PortalWorkflowQueueItem[],
): TechnicianWorksheetLocation[] {
  const items = routeQueueItems(routeId, monthIso, queue)
  if (!items.length) return stops

  const byId = new Map(stops.map((s) => [s.location_id, { ...s }]))
  for (const item of items) {
    if (item.action === 'transition_clock') {
      const fromId = Number(item.payload.from_location_id)
      const toId = Number(item.payload.to_location_id)
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
    const current = byId.get(item.locationId)
    if (!current) continue
    byId.set(
      item.locationId,
      applyWorkflowActionToStop(current, item.action, item.payload),
    )
  }

  return stops.map((s) => byId.get(s.location_id) ?? s)
}

export function projectedOpenClockSiteId(
  stops: TechnicianWorksheetLocation[],
  routeId: number,
  monthIso: string,
  queue?: PortalWorkflowQueueItem[],
): number | null {
  const items = routeQueueItems(routeId, monthIso, queue)
  const projected = projectStopsWithWorkflowQueue(stops, routeId, monthIso, items)
  const openStops = projected.filter(worksheetLocationIsOpenClockIn)
  if (openStops.length === 0) return null
  if (openStops.length === 1) return openStops[0].location_id

  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (item.action === 'clock_in') {
      const id = item.locationId
      if (openStops.some((s) => s.location_id === id)) return id
    }
    if (item.action === 'transition_clock') {
      const id = Number(item.payload.to_location_id)
      if (openStops.some((s) => s.location_id === id)) return id
    }
  }
  return openStops[openStops.length - 1].location_id
}

export function projectedOpenClockStop(
  stops: TechnicianWorksheetLocation[],
  routeId: number,
  monthIso: string,
  queue?: PortalWorkflowQueueItem[],
): TechnicianWorksheetLocation | null {
  const id = projectedOpenClockSiteId(stops, routeId, monthIso, queue)
  if (id == null) return null
  return projectStopsWithWorkflowQueue(stops, routeId, monthIso, queue).find(
    (s) => s.location_id === id,
  ) ?? null
}

export function projectedClockInBlockedForStop(
  stop: TechnicianWorksheetLocation,
  stops: TechnicianWorksheetLocation[],
  routeId: number,
  monthIso: string,
  queue?: PortalWorkflowQueueItem[],
): boolean {
  const openId = projectedOpenClockSiteId(stops, routeId, monthIso, queue)
  return openId != null && openId !== stop.location_id
}

/** True when clock_in is queued ahead of an earlier clock_out on another site (transient server lag). */
export function isTransientClockInConflict(
  item: PortalWorkflowQueueItem,
  routeId: number,
  monthIso: string,
  stops: TechnicianWorksheetLocation[],
  queue?: PortalWorkflowQueueItem[],
): boolean {
  if (item.action !== 'clock_in') return false
  const items = routeQueueItems(routeId, monthIso, queue)
  const idx = items.findIndex((q) => q.id === item.id)
  if (idx < 0) return false
  const prior = items.slice(0, idx)
  const hasPriorClockOutElsewhere = prior.some((q) => {
    if (q.action === 'clock_out') {
      return q.locationId !== item.locationId
    }
    if (q.action === 'transition_clock') {
      return Number(q.payload.to_location_id) === item.locationId
    }
    return false
  })
  if (hasPriorClockOutElsewhere) return true
  const openId = projectedOpenClockSiteId(stops, routeId, monthIso, items)
  return openId == null || openId === item.locationId
}
