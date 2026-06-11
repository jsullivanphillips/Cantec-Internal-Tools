import { describe, expect, it } from 'vitest'
import type { TechnicianWorksheetLocation } from './monthlyRoutesShared'
import {
  cancelClockInRevertPatch,
  isPendingClockInQueueHead,
  pendingClockInForStop,
  routeWorkflowQueueItems,
  shouldChainCancelAfterClockIn,
} from './portalCancelClockIn'
import { portalStopHasOpenClock } from './portalWorkflowShared'
import type { PortalWorkflowQueueItem } from './worksheetOfflineStore'

function baseStop(overrides: Partial<TechnicianWorksheetLocation> = {}): TechnicianWorksheetLocation {
  return {
    location_id: 1,
    location_month_row_id: 0,
    month_date: '2026-05-01',
    display_address: '123 Main St',
    label: null,
    property_management_company: null,
    panel: null,
    panel_location: null,
    door_code: null,
    ring: null,
    key_number: null,
    annual_month: null,
    monitoring_company: null,
    monitoring_notes: null,
    result_status: null,
    skip_reason: null,
    testing_procedures: null,
    inspection_tech_notes: null,
    run_comments: null,
    time_in: null,
    time_out: null,
    route_stop_order: null,
    session_route_stop_order: null,
    stop_number: 1,
    version_updated_at: null,
    ...overrides,
  }
}

function queueItem(
  overrides: Partial<PortalWorkflowQueueItem> & Pick<PortalWorkflowQueueItem, 'action' | 'locationId'>,
): PortalWorkflowQueueItem {
  return {
    id: overrides.id ?? 'q1',
    routeId: 7,
    monthIso: '2026-05-01',
    payload: overrides.payload ?? {},
    attempts: 0,
    nextAttemptAt: 0,
    enqueuedAt: overrides.enqueuedAt ?? 1,
    ...overrides,
  }
}

describe('portalCancelClockIn', () => {
  it('finds pending clock_in for a stop', () => {
    const queue = [
      queueItem({ id: 'cin', action: 'clock_in', locationId: 2, payload: { time_in: '9:00 AM' } }),
      queueItem({ id: 'cancel', action: 'cancel_clock_in', locationId: 2, enqueuedAt: 2 }),
    ]
    expect(pendingClockInForStop(queue, 2)?.id).toBe('cin')
    expect(pendingClockInForStop(queue, 3)).toBeUndefined()
  })

  it('revert patch clears optimistic open clock from pending clock_in', () => {
    const stop = baseStop({ location_id: 1 })
    const pending = queueItem({
      action: 'clock_in',
      locationId: 1,
      payload: { time_in: '9:15 AM' },
    })
    const withClock = { ...stop, ...cancelClockInRevertPatch(stop, pending) }
    expect(portalStopHasOpenClock(withClock)).toBe(false)
  })

  it('chains cancel when pending clock_in is queue head', () => {
    const queue = [
      queueItem({ id: 'cin', action: 'clock_in', locationId: 1, enqueuedAt: 1 }),
      queueItem({ id: 'other', action: 'clock_out', locationId: 2, enqueuedAt: 2 }),
    ]
    const pending = pendingClockInForStop(queue, 1)!
    expect(shouldChainCancelAfterClockIn(queue, pending)).toBe(true)
  })

  it('isPendingClockInQueueHead matches queue head', () => {
    const queue = [
      queueItem({ id: 'cin', action: 'clock_in', locationId: 1, enqueuedAt: 1 }),
    ]
    const pending = pendingClockInForStop(queue, 1)!
    expect(isPendingClockInQueueHead(queue, pending)).toBe(true)
  })

  it('supersedes pending clock_in blocked behind other queue items', () => {
    const queue = routeWorkflowQueueItems(7, '2026-05-01', [
      queueItem({ id: 'out', action: 'clock_out', locationId: 2, enqueuedAt: 1 }),
      queueItem({
        id: 'cin',
        action: 'clock_in',
        locationId: 1,
        payload: { time_in: '9:00 AM' },
        enqueuedAt: 2,
      }),
    ])
    const pending = pendingClockInForStop(queue, 1)!
    expect(isPendingClockInQueueHead(queue, pending)).toBe(false)
  })
})
