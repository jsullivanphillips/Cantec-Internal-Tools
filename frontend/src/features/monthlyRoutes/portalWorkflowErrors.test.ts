import { describe, expect, it } from 'vitest'
import type { TechnicianWorksheetStop } from './monthlyRoutesShared'
import { classifyWorkflowError } from './portalWorkflowErrors'
import type { PortalWorkflowQueueItem } from './worksheetOfflineStore'

function baseStop(id: number): TechnicianWorksheetStop {
  return {
    testing_site_id: id,
    location_id: id,
    stop_number: id,
    display_address: 'Test',
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
    clock_events: [{ id: 1, sort_order: 1, time_in: '9:00 AM', time_out: null }],
  }
}

describe('classifyWorkflowError', () => {
  it('retries open_clock_in_conflict when prior clock_out is queued', () => {
    const stops = [baseStop(1), baseStop(2)]
    const item: PortalWorkflowQueueItem = {
      id: '1',
      action: 'clock_in',
      routeId: 7,
      monthIso: '2026-05-01',
      testingSiteId: 2,
      payload: { time_in: '10:00 AM' },
      attempts: 0,
      nextAttemptAt: 0,
      enqueuedAt: 2,
    }
    const queue: PortalWorkflowQueueItem[] = [
      {
        ...item,
        id: '0',
        action: 'clock_out',
        testingSiteId: 1,
        payload: { time_out: '9:30 AM' },
        enqueuedAt: 1,
      },
      item,
    ]
    const disposition = classifyWorkflowError(
      { code: 'open_clock_in_conflict' },
      'clock_in',
      { item, stops, routeId: 7, monthIso: '2026-05-01', queue },
    )
    expect(disposition).toBe('retry')
    expect(queue.length).toBe(2)
  })

  it('retries no_open_clock on clock_out when client still shows open clock', () => {
    const stop = baseStop(1)
    const disposition = classifyWorkflowError(
      { code: 'no_open_clock' },
      'clock_out',
      {
        item: {
          id: '1',
          action: 'clock_out',
          routeId: 7,
          monthIso: '2026-05-01',
          testingSiteId: 1,
          payload: {},
          attempts: 0,
          nextAttemptAt: 0,
          enqueuedAt: 1,
        },
        stops: [stop],
      },
    )
    expect(disposition).toBe('retry')
  })
})
