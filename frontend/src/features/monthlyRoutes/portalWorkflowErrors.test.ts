import { describe, expect, it } from 'vitest'
import type { TechnicianWorksheetLocation } from './monthlyRoutesShared'
import { classifyWorkflowError } from './portalWorkflowErrors'
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

describe('classifyWorkflowError', () => {
  it('retries open_clock_in_conflict when prior clock_out is queued', () => {
    const stops = [baseStop({ location_id: 1 }), baseStop({ location_id: 2 })]
    const item: PortalWorkflowQueueItem = {
      id: '1',
      action: 'clock_in',
      routeId: 7,
      monthIso: '2026-05-01',
      locationId: 2,
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
        locationId: 1,
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
    const stop = baseStop({
      location_id: 1,
      clock_events: [{ id: 1, sort_order: 1, time_in: '9:00 AM', time_out: null }],
    })
    const disposition = classifyWorkflowError(
      { code: 'no_open_clock' },
      'clock_out',
      {
        item: {
          id: '1',
          action: 'clock_out',
          routeId: 7,
          monthIso: '2026-05-01',
          locationId: 1,
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

  it('retries cancel_clock_in on no_open_clock before giving up', () => {
    const stop = { ...baseStop({ location_id: 1 }), clock_events: [] }
    const disposition = classifyWorkflowError(
      { code: 'no_open_clock' },
      'cancel_clock_in',
      {
        item: {
          id: '1',
          action: 'cancel_clock_in',
          routeId: 7,
          monthIso: '2026-05-01',
          locationId: 1,
          payload: {},
          attempts: 1,
          nextAttemptAt: 0,
          enqueuedAt: 2,
        },
        stops: [stop],
      },
    )
    expect(disposition).toBe('retry')
  })
})
