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
