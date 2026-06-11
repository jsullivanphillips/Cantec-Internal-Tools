import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TechnicianWorksheetPayload, TechnicianWorksheetLocation } from './monthlyRoutesShared'
import {
  mergeRunLifecycleQueueIntoPayload,
  preserveWorksheetStopOrderFields,
  reconcileStopWithServer,
  serverRunWasExternallyReset,
  countPendingSyncForRouteMonth,
  purgePendingWorkflowForStop,
  saveWorkflowSyncQueue,
  type PortalRunLifecycleQueueItem,
} from './worksheetOfflineStore'

function stop(overrides: Partial<TechnicianWorksheetLocation> = {}): TechnicianWorksheetLocation {
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

describe('reconcileStopWithServer', () => {
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

  it('keeps local test outcome when this device still has pending sync for the stop', () => {
    saveWorkflowSyncQueue([
      {
        id: 'q1',
        routeId: 1,
        monthIso: '2026-05-01',
        locationId: 1,
        action: 'test_outcome',
        payload: { test_outcome: 'all_good' },
        attempts: 0,
        nextAttemptAt: 0,
        enqueuedAt: 1,
      },
    ])
    const local = stop({ location_id: 1,
      test_outcome: 'all_good',
      result_status: 'tested',
      clock_events: [{ id: 1, sort_order: 1, time_in: '9:00 AM', time_out: '9:30 AM' }],
      time_out: '9:30 AM',
    })
    const remote = stop({ location_id: 1,
      clock_events: [{ id: 1, sort_order: 1, time_in: '9:00 AM', time_out: null }],
      time_in: '9:00 AM',
    })
    const merged = reconcileStopWithServer(local, remote, 1, '2026-05-01')
    expect(merged.test_outcome).toBe('all_good')
    expect(merged.clock_events?.[0]?.time_out).toBe('9:30 AM')
  })

  it('accepts server reset when another device cleared the stop and this device has no pending sync', () => {
    const local = stop({ location_id: 1,
      test_outcome: 'all_good',
      result_status: 'tested',
      clock_events: [{ id: 1, sort_order: 1, time_in: '9:00 AM', time_out: '9:30 AM' }],
      time_out: '9:30 AM',
    })
    const remote = stop({ location_id: 1,
      test_outcome: null,
      result_status: null,
      clock_events: [],
      time_in: null,
      time_out: null,
    })
    const merged = reconcileStopWithServer(local, remote, 1, '2026-05-01')
    expect(merged.test_outcome).toBeNull()
    expect(merged.clock_events).toEqual([])
  })

  it('preserves local stop_number when server response recalculates order', () => {
    const local = stop({ location_id: 28, stop_number: 2, session_route_stop_order: 2 })
    const remote = stop({ location_id: 28,
      stop_number: 28,
      session_route_stop_order: 28,
      test_outcome: 'all_good',
      result_status: 'tested',
    })
    const merged = reconcileStopWithServer(local, remote, 1, '2026-05-01')
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
    const local = stop({ location_id: 28, stop_number: 2 })
    const remote = stop({ location_id: 28, stop_number: 28, time_in: '9:00 AM' })
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
        stop({ location_id: 1, test_outcome: 'skipped', result_status: 'skipped' }),
        stop({ location_id: 2, test_outcome: 'skipped', result_status: 'skipped' }),
      ],
    }
    const server = {
      ...worksheetPayload(null),
      stops: [stop({ location_id: 1 }), stop({ location_id: 2 })],
    }
    expect(serverRunWasExternallyReset(local, server, 1, '2026-05-01')).toBe(true)
  })

  it('does not treat a single unsynced skip as an office reset', () => {
    const local = {
      ...worksheetPayload(null),
      stops: [stop({ location_id: 1, test_outcome: 'skipped', result_status: 'skipped' })],
    }
    const server = {
      ...worksheetPayload(null),
      stops: [stop({ location_id: 1 })],
    }
    expect(serverRunWasExternallyReset(local, server, 1, '2026-05-01')).toBe(false)
  })
})

describe('countPendingSyncForRouteMonth', () => {
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

  it('sums field, workflow, and run lifecycle queue items for one route-month', () => {
    saveWorkflowSyncQueue([
      {
        id: 'w1',
        action: 'test_outcome',
        routeId: 1,
        monthIso: '2026-05-01',
        locationId: 10,
        payload: {},
        attempts: 0,
        nextAttemptAt: 0,
        enqueuedAt: 1,
      },
    ])
    expect(countPendingSyncForRouteMonth(1, '2026-05-01')).toBe(1)
    expect(countPendingSyncForRouteMonth(2, '2026-05-01')).toBe(0)
  })
})

describe('purgePendingWorkflowForStop', () => {
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

  it('removes pending visit actions for one stop but keeps other stops', () => {
    saveWorkflowSyncQueue([
      {
        id: 'a-cin',
        routeId: 1,
        monthIso: '2026-05-01',
        locationId: 10,
        action: 'clock_in',
        payload: {},
        attempts: 0,
        nextAttemptAt: 0,
        enqueuedAt: 1,
      },
      {
        id: 'a-out',
        routeId: 1,
        monthIso: '2026-05-01',
        locationId: 10,
        action: 'test_outcome',
        payload: { test_outcome: 'all_good' },
        attempts: 0,
        nextAttemptAt: 0,
        enqueuedAt: 2,
      },
      {
        id: 'b-cin',
        routeId: 1,
        monthIso: '2026-05-01',
        locationId: 20,
        action: 'clock_in',
        payload: {},
        attempts: 0,
        nextAttemptAt: 0,
        enqueuedAt: 3,
      },
    ])
    const removed = purgePendingWorkflowForStop(1, '2026-05-01', 10)
    expect(removed.map((item) => item.id)).toEqual(['a-cin', 'a-out'])
    expect(countPendingSyncForRouteMonth(1, '2026-05-01')).toBe(1)
  })

  it('removes transition_clock rows touching the stop', () => {
    saveWorkflowSyncQueue([
      {
        id: 'tx',
        routeId: 1,
        monthIso: '2026-05-01',
        locationId: 20,
        action: 'transition_clock',
        payload: { from_location_id: 10, to_location_id: 20 },
        attempts: 0,
        nextAttemptAt: 0,
        enqueuedAt: 1,
      },
    ])
    purgePendingWorkflowForStop(1, '2026-05-01', 10)
    expect(countPendingSyncForRouteMonth(1, '2026-05-01')).toBe(0)
  })
})
