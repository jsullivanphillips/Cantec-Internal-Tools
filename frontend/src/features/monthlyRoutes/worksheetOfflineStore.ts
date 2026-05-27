import type {
  TechnicianWorksheetPayload,
  TechnicianWorksheetRow,
  TechnicianWorksheetStop,
} from './monthlyRoutesShared'

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
    | 'monitoring_notes'
    | 'result_status'
    | 'skip_reason'
    | 'testing_procedures'
    | 'inspection_tech_notes'
    | 'run_comments'
    | 'time_in'
    | 'time_out'
  >
>

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
const COMPLETION_KEY_PREFIX = 'monthlyWorksheetCompletion::'

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

export function hasPendingSyncForRouteMonth(routeId: number, monthIso: string): boolean {
  return loadSyncQueue().some(
    (item) =>
      item.routeId === routeId &&
      item.monthIso === monthIso &&
      item.testingSiteId != null,
  )
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
): TechnicianWorksheetStop {
  const pending = collectPendingStopChanges(routeId, monthIso, serverStop.testing_site_id, excludeItemId)
  return Object.keys(pending).length > 0 ? { ...serverStop, ...pending } : serverStop
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
  if (!queue.length || !payload.stops?.length) return payload

  const pendingBySite = new Map<number, WorksheetStopChangeSet>()
  for (const item of queue) {
    const siteId = item.testingSiteId
    if (siteId == null) continue
    pendingBySite.set(siteId, { ...pendingBySite.get(siteId), ...(item.changes as WorksheetStopChangeSet) })
  }

  const stops = payload.stops.map((stop) => {
    const patch = pendingBySite.get(stop.testing_site_id)
    return patch ? { ...stop, ...patch } : stop
  })
  return { ...payload, stops }
}

/** Merge a background worksheet fetch into existing UI state without replacing the stop list order. */
export function mergeServerWorksheetPayload(
  prev: TechnicianWorksheetPayload,
  server: TechnicianWorksheetPayload,
  routeId: number,
  monthIso: string,
): TechnicianWorksheetPayload {
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
    stops.push(Object.keys(pending).length > 0 ? { ...remote, ...pending } : remote)
  }
  for (const s of serverStops) {
    if (!prevIds.has(s.testing_site_id)) {
      stops.push(s)
    }
  }

  return { ...server, stops }
}
