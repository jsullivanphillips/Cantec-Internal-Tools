import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TechnicianWorksheetPayload, TechnicianWorksheetStop } from './monthlyRoutesShared'
import {
  mergeRunLifecycleQueueIntoPayload,
  preserveWorksheetStopOrderFields,
  reconcileStopWithServer,
  serverRunWasExternallyReset,
  type PortalRunLifecycleQueueItem,
} from './worksheetOfflineStore'

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

  it('preserves local stop_number when server response recalculates order', () => {
    const local = stop(28, { stop_number: 2, session_route_stop_order: 2 })
    const remote = stop(28, {
      stop_number: 28,
      session_route_stop_order: 28,
      test_outcome: 'all_good',
      result_status: 'tested',
    })
    const merged = reconcileStopWithServer(local, remote)
    expect(merged.stop_number).toBe(2)
    expect(merged.session_route_stop_order).toBe(2)
    expect(merged.test_outcome).toBe('all_good')
  })
})

function worksheetPayload(runStartedAt: string | null): TechnicianWorksheetPayload {
  return {
    route: {
      id: 1,
      route_number: 18,
      label: 'R18',
      display_name: null,
      weekday_iso: 1,
      week_occurrence: 1,
    },
    month_date: '2026-05-01',
    rows: [],
    run: {
      id: 10,
      monthly_route_id: 1,
      month_date: '2026-05-01',
      status: 'open',
      opened_at: '2026-05-01T00:00:00Z',
      started_at: runStartedAt,
      prepared_at: '2026-05-01T00:00:00Z',
      field_ended_at: null,
      completed_at: null,
      source: 'office_manual',
      is_historical: false,
    },
    stops: [],
  }
}

describe('mergeRunLifecycleQueueIntoPayload', () => {
  it('applies pending start_run onto an unprepared server run header', () => {
    const payload = worksheetPayload(null)
    const queue: PortalRunLifecycleQueueItem[] = [
      {
        id: 'q1',
        action: 'start_run',
        routeId: 1,
        monthIso: '2026-05-01',
        clientStartedAt: '2026-05-02T09:00:00Z',
        attempts: 0,
        nextAttemptAt: 0,
        enqueuedAt: 1,
      },
    ]
    const merged = mergeRunLifecycleQueueIntoPayload(payload, 1, '2026-05-01', queue)
    expect(merged.run?.started_at).toBe('2026-05-02T09:00:00Z')
  })
})

describe('preserveWorksheetStopOrderFields', () => {
  it('keeps local stop_number on workflow merge', () => {
    const local = stop(28, { stop_number: 2 })
    const remote = stop(28, { stop_number: 28, time_in: '9:00 AM' })
    const merged = preserveWorksheetStopOrderFields(local, remote)
    expect(merged.stop_number).toBe(2)
    expect(merged.time_in).toBe('9:00 AM')
  })
})

describe('serverRunWasExternallyReset', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
      removeItem: (key: string) => {
        store.delete(key)
      },
    })
  })

  it('detects office reset when run header and stop outcomes were cleared', () => {
    const local = {
      ...worksheetPayload('2026-05-02T09:00:00Z'),
      stops: [
        stop(1, { test_outcome: 'skipped', result_status: 'skipped' }),
        stop(2, { test_outcome: 'skipped', result_status: 'skipped' }),
      ],
    }
    const server = {
      ...worksheetPayload(null),
      stops: [stop(1), stop(2)],
    }
    expect(serverRunWasExternallyReset(local, server, 1, '2026-05-01')).toBe(true)
  })

  it('does not treat a single unsynced skip as an office reset', () => {
    const local = {
      ...worksheetPayload(null),
      stops: [stop(1, { test_outcome: 'skipped', result_status: 'skipped' })],
    }
    const server = {
      ...worksheetPayload(null),
      stops: [stop(1)],
    }
    expect(serverRunWasExternallyReset(local, server, 1, '2026-05-01')).toBe(false)
  })
})
