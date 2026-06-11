import { describe, expect, it } from 'vitest'
import type { TechnicianWorksheetPayload, TechnicianWorksheetLocation } from './monthlyRoutesShared'
import {
  projectedClockInBlockedForStop,
  projectedOpenClockSiteId,
  projectStopsWithWorkflowQueue,
} from './portalRouteProjection'
import { portalStopHasOpenClock, portalStopHasTestOutcome } from './portalWorkflowShared'
import { mergeWorkflowQueueIntoPayload } from './worksheetOfflineStore'
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

const ROUTE_ID = 7
const MONTH = '2026-05-01'

function queueItem(
  overrides: Partial<PortalWorkflowQueueItem> & Pick<PortalWorkflowQueueItem, 'action' | 'locationId'>,
): PortalWorkflowQueueItem {
  return {
    id: overrides.id ?? 'q1',
    routeId: ROUTE_ID,
    monthIso: MONTH,
    payload: overrides.payload ?? {},
    attempts: 0,
    nextAttemptAt: 0,
    enqueuedAt: overrides.enqueuedAt ?? 1,
    ...overrides,
  }
}

describe('projectStopsWithWorkflowQueue', () => {
  it('clock_out A then clock_in B leaves open clock on B only', () => {
    const stops = [
      baseStop({ location_id: 1,
        clock_events: [{ id: 1, sort_order: 1, time_in: '9:00 AM', time_out: null }],
      }),
      baseStop({ location_id: 2 }),
    ]
    const queue = [
      queueItem({
        id: '1',
        action: 'clock_out',
        locationId: 1,
        payload: { time_out: '9:30 AM' },
        enqueuedAt: 1,
      }),
      queueItem({
        id: '2',
        action: 'clock_in',
        locationId: 2,
        payload: { time_in: '9:35 AM' },
        enqueuedAt: 2,
      }),
    ]
    const projected = projectStopsWithWorkflowQueue(stops, ROUTE_ID, MONTH, queue)
    expect(projectedOpenClockSiteId(projected, ROUTE_ID, MONTH, queue)).toBe(2)
    expect(projectedClockInBlockedForStop(projected[1], stops, ROUTE_ID, MONTH, queue)).toBe(
      false,
    )
  })

  it('clock_in B while A still open on server snapshot projects B open', () => {
    const stops = [
      baseStop({ location_id: 1,
        clock_events: [{ id: 1, sort_order: 1, time_in: '9:00 AM', time_out: null }],
      }),
      baseStop({ location_id: 2 }),
    ]
    const queue = [
      queueItem({
        action: 'clock_in',
        locationId: 2,
        payload: { time_in: '10:00 AM' },
        enqueuedAt: 1,
      }),
    ]
    const projected = projectStopsWithWorkflowQueue(stops, ROUTE_ID, MONTH, queue)
    expect(projectedOpenClockSiteId(projected, ROUTE_ID, MONTH, queue)).toBe(2)
  })

  it('create_deficiency adds optimistic row while queued', () => {
    const stops = [baseStop({ location_id: 1 })]
    const queue = [
      queueItem({
        action: 'create_deficiency',
        locationId: 1,
        payload: {
          title: 'Bell',
          severity: 'deficient',
          status: 'new',
          run_id: 42,
        },
        enqueuedAt: 1,
      }),
    ]
    const projected = projectStopsWithWorkflowQueue(stops, ROUTE_ID, MONTH, queue)
    expect(projected[0].deficiencies).toHaveLength(1)
    expect(projected[0].deficiencies?.[0]?.title).toBe('Bell')
  })

  it('cancel_clock_in removes open clock from projected stop', () => {
    const stops = [
      baseStop({ location_id: 1,
        clock_events: [
          { id: 1, sort_order: 1, time_in: '8:00 AM', time_out: '8:30 AM' },
          { id: 2, sort_order: 2, time_in: '9:00 AM', time_out: null },
        ],
      }),
    ]
    const queue = [
      queueItem({
        action: 'cancel_clock_in',
        locationId: 1,
        payload: {},
        enqueuedAt: 1,
      }),
    ]
    const projected = projectStopsWithWorkflowQueue(stops, ROUTE_ID, MONTH, queue)
    expect(projectedOpenClockSiteId(projected, ROUTE_ID, MONTH, queue)).toBeNull()
  })

  it('queued clock_in then cancel_clock_in leaves stop without open clock', () => {
    const stops = [baseStop({ location_id: 1 })]
    const queue = [
      queueItem({
        id: 'cin',
        action: 'clock_in',
        locationId: 1,
        payload: { time_in: '9:00 AM' },
        enqueuedAt: 1,
      }),
      queueItem({
        id: 'cancel',
        action: 'cancel_clock_in',
        locationId: 1,
        payload: {},
        enqueuedAt: 2,
      }),
    ]
    const projected = projectStopsWithWorkflowQueue(stops, ROUTE_ID, MONTH, queue)
    expect(portalStopHasOpenClock(projected[0])).toBe(false)
    expect(projectedOpenClockSiteId(projected, ROUTE_ID, MONTH, queue)).toBeNull()
  })

  it('queued clock_in then reset_stop clears projected open clock', () => {
    const stops = [baseStop({ location_id: 1 })]
    const queue = [
      queueItem({
        id: 'cin',
        action: 'clock_in',
        locationId: 1,
        payload: { time_in: '9:00 AM' },
        enqueuedAt: 1,
      }),
      queueItem({
        id: 'reset',
        action: 'reset_stop',
        locationId: 1,
        payload: {},
        enqueuedAt: 2,
      }),
    ]
    const projected = projectStopsWithWorkflowQueue(stops, ROUTE_ID, MONTH, queue)
    expect(portalStopHasOpenClock(projected[0])).toBe(false)
    expect(projected[0].has_run_changes).toBe(false)
  })

  it('reset_stop alone clears a stop after prior queued visit actions were purged', () => {
    const stops = [
      baseStop({ location_id: 1,
        test_outcome: 'all_good',
        result_status: 'tested',
        has_run_changes: true,
        clock_events: [{ id: 1, sort_order: 1, time_in: '9:00 AM', time_out: '9:30 AM' }],
        time_in: '9:00 AM',
        time_out: '9:30 AM',
      }),
    ]
    const queue = [
      queueItem({
        id: 'reset',
        action: 'reset_stop',
        locationId: 1,
        payload: {},
        enqueuedAt: 4,
      }),
    ]
    const projected = projectStopsWithWorkflowQueue(stops, ROUTE_ID, MONTH, queue)
    expect(portalStopHasTestOutcome(projected[0])).toBe(false)
    expect(projected[0].has_run_changes).toBe(false)
    expect(projected[0].clock_events).toEqual([])
  })

  it('without purge, stale queued visit actions override a local reset patch', () => {
    const stops = [
      baseStop({ location_id: 1,
        test_outcome: null,
        result_status: null,
        has_run_changes: false,
        clock_events: [],
      }),
    ]
    const queue = [
      queueItem({
        id: 'cin',
        action: 'clock_in',
        locationId: 1,
        payload: { time_in: '9:00 AM' },
        enqueuedAt: 1,
      }),
      queueItem({
        id: 'outcome',
        action: 'test_outcome',
        locationId: 1,
        payload: { test_outcome: 'all_good' },
        enqueuedAt: 2,
      }),
      queueItem({
        id: 'cout',
        action: 'clock_out',
        locationId: 1,
        payload: { time_out: '9:30 AM' },
        enqueuedAt: 3,
      }),
    ]
    const projected = projectStopsWithWorkflowQueue(stops, ROUTE_ID, MONTH, queue)
    expect(portalStopHasTestOutcome(projected[0])).toBe(true)
  })
})

describe('mergeWorkflowQueueIntoPayload', () => {
  it('server A open + queue clock_out A and clock_in B yields B open only', () => {
    const stops = [
      baseStop({ location_id: 1,
        clock_events: [{ id: 1, sort_order: 1, time_in: '9:00 AM', time_out: null }],
      }),
      baseStop({ location_id: 2 }),
    ]
    const queue = [
      queueItem({
        id: '1',
        action: 'clock_out',
        locationId: 1,
        payload: { time_out: '9:30 AM' },
        enqueuedAt: 1,
      }),
      queueItem({
        id: '2',
        action: 'clock_in',
        locationId: 2,
        payload: { time_in: '9:35 AM' },
        enqueuedAt: 2,
      }),
    ]
    const payload = {
      route: { id: ROUTE_ID, route_number: 1, weekday_iso: 0, week_occurrence: 1, label: 'R1' },
      month_date: MONTH,
      locations: stops,
      run: null,
    } as TechnicianWorksheetPayload
    const merged = mergeWorkflowQueueIntoPayload(payload, ROUTE_ID, MONTH, queue)
    expect(projectedOpenClockSiteId(merged.stops ?? merged.locations ?? [], ROUTE_ID, MONTH, queue)).toBe(2)
  })
})
