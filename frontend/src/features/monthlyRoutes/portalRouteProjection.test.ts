import { describe, expect, it } from 'vitest'
import type { TechnicianWorksheetPayload, TechnicianWorksheetStop } from './monthlyRoutesShared'
import {
  projectedClockInBlockedForStop,
  projectedOpenClockSiteId,
  projectStopsWithWorkflowQueue,
} from './portalRouteProjection'
import { mergeWorkflowQueueIntoPayload } from './worksheetOfflineStore'
import type { PortalWorkflowQueueItem } from './worksheetOfflineStore'
function baseStop(
  id: number,
  overrides: Partial<TechnicianWorksheetStop> = {},
): TechnicianWorksheetStop {
  return {
    testing_site_id: id,
    location_id: id,
    stop_number: id,
    display_address: `Site ${id}`,
    month_date: '2026-05-01',
    history_month_row_id: 0,
    route_stop_order: null,
    session_route_stop_order: null,
    version_updated_at: null,
    building_name: null,
    property_management_company: null,
    label: null,
    ring: null,
    key_number: null,
    annual_month: null,
    door_code: null,
    panel: null,
    panel_location: null,
    monitoring_company: null,
    monitoring_notes: null,
    testing_procedures: null,
    inspection_tech_notes: null,
    run_comments: null,
    time_in: null,
    time_out: null,
    result_status: null,
    skip_reason: null,
    ...overrides,
  }
}

const ROUTE_ID = 7
const MONTH = '2026-05-01'

function queueItem(
  overrides: Partial<PortalWorkflowQueueItem> & Pick<PortalWorkflowQueueItem, 'action' | 'testingSiteId'>,
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
      baseStop(1, {
        clock_events: [{ id: 1, sort_order: 1, time_in: '9:00 AM', time_out: null }],
      }),
      baseStop(2),
    ]
    const queue = [
      queueItem({
        id: '1',
        action: 'clock_out',
        testingSiteId: 1,
        payload: { time_out: '9:30 AM' },
        enqueuedAt: 1,
      }),
      queueItem({
        id: '2',
        action: 'clock_in',
        testingSiteId: 2,
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
      baseStop(1, {
        clock_events: [{ id: 1, sort_order: 1, time_in: '9:00 AM', time_out: null }],
      }),
      baseStop(2),
    ]
    const queue = [
      queueItem({
        action: 'clock_in',
        testingSiteId: 2,
        payload: { time_in: '10:00 AM' },
        enqueuedAt: 1,
      }),
    ]
    const projected = projectStopsWithWorkflowQueue(stops, ROUTE_ID, MONTH, queue)
    expect(projectedOpenClockSiteId(projected, ROUTE_ID, MONTH, queue)).toBe(2)
  })

  it('cancel_clock_in removes open clock from projected stop', () => {
    const stops = [
      baseStop(1, {
        clock_events: [
          { id: 1, sort_order: 1, time_in: '8:00 AM', time_out: '8:30 AM' },
          { id: 2, sort_order: 2, time_in: '9:00 AM', time_out: null },
        ],
      }),
    ]
    const queue = [
      queueItem({
        action: 'cancel_clock_in',
        testingSiteId: 1,
        payload: {},
        enqueuedAt: 1,
      }),
    ]
    const projected = projectStopsWithWorkflowQueue(stops, ROUTE_ID, MONTH, queue)
    expect(projectedOpenClockSiteId(projected, ROUTE_ID, MONTH, queue)).toBeNull()
  })
})

describe('mergeWorkflowQueueIntoPayload', () => {
  it('server A open + queue clock_out A and clock_in B yields B open only', () => {
    const stops = [
      baseStop(1, {
        clock_events: [{ id: 1, sort_order: 1, time_in: '9:00 AM', time_out: null }],
      }),
      baseStop(2),
    ]
    const queue = [
      queueItem({
        id: '1',
        action: 'clock_out',
        testingSiteId: 1,
        payload: { time_out: '9:30 AM' },
        enqueuedAt: 1,
      }),
      queueItem({
        id: '2',
        action: 'clock_in',
        testingSiteId: 2,
        payload: { time_in: '9:35 AM' },
        enqueuedAt: 2,
      }),
    ]
    const payload = {
      route: { id: ROUTE_ID, route_number: 1, weekday_iso: 0, week_occurrence: 1, label: 'R1' },
      month_date: MONTH,
      stops,
      run: null,
    } as TechnicianWorksheetPayload
    const merged = mergeWorkflowQueueIntoPayload(payload, ROUTE_ID, MONTH, queue)
    expect(projectedOpenClockSiteId(merged.stops ?? [], ROUTE_ID, MONTH, queue)).toBe(2)
  })
})
