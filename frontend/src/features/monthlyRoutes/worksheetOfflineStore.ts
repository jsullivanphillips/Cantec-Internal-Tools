import type {
  TechnicianWorksheetPayload,
  TechnicianWorksheetRow,
  TechnicianWorksheetRun,
  TechnicianWorksheetLocation,
} from './monthlyRoutesShared'
import {
  normalizeWorksheetPayload,
  worksheetPayloadLocations,
  withWorksheetLocations,
  worksheetRunExplicitlyCompleted,
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

/** Portal worksheet location PATCH fields (maps to ``MonthlyLocationMonth``). */
export type WorksheetStopChangeSet = Partial<
  Pick<
    TechnicianWorksheetLocation,
    | 'annual_month'
    | 'ring'
    | 'key_number'
    | 'panel'
    | 'panel_location'
    | 'door_code'
    | 'property_management_company'
    | 'label'
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
  monitoring_company_record?: TechnicianWorksheetLocation['monitoring_company_record']
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
  /** Worksheet row or portal location PATCH target id. */
  locationId?: number
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
const RUN_LIFECYCLE_QUEUE_KEY = 'portalRunLifecycleSyncQueue'
const COMPLETION_KEY_PREFIX = 'monthlyWorksheetCompletion::'

export type PortalRunLifecycleAction = 'start_run'

export type PortalRunLifecycleQueueItem = {
  id: string
  action: PortalRunLifecycleAction
  routeId: number
  monthIso: string
  /** Optimistic ``started_at`` for ``start_run`` until the server confirms. */
  clientStartedAt?: string
  attempts: number
  nextAttemptAt: number
  /** Monotonic enqueue time for FIFO ordering. */
  enqueuedAt: number
}

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
  locationId: number
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
  const raw = safeParse<TechnicianWorksheetPayload>(localStorage.getItem(cacheKey(routeId, monthIso)))
  return raw ? normalizeWorksheetPayload(raw) : null
}

export function saveWorksheetCache(payload: TechnicianWorksheetPayload): void {
  const normalized = normalizeWorksheetPayload(payload)
  const routeId = Number(normalized.route.id)
  const monthIso = normalized.month_date
  localStorage.setItem(cacheKey(routeId, monthIso), JSON.stringify(normalized))
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

export function loadRunLifecycleSyncQueue(): PortalRunLifecycleQueueItem[] {
  return safeParse<PortalRunLifecycleQueueItem[]>(localStorage.getItem(RUN_LIFECYCLE_QUEUE_KEY)) ?? []
}

export function saveRunLifecycleSyncQueue(items: PortalRunLifecycleQueueItem[]): void {
  localStorage.setItem(RUN_LIFECYCLE_QUEUE_KEY, JSON.stringify(items))
}

export function enqueuePortalRunLifecycleAction(
  item: Omit<PortalRunLifecycleQueueItem, 'id' | 'attempts' | 'nextAttemptAt' | 'enqueuedAt'>,
): PortalRunLifecycleQueueItem {
  const queue = loadRunLifecycleSyncQueue()
  const filtered = queue.filter(
    (q) =>
      !(
        q.routeId === item.routeId &&
        q.monthIso === item.monthIso &&
        q.action === item.action
      ),
  )
  const qItem: PortalRunLifecycleQueueItem = {
    ...item,
    id: randomId(),
    attempts: 0,
    nextAttemptAt: Date.now(),
    enqueuedAt: Date.now(),
  }
  filtered.push(qItem)
  saveRunLifecycleSyncQueue(filtered)
  return qItem
}

export function hasPendingRunLifecycleForRouteMonth(routeId: number, monthIso: string): boolean {
  return loadRunLifecycleSyncQueue().some(
    (item) => item.routeId === routeId && item.monthIso === monthIso,
  )
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
        q.locationId === item.locationId &&
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

function workflowQueueItemTouchesStop(
  item: PortalWorkflowQueueItem,
  routeId: number,
  monthIso: string,
  locationId: number,
): boolean {
  if (item.routeId !== routeId || item.monthIso !== monthIso) return false
  if (item.action === 'transition_clock') {
    return (
      Number(item.payload.from_location_id) === locationId ||
      Number(item.payload.to_location_id) === locationId
    )
  }
  return item.locationId === locationId
}

/** Drop unsynced workflow intents for one stop (e.g. before offline reset). */
export function purgePendingWorkflowForStop(
  routeId: number,
  monthIso: string,
  locationId: number,
): PortalWorkflowQueueItem[] {
  const queue = loadWorkflowSyncQueue()
  const removed = queue.filter((item) =>
    workflowQueueItemTouchesStop(item, routeId, monthIso, locationId),
  )
  if (!removed.length) return removed
  saveWorkflowSyncQueue(
    queue.filter(
      (item) => !workflowQueueItemTouchesStop(item, routeId, monthIso, locationId),
    ),
  )
  return removed
}

/** Drop unsynced field PATCH rows for one stop so reset is not overwritten on refresh. */
export function purgePendingFieldChangesForStop(
  routeId: number,
  monthIso: string,
  locationId: number,
): void {
  saveSyncQueue(
    loadSyncQueue().filter(
      (item) =>
        !(
          item.routeId === routeId &&
          item.monthIso === monthIso &&
          item.locationId === locationId
        ),
    ),
  )
}

/** True while local edits are still queued — do not let SSE/background GET overwrite them. */
export function shouldSuppressRemoteWorksheetRefresh(
  suppressUntilMs: number,
  routeId: number,
  monthIso: string,
): boolean {
  if (Date.now() < suppressUntilMs) return true
  return hasPendingSyncForRouteMonth(routeId, monthIso)
}

export function hasPendingSyncForStop(
  routeId: number,
  monthIso: string,
  locationId: number,
): boolean {
  const fieldPending = loadSyncQueue().some(
    (item) =>
      item.routeId === routeId &&
      item.monthIso === monthIso &&
      item.locationId === locationId,
  )
  if (fieldPending) return true
  return loadWorkflowSyncQueue().some(
    (item) =>
      item.routeId === routeId &&
      item.monthIso === monthIso &&
      item.locationId === locationId,
  )
}

export function hasPendingWorkflowForRouteMonth(routeId: number, monthIso: string): boolean {
  return loadWorkflowSyncQueue().some(
    (item) => item.routeId === routeId && item.monthIso === monthIso,
  )
}

export function hasPendingSyncForRouteMonth(routeId: number, monthIso: string): boolean {
  return countPendingSyncForRouteMonth(routeId, monthIso) > 0
}

/** Total queued field, workflow, and run-lifecycle mutations for one route-month. */
export function countPendingSyncForRouteMonth(routeId: number, monthIso: string): number {
  const fieldCount = loadSyncQueue().filter(
    (item) =>
      item.routeId === routeId &&
      item.monthIso === monthIso &&
      item.locationId != null,
  ).length
  const workflowCount = loadWorkflowSyncQueue().filter(
    (item) => item.routeId === routeId && item.monthIso === monthIso,
  ).length
  const runLifecycleCount = loadRunLifecycleSyncQueue().filter(
    (item) => item.routeId === routeId && item.monthIso === monthIso,
  ).length
  return fieldCount + workflowCount + runLifecycleCount
}

/** Unsynced field edits for one stop (optionally skip queue items already applied on the server). */
export function collectPendingStopChanges(
  routeId: number,
  monthIso: string,
  locationId: number,
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
      item.locationId !== locationId
    ) {
      continue
    }
    if (exclude.has(item.id)) continue
    patch = { ...patch, ...(item.changes as WorksheetStopChangeSet) }
  }
  return patch
}

export function applyServerStopWithPending(
  serverStop: TechnicianWorksheetLocation,
  routeId: number,
  monthIso: string,
  excludeItemId: string,
  localStop?: TechnicianWorksheetLocation,
): TechnicianWorksheetLocation {
  const pending = collectPendingStopChanges(routeId, monthIso, serverStop.location_id, excludeItemId)
  const merged =
    Object.keys(pending).length > 0 ? { ...serverStop, ...pending } : serverStop
  return localStop ? preserveWorksheetStopOrderFields(localStop, merged) : merged
}

function parseWorksheetStopVersionMs(iso: string | null | undefined): number {
  if (!iso) return 0
  const parsed = Date.parse(iso)
  return Number.isFinite(parsed) ? parsed : 0
}

/** True when local stop reflects a same-or-newer server revision than a background fetch row. */
export function isWorksheetStopVersionNewerThan(
  local: TechnicianWorksheetLocation,
  remote: TechnicianWorksheetLocation,
): boolean {
  const localMs = parseWorksheetStopVersionMs(local.version_updated_at)
  const remoteMs = parseWorksheetStopVersionMs(remote.version_updated_at)
  if (localMs === 0 || remoteMs === 0) return false
  return localMs >= remoteMs
}

/** Keep route sheet stop # stable when workflow PATCH responses recalculate order. */
export function preserveWorksheetStopOrderFields(
  local: TechnicianWorksheetLocation,
  remote: TechnicianWorksheetLocation,
): TechnicianWorksheetLocation {
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
  const baseLocations = worksheetPayloadLocations(payload)
  if (!baseLocations.length) return payload
  const items =
    queue ??
    loadWorkflowSyncQueue().filter(
      (item) => item.routeId === routeId && item.monthIso === monthIso,
    )
  if (!items.length) return payload
  const stops = projectStopsWithWorkflowQueue(baseLocations, routeId, monthIso, items)
  return withWorksheetLocations(payload, stops)
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
      item.locationId != null,
  )
  let next = payload
  const baseLocations = worksheetPayloadLocations(payload)
  if (queue.length && baseLocations.length) {
    const pendingBySite = new Map<number, WorksheetStopChangeSet>()
    for (const item of queue) {
      const siteId = item.locationId
      if (siteId == null) continue
      pendingBySite.set(siteId, {
        ...pendingBySite.get(siteId),
        ...(item.changes as WorksheetStopChangeSet),
      })
    }

    const stops = baseLocations.map((stop) => {
      const patch = pendingBySite.get(stop.location_id)
      return patch ? { ...stop, ...patch } : stop
    })
    next = withWorksheetLocations(payload, stops)
  }
  return mergeRunLifecycleQueueIntoPayload(
    mergeWorkflowQueueIntoPayload(next, routeId, monthIso),
    routeId,
    monthIso,
  )
}

/** Apply pending portal run lifecycle queue onto the worksheet run header. */
export function mergeRunLifecycleQueueIntoPayload(
  payload: TechnicianWorksheetPayload,
  routeId: number,
  monthIso: string,
  queue?: PortalRunLifecycleQueueItem[],
): TechnicianWorksheetPayload {
  if (!payload.run) return payload
  const items =
    queue ??
    loadRunLifecycleSyncQueue().filter(
      (item) => item.routeId === routeId && item.monthIso === monthIso,
    )
  if (!items.length) return payload

  let run: TechnicianWorksheetRun = payload.run
  const sorted = [...items].sort((a, b) => (a.enqueuedAt ?? 0) - (b.enqueuedAt ?? 0))
  for (const item of sorted) {
    if (item.action === 'start_run' && item.clientStartedAt && !(run.started_at || '').trim()) {
      run = {
        ...run,
        started_at: item.clientStartedAt,
        opened_at: run.opened_at ?? item.clientStartedAt,
      }
    }
  }
  return run === payload.run ? payload : { ...payload, run }
}

/** Keep local intent when a background fetch is behind the workflow queue. */
export function reconcileStopWithServer(
  local: TechnicianWorksheetLocation,
  remote: TechnicianWorksheetLocation,
  routeId?: number,
  monthIso?: string,
): TechnicianWorksheetLocation {
  const pending =
    routeId != null && monthIso != null
      ? collectPendingStopChanges(routeId, monthIso, local.location_id)
      : {}
  const hasPendingFields = Object.keys(pending).length > 0

  if (portalStopHasTestOutcome(local) && !portalStopHasTestOutcome(remote)) {
    const keepLocalOutcome =
      routeId != null &&
      monthIso != null &&
      hasPendingSyncForStop(routeId, monthIso, local.location_id)
    if (keepLocalOutcome) {
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
    return preserveWorksheetStopOrderFields(local, remote)
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
  if (hasPendingFields) {
    return preserveWorksheetStopOrderFields(local, { ...remote, ...pending })
  }
  if (isWorksheetStopVersionNewerThan(local, remote)) {
    return preserveWorksheetStopOrderFields(local, local)
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
  const serverStops = worksheetPayloadLocations(server)
  const prevLocations = worksheetPayloadLocations(prev)
  const serverById = new Map(serverStops.map((s) => [s.location_id, s]))
  const prevIds = new Set(prevLocations.map((s) => s.location_id))

  const stops: TechnicianWorksheetLocation[] = []
  for (const s of prevLocations) {
    const remote = serverById.get(s.location_id)
    if (!remote) {
      stops.push(s)
      continue
    }
    const pending = collectPendingStopChanges(routeId, monthIso, s.location_id)
    const stopHasPendingSync = hasPendingSyncForStop(routeId, monthIso, s.location_id)
    let merged: TechnicianWorksheetLocation
    if (stopHasPendingSync) {
      merged = reconcileStopWithServer(s, remote, routeId, monthIso)
    } else if (isWorksheetStopVersionNewerThan(s, remote)) {
      merged = preserveWorksheetStopOrderFields(s, s)
    } else {
      merged = preserveWorksheetStopOrderFields(s, remote)
    }
    merged = Object.keys(pending).length > 0 ? { ...merged, ...pending } : merged
    stops.push(merged)
  }
  for (const s of serverStops) {
    if (!prevIds.has(s.location_id)) {
      stops.push(s)
    }
  }

  return mergeRunLifecycleQueueIntoPayload(
    mergeWorkflowQueueIntoPayload(withWorksheetLocations(server, stops), routeId, monthIso),
    routeId,
    monthIso,
  )
}

/** Stops with a logged visit outcome, open clock, or legacy tested/skipped status. */
export function countStopsWithFieldProgress(stops: TechnicianWorksheetLocation[] | undefined): number {
  return (stops ?? []).filter((stop) => stopHasFieldProgress(stop)).length
}

function stopHasFieldProgress(stop: TechnicianWorksheetLocation): boolean {
  if (portalStopHasTestOutcome(stop) || portalStopHasOpenClock(stop)) return true
  const rs = (stop.result_status || '').trim().toLowerCase()
  return rs === 'tested' || rs === 'skipped'
}

function runHeaderHadFieldProgress(run: TechnicianWorksheetRun | null | undefined): boolean {
  if (!run) return false
  return Boolean((run.started_at || '').trim() || (run.field_ended_at || '').trim())
}

function runHeaderHasFieldProgress(run: TechnicianWorksheetRun | null | undefined): boolean {
  if (!run) return false
  return Boolean((run.started_at || '').trim() || (run.field_ended_at || '').trim())
}

/**
 * True when the server worksheet looks like an office ``reset_run`` while this device still
 * holds prior field progress (cache and/or offline sync queues).
 */
export function serverRunWasExternallyReset(
  local: TechnicianWorksheetPayload | null | undefined,
  server: TechnicianWorksheetPayload,
  routeId: number,
  monthIso: string,
): boolean {
  if (!local) return false

  const localStopProgress = countStopsWithFieldProgress(worksheetPayloadLocations(local))
  const serverStopProgress = countStopsWithFieldProgress(worksheetPayloadLocations(server))
  const localHeaderProgress = runHeaderHadFieldProgress(local.run)
  const serverHeaderProgress = runHeaderHasFieldProgress(server.run)

  const pendingWorkflow = loadWorkflowSyncQueue().filter(
    (item) =>
      item.routeId === routeId &&
      item.monthIso === monthIso &&
      item.action !== 'reset_stop',
  )
  const pendingField = loadSyncQueue().filter(
    (item) =>
      item.routeId === routeId &&
      item.monthIso === monthIso &&
      item.locationId != null,
  )
  const pendingRunLifecycle = loadRunLifecycleSyncQueue().filter(
    (item) => item.routeId === routeId && item.monthIso === monthIso,
  )

  const localHadProgress =
    localStopProgress > 0 ||
    localHeaderProgress ||
    pendingWorkflow.length > 0 ||
    pendingField.length > 0 ||
    pendingRunLifecycle.length > 0

  const serverLooksFresh =
    serverStopProgress === 0 && !serverHeaderProgress && !worksheetRunExplicitlyCompleted(server.run)

  if (!localHadProgress || !serverLooksFresh) return false

  const runHeaderCleared = localHeaderProgress && !serverHeaderProgress
  if (runHeaderCleared) return true

  if (localStopProgress >= 2 && serverStopProgress === 0) return true

  if (localStopProgress > 0 && pendingWorkflow.length > 0 && serverStopProgress === 0) return true

  return false
}

/** Drop cached worksheet and all offline queues for one portal route-month (after office reset). */
export function purgePortalRouteMonthClientState(routeId: number, monthIso: string): void {
  clearWorksheetCache(routeId, monthIso)
  markCompletionPending(routeId, monthIso, false)

  saveSyncQueue(
    loadSyncQueue().filter(
      (item) => !(item.routeId === routeId && item.monthIso === monthIso),
    ),
  )
  saveWorkflowSyncQueue(
    loadWorkflowSyncQueue().filter(
      (item) => !(item.routeId === routeId && item.monthIso === monthIso),
    ),
  )
  saveRunLifecycleSyncQueue(
    loadRunLifecycleSyncQueue().filter(
      (item) => !(item.routeId === routeId && item.monthIso === monthIso),
    ),
  )
}
