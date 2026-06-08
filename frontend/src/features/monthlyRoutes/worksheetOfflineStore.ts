import type {
  TechnicianWorksheetPayload,
  TechnicianWorksheetRow,
  TechnicianWorksheetStop,
} from './monthlyRoutesShared'
import { projectStopsWithWorkflowQueue } from './portalRouteProjection'
import {
  portalStopHasOpenClock,
  portalStopHasTestOutcome,
  portalStopVisitComplete,
} from './portalWorkflowShared'

export type WorksheetChangeSet = Partial<
  Pick<
    TechnicianWorksheetRow,
    | 'annual_month'
    | 'ring'
    | 'key_number'
    | 'facp'
    | 'monitoring'
    | 'result_status'
    | 'skip_reason'
    | 'testing_procedures'
    | 'inspection_tech_notes'
    | 'time_in'
    | 'time_out'
  >
>

/** Portal v2 stop PATCH fields (maps to ``MonthlyTestingSiteMonth``). */
export type WorksheetStopChangeSet = Partial<
  Pick<
    TechnicianWorksheetStop,
    | 'annual_month'
    | 'ring'
    | 'key_number'
    | 'panel'
    | 'panel_location'
    | 'door_code'
    | 'property_management_company'
    | 'building_name'
    | 'monitoring_company'
    | 'monitoring_company_id'
    | 'monitoring_account_number'
    | 'monitoring_password'
    | 'monitoring_notes'
    | 'result_status'
    | 'skip_reason'
    | 'testing_procedures'
    | 'inspection_tech_notes'
    | 'run_comments'
    | 'time_in'
    | 'time_out'
  >
> & {
  /** Local optimistic display only; never sent to the API. */
  monitoring_company_record?: TechnicianWorksheetStop['monitoring_company_record']
}

const LOCAL_ONLY_WORKSHEET_STOP_CHANGE_KEYS = new Set(['monitoring_company', 'monitoring_company_record'])

/** Strip client-only optimistic fields before PATCH. */
export function worksheetStopChangesForSync(changes: WorksheetStopChangeSet): WorksheetStopChangeSet {
  const next: WorksheetStopChangeSet = { ...changes }
  for (const key of LOCAL_ONLY_WORKSHEET_STOP_CHANGE_KEYS) {
    delete next[key as keyof WorksheetStopChangeSet]
  }
  return next
}

export type WorksheetQueueItem = {
  id: string
  routeId: number
  /** Legacy staff worksheet row PATCH. */
  locationId?: number
  /** Portal v2 stop PATCH. */
  testingSiteId?: number
  monthIso: string
  expectedUpdatedAt: string | null
  clientMutatedAt: string
  /** When true, PATCH includes ``tech_portal=1`` (technician worksheet); omit on legacy queued items. */
  techPortal?: boolean
  changes: WorksheetChangeSet | WorksheetStopChangeSet
  attempts: number
  nextAttemptAt: number
}

const CACHE_PREFIX = 'monthlyWorksheetCache::'
const QUEUE_KEY = 'monthlyWorksheetSyncQueue'
const WORKFLOW_QUEUE_KEY = 'portalWorkflowSyncQueue'
const COMPLETION_KEY_PREFIX = 'monthlyWorksheetCompletion::'

export type PortalWorkflowAction =
  | 'clock_in'
  | 'clock_out'
  | 'cancel_clock_in'
  | 'test_outcome'
  | 'create_deficiency'
  | 'update_deficiency'
  | 'verify_deficiency'
  | 'reset_stop'
  | 'transition_clock'

export type PortalWorkflowQueueItem = {
  id: string
  action: PortalWorkflowAction
  routeId: number
  monthIso: string
  testingSiteId: number
  payload: Record<string, unknown>
  attempts: number
  nextAttemptAt: number
  /** Monotonic enqueue time for FIFO ordering. */
  enqueuedAt: number
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function safeParse<T>(text: string | null): T | null {
  if (!text) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

export function cacheKey(routeId: number, monthIso: string): string {
  return `${CACHE_PREFIX}${routeId}::${monthIso}`
}

export function loadWorksheetCache(routeId: number, monthIso: string): TechnicianWorksheetPayload | null {
  return safeParse<TechnicianWorksheetPayload>(localStorage.getItem(cacheKey(routeId, monthIso)))
}

export function saveWorksheetCache(payload: TechnicianWorksheetPayload): void {
  const routeId = Number(payload.route.id)
  const monthIso = payload.month_date
  localStorage.setItem(cacheKey(routeId, monthIso), JSON.stringify(payload))
}

export function clearWorksheetCache(routeId: number, monthIso: string): void {
  localStorage.removeItem(cacheKey(routeId, monthIso))
}

export function markCompletionPending(routeId: number, monthIso: string, value: boolean): void {
  const key = `${COMPLETION_KEY_PREFIX}${routeId}::${monthIso}`
  if (value) localStorage.setItem(key, '1')
  else localStorage.removeItem(key)
}

export function completionPending(routeId: number, monthIso: string): boolean {
  return localStorage.getItem(`${COMPLETION_KEY_PREFIX}${routeId}::${monthIso}`) === '1'
}

export function loadSyncQueue(): WorksheetQueueItem[] {
  return safeParse<WorksheetQueueItem[]>(localStorage.getItem(QUEUE_KEY)) ?? []
}

export function saveSyncQueue(items: WorksheetQueueItem[]): void {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(items))
}

export function enqueueWorksheetChange(item: Omit<WorksheetQueueItem, 'id' | 'attempts' | 'nextAttemptAt'>): WorksheetQueueItem {
  const queue = loadSyncQueue()
  const qItem: WorksheetQueueItem = {
    ...item,
    id: randomId(),
    attempts: 0,
    nextAttemptAt: Date.now(),
  }
  queue.push(qItem)
  saveSyncQueue(queue)
  return qItem
}

export function backoffMs(attempts: number): number {
  const base = 1500
  const max = 60_000
  return Math.min(max, base * 2 ** Math.max(attempts - 1, 0))
}

export function loadWorkflowSyncQueue(): PortalWorkflowQueueItem[] {
  return safeParse<PortalWorkflowQueueItem[]>(localStorage.getItem(WORKFLOW_QUEUE_KEY)) ?? []
}

export function saveWorkflowSyncQueue(items: PortalWorkflowQueueItem[]): void {
  localStorage.setItem(WORKFLOW_QUEUE_KEY, JSON.stringify(items))
}

export function enqueuePortalWorkflowAction(
  item: Omit<PortalWorkflowQueueItem, 'id' | 'attempts' | 'nextAttemptAt' | 'enqueuedAt'>,
): PortalWorkflowQueueItem {
  const queue = loadWorkflowSyncQueue()
  const filtered = queue.filter(
    (q) =>
      !(
        q.routeId === item.routeId &&
        q.monthIso === item.monthIso &&
        q.testingSiteId === item.testingSiteId &&
        q.action === item.action
      ),
  )
  const qItem: PortalWorkflowQueueItem = {
    ...item,
    id: randomId(),
    attempts: 0,
    nextAttemptAt: Date.now(),
    enqueuedAt: Date.now(),
  }
  filtered.push(qItem)
  saveWorkflowSyncQueue(filtered)
  return qItem
}

export function hasPendingWorkflowForRouteMonth(routeId: number, monthIso: string): boolean {
  return loadWorkflowSyncQueue().some(
    (item) => item.routeId === routeId && item.monthIso === monthIso,
  )
}

export function hasPendingSyncForRouteMonth(routeId: number, monthIso: string): boolean {
  const fieldPending = loadSyncQueue().some(
    (item) =>
      item.routeId === routeId &&
      item.monthIso === monthIso &&
      item.testingSiteId != null,
  )
  const workflowPending = loadWorkflowSyncQueue().some(
    (item) => item.routeId === routeId && item.monthIso === monthIso,
  )
  return fieldPending || workflowPending
}

/** Unsynced field edits for one stop (optionally skip queue items already applied on the server). */
export function collectPendingStopChanges(
  routeId: number,
  monthIso: string,
  testingSiteId: number,
  excludeItemIds?: ReadonlySet<string> | string,
): WorksheetStopChangeSet {
  const exclude =
    typeof excludeItemIds === 'string'
      ? new Set([excludeItemIds])
      : excludeItemIds ?? new Set<string>()
  let patch: WorksheetStopChangeSet = {}
  for (const item of loadSyncQueue()) {
    if (
      item.routeId !== routeId ||
      item.monthIso !== monthIso ||
      item.testingSiteId !== testingSiteId
    ) {
      continue
    }
    if (exclude.has(item.id)) continue
    patch = { ...patch, ...(item.changes as WorksheetStopChangeSet) }
  }
  return patch
}

export function applyServerStopWithPending(
  serverStop: TechnicianWorksheetStop,
  routeId: number,
  monthIso: string,
  excludeItemId: string,
  localStop?: TechnicianWorksheetStop,
): TechnicianWorksheetStop {
  const pending = collectPendingStopChanges(routeId, monthIso, serverStop.testing_site_id, excludeItemId)
  const merged =
    Object.keys(pending).length > 0 ? { ...serverStop, ...pending } : serverStop
  return localStop ? preserveWorksheetStopOrderFields(localStop, merged) : merged
}

/** Keep route sheet stop # stable when workflow PATCH responses recalculate order. */
export function preserveWorksheetStopOrderFields(
  local: TechnicianWorksheetStop,
  remote: TechnicianWorksheetStop,
): TechnicianWorksheetStop {
  const stopNumber =
    Number.isFinite(local.stop_number) && local.stop_number > 0
      ? local.stop_number
      : remote.stop_number
  return {
    ...remote,
    stop_number: stopNumber,
    session_route_stop_order:
      local.session_route_stop_order ?? remote.session_route_stop_order,
  }
}

/** Apply pending portal workflow queue onto worksheet stops (intent over stale server). */
export function mergeWorkflowQueueIntoPayload(
  payload: TechnicianWorksheetPayload,
  routeId: number,
  monthIso: string,
  queue?: PortalWorkflowQueueItem[],
): TechnicianWorksheetPayload {
  if (!payload.stops?.length) return payload
  const items =
    queue ??
    loadWorkflowSyncQueue().filter(
      (item) => item.routeId === routeId && item.monthIso === monthIso,
    )
  if (!items.length) return payload
  const stops = projectStopsWithWorkflowQueue(payload.stops, routeId, monthIso, items)
  return { ...payload, stops }
}

/** Overlay unsynced portal stop edits so SSE/GET refresh does not wipe optimistic clock-ins. */
export function mergePendingChangesIntoPayload(
  payload: TechnicianWorksheetPayload,
  routeId: number,
  monthIso: string,
): TechnicianWorksheetPayload {
  const queue = loadSyncQueue().filter(
    (item) =>
      item.routeId === routeId &&
      item.monthIso === monthIso &&
      item.testingSiteId != null,
  )
  let next = payload
  if (queue.length && payload.stops?.length) {
    const pendingBySite = new Map<number, WorksheetStopChangeSet>()
    for (const item of queue) {
      const siteId = item.testingSiteId
      if (siteId == null) continue
      pendingBySite.set(siteId, {
        ...pendingBySite.get(siteId),
        ...(item.changes as WorksheetStopChangeSet),
      })
    }

    const stops = payload.stops.map((stop) => {
      const patch = pendingBySite.get(stop.testing_site_id)
      return patch ? { ...stop, ...patch } : stop
    })
    next = { ...payload, stops }
  }
  return mergeWorkflowQueueIntoPayload(next, routeId, monthIso)
}

/** Keep local intent when a background fetch is behind the workflow queue. */
export function reconcileStopWithServer(
  local: TechnicianWorksheetStop,
  remote: TechnicianWorksheetStop,
): TechnicianWorksheetStop {
  if (portalStopHasTestOutcome(local) && !portalStopHasTestOutcome(remote)) {
    return preserveWorksheetStopOrderFields(local, {
      ...remote,
      test_outcome: local.test_outcome,
      skip_category: local.skip_category,
      skip_note: local.skip_note,
      result_status: local.result_status,
      skip_reason: local.skip_reason,
      confirmed_no_deficiencies: local.confirmed_no_deficiencies,
      is_legacy_outcome: local.is_legacy_outcome,
      clock_events: local.clock_events,
      time_in: local.time_in,
      time_out: local.time_out,
    })
  }
  if (
    portalStopVisitComplete(local) &&
    portalStopHasOpenClock(remote) &&
    !portalStopHasOpenClock(local)
  ) {
    return preserveWorksheetStopOrderFields(local, {
      ...remote,
      clock_events: local.clock_events,
      time_in: local.time_in,
      time_out: local.time_out,
    })
  }
  return preserveWorksheetStopOrderFields(local, remote)
}

/** Merge a background worksheet fetch into existing UI state without replacing the stop list order. */
export function mergeServerWorksheetPayload(
  prev: TechnicianWorksheetPayload,
  server: TechnicianWorksheetPayload,
  routeId: number,
  monthIso: string,
): TechnicianWorksheetPayload {
  const workflowPending = hasPendingWorkflowForRouteMonth(routeId, monthIso)
  const serverStops = server.stops ?? []
  const serverById = new Map(serverStops.map((s) => [s.testing_site_id, s]))
  const prevIds = new Set((prev.stops ?? []).map((s) => s.testing_site_id))

  const stops: TechnicianWorksheetStop[] = []
  for (const s of prev.stops ?? []) {
    const remote = serverById.get(s.testing_site_id)
    if (!remote) {
      stops.push(s)
      continue
    }
    const pending = collectPendingStopChanges(routeId, monthIso, s.testing_site_id)
    let merged = workflowPending ? reconcileStopWithServer(s, remote) : remote
    merged = Object.keys(pending).length > 0 ? { ...merged, ...pending } : merged
    stops.push(merged)
  }
  for (const s of serverStops) {
    if (!prevIds.has(s.testing_site_id)) {
      stops.push(s)
    }
  }

  return mergeWorkflowQueueIntoPayload({ ...server, stops }, routeId, monthIso)
}
