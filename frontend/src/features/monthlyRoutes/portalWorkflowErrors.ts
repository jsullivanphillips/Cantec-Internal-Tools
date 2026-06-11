/** Classify portal workflow API errors for sync queue / immediate actions. */

import { isTransientClockInConflict } from './portalRouteProjection'
import { portalStopHasOpenClock, PORTAL_OUTCOME_VALIDATION_MESSAGES } from './portalWorkflowShared'
import type { TechnicianWorksheetLocation } from './monthlyRoutesShared'
import {
  loadWorkflowSyncQueue,
  type PortalWorkflowAction,
  type PortalWorkflowQueueItem,
} from './worksheetOfflineStore'

export type WorkflowErrorDisposition = 'idempotent_ok' | 'alert_drop' | 'retry'

const ALERT_DROP_CODES = new Set([
  'open_clock_in_conflict',
  'portal_read_only',
  'run_completed_locked',
  'visit_has_outcome',
  'deficiencies_block_all_good',
  'unverified_deficiencies',
  'confirmed_no_deficiencies_required',
  'invalid_billing_status',
  'billing_legacy_locked',
])

const MAX_TRANSIENT_CONFLICT_ATTEMPTS = 5
const MAX_CANCEL_NO_OPEN_CLOCK_ATTEMPTS = 4

export function workflowErrorMessage(code: string | undefined, fallback?: string): string {
  if (code && PORTAL_OUTCOME_VALIDATION_MESSAGES[code]) {
    return PORTAL_OUTCOME_VALIDATION_MESSAGES[code]
  }
  return fallback || 'Could not complete this action.'
}

export type ClassifyWorkflowErrorOpts = {
  item?: PortalWorkflowQueueItem
  stops?: TechnicianWorksheetLocation[]
  routeId?: number
  monthIso?: string
  queue?: PortalWorkflowQueueItem[]
}

/** Whether a failed workflow call should be retried from the offline queue. */
export function classifyWorkflowError(
  err: unknown,
  action: PortalWorkflowAction,
  opts?: ClassifyWorkflowErrorOpts,
): WorkflowErrorDisposition {
  const code =
    typeof err === 'object' && err != null && 'code' in err
      ? String((err as { code?: string }).code || '')
      : ''

  if (code === 'no_open_clock' && (action === 'clock_out' || action === 'cancel_clock_in')) {
    const siteId = opts?.item?.locationId
    const stop = opts?.stops?.find((s) => s.location_id === siteId)
    const attempts = opts?.item?.attempts ?? 0
    if (action === 'cancel_clock_in' && attempts < MAX_CANCEL_NO_OPEN_CLOCK_ATTEMPTS) {
      return 'retry'
    }
    if (stop && portalStopHasOpenClock(stop)) {
      return 'retry'
    }
    return 'idempotent_ok'
  }

  if (code === 'open_clock_in_conflict' && action === 'clock_in' && opts?.item) {
    const attempts = opts.item.attempts ?? 0
    if (attempts >= MAX_TRANSIENT_CONFLICT_ATTEMPTS) {
      return 'alert_drop'
    }
    if (
      opts.stops &&
      opts.routeId != null &&
      opts.monthIso &&
      isTransientClockInConflict(
        opts.item,
        opts.routeId,
        opts.monthIso,
        opts.stops,
        opts.queue ??
          loadWorkflowSyncQueue().filter(
            (q) => q.routeId === opts.routeId && q.monthIso === opts.monthIso,
          ),
      )
    ) {
      return 'retry'
    }
    return 'alert_drop'
  }

  if (code && ALERT_DROP_CODES.has(code)) {
    return 'alert_drop'
  }

  if (code) {
    return 'alert_drop'
  }

  return 'retry'
}
