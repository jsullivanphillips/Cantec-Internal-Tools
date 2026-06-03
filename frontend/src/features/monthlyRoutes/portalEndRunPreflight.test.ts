import { describe, expect, it } from 'vitest'
import type { TechnicianWorksheetStop } from './monthlyRoutesShared'
import {
  evaluatePortalEndRunPreflight,
  projectedOpenClockStops,
  stopsMissingTestOutcome,
} from './portalEndRunPreflight'
import type { PortalWorkflowQueueItem } from './worksheetOfflineStore'

function baseStop(overrides: Partial<TechnicianWorksheetStop> = {}): TechnicianWorksheetStop {
  return {
    testing_site_id: 1,
    location_id: 1,
    stop_number: 1,
    display_address: '100 Main St',
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

describe('stopsMissingTestOutcome', () => {
  it('includes stops without test_outcome', () => {
    const stops = [baseStop({ testing_site_id: 1 }), baseStop({ testing_site_id: 2, test_outcome: 'all_good' })]
    expect(stopsMissingTestOutcome(stops, MONTH)).toHaveLength(1)
    expect(stopsMissingTestOutcome(stops, MONTH)[0].testing_site_id).toBe(1)
  })

  it('excludes annual-month stops for the run month', () => {
    const stops = [baseStop({ testing_site_id: 1, annual_month: 'May' })]
    expect(stopsMissingTestOutcome(stops, MONTH)).toHaveLength(0)
  })
})

describe('projectedOpenClockStops', () => {
  it('detects open clock on server snapshot', () => {
    const stops = [baseStop({ time_in: '9:00 AM', time_out: null })]
    expect(projectedOpenClockStops(stops, ROUTE_ID, MONTH, [])).toHaveLength(1)
  })

  it('clears open clock when clock_out is queued', () => {
    const stops = [baseStop({ testing_site_id: 42, time_in: '9:00 AM', time_out: null })]
    const queue: PortalWorkflowQueueItem[] = [
      {
        id: 'q1',
        action: 'clock_out',
        routeId: ROUTE_ID,
        monthIso: MONTH,
        testingSiteId: 42,
        payload: { time_out: '10:00 AM' },
        enqueuedAt: 1,
      },
    ]
    expect(projectedOpenClockStops(stops, ROUTE_ID, MONTH, queue)).toHaveLength(0)
  })
})

describe('evaluatePortalEndRunPreflight', () => {
  it('prioritizes open clock over untested', () => {
    const stops = [
      baseStop({ testing_site_id: 1, time_in: '9:00 AM', time_out: null }),
      baseStop({ testing_site_id: 2, stop_number: 2 }),
    ]
    const result = evaluatePortalEndRunPreflight(stops, MONTH)
    expect(result?.kind).toBe('open_clock')
  })

  it('returns untested when no open clocks', () => {
    const stops = [baseStop({ testing_site_id: 1 }), baseStop({ testing_site_id: 2, stop_number: 2 })]
    const result = evaluatePortalEndRunPreflight(stops, MONTH)
    expect(result?.kind).toBe('untested')
    expect(result && result.kind === 'untested' ? result.stops : []).toHaveLength(2)
  })

  it('returns null when all non-annual stops have outcomes', () => {
    const stops = [baseStop({ test_outcome: 'all_good' })]
    expect(evaluatePortalEndRunPreflight(stops, MONTH)).toBeNull()
  })
})
