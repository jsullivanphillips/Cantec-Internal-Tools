import { describe, expect, it } from 'vitest'
import type { TechnicianWorksheetStop } from './monthlyRoutesShared'
import { reconcileStopWithServer } from './worksheetOfflineStore'

function stop(id: number, patch: Partial<TechnicianWorksheetStop> = {}): TechnicianWorksheetStop {
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
    ...patch,
  }
}

describe('reconcileStopWithServer', () => {
  it('keeps local test outcome when server fetch lags', () => {
    const local = stop(1, {
      test_outcome: 'all_good',
      result_status: 'tested',
      clock_events: [{ id: 1, sort_order: 1, time_in: '9:00 AM', time_out: '9:30 AM' }],
      time_out: '9:30 AM',
    })
    const remote = stop(1, {
      clock_events: [{ id: 1, sort_order: 1, time_in: '9:00 AM', time_out: null }],
      time_in: '9:00 AM',
    })
    const merged = reconcileStopWithServer(local, remote)
    expect(merged.test_outcome).toBe('all_good')
    expect(merged.clock_events?.[0]?.time_out).toBe('9:30 AM')
  })
})
