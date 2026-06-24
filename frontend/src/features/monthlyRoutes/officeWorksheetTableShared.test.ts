import { describe, expect, it } from 'vitest'
import {
  groupOfficeWorksheetStops,
  groupOfficeWorksheetStopsInSubmissionOrder,
  officeStopStatus,
  skippedStopDisplayTone,
  stopHasSkippedOutcome,
  stopIsOfficePrepSkipped,
  worksheetStopIsAnnualSkip,
} from './officeWorksheetTableShared'
import type { TechnicianWorksheetLocation } from './monthlyRoutesShared'

function stop(
  stopNumber: number,
  groupKey: number,
  worksheetLocationId: number,
): TechnicianWorksheetLocation {
  return {
    location_id: worksheetLocationId,
    location_month_row_id: 0,
    stop_number: stopNumber,
    display_address: `Addr ${groupKey}`,
    month_date: '2026-06-01',
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
    version_updated_at: null,
  }
}

describe('groupOfficeWorksheetStopsInSubmissionOrder', () => {
  it('uses location label as the group primary heading', () => {
    const stops: TechnicianWorksheetLocation[] = [
      {
        ...stop(1, 10, 1),
        label: '9824-9830 Fourth Street',
        display_address: '9824 Fourth Street, Sidney, British Columbia V8L 2Z3, Canada',
        building_name: 'The Aranza',
      },
    ]
    const [group] = groupOfficeWorksheetStops(stops)
    expect(group.primaryLabel).toBe('9824-9830 Fourth Street')
    expect(group.addressSubline).toBe(
      '9824 Fourth Street, Sidney, British Columbia V8L 2Z3, Canada',
    )
    expect(group.buildingName).toBe('The Aranza')
  })

  it('preserves array order with one group per stop (no same-address merge)', () => {
    const stops = [stop(1, 10, 1), stop(2, 10, 3), stop(3, 10, 5)]
    const groups = groupOfficeWorksheetStopsInSubmissionOrder(stops)
    expect(groups).toHaveLength(3)
    expect(groups.map((g) => g.locationId)).toEqual([1, 3, 5])
    expect(groups.flatMap((g) => g.stops.map((s) => s.location_id))).toEqual([1, 3, 5])
  })

  it('does not reorder by stop_number like groupOfficeWorksheetStops', () => {
    const stops = [stop(3, 30, 3), stop(1, 10, 1), stop(2, 20, 2)]
    const submissionOrder = groupOfficeWorksheetStopsInSubmissionOrder(stops).flatMap((g) =>
      g.stops.map((s) => s.location_id),
    )
    const sortedOrder = groupOfficeWorksheetStops(stops).flatMap((g) =>
      g.stops.map((s) => s.location_id),
    )
    expect(submissionOrder).toEqual([3, 1, 2])
    expect(sortedOrder).toEqual([1, 2, 3])
  })
})

describe('stopIsOfficePrepSkipped', () => {
  it('is false for legacy sheet result_status without test_outcome', () => {
    const ws = stop(1, 10, 1)
    ws.month_date = '2026-07-01'
    ws.result_status = 'skipped'
    ws.skip_reason = 'annual'
    expect(stopIsOfficePrepSkipped(ws)).toBe(false)
    expect(stopHasSkippedOutcome(ws)).toBe(true)
  })

  it('is true when office prep skip set test_outcome', () => {
    const ws = stop(1, 10, 1)
    ws.test_outcome = 'skipped'
    ws.skip_category = 'access_issues'
    expect(stopIsOfficePrepSkipped(ws)).toBe(true)
  })
})

describe('worksheetStopIsAnnualSkip', () => {
  it('uses scheduled annual auto-skip when skip has no explicit reason', () => {
    const ws = stop(1, 10, 1)
    ws.month_date = '2026-06-01'
    ws.result_status = 'skipped'
    ws.scheduled_annual_auto_skip = true
    expect(worksheetStopIsAnnualSkip(ws, '2026-06-01')).toBe(true)
    expect(skippedStopDisplayTone(ws, '2026-06-01')).toBe('skipped')
    expect(officeStopStatus(ws, '2026-06-01')).toBe('skipped')
  })

  it('honors explicit non-annual skip reason over scheduled annual auto-skip', () => {
    const ws = stop(1, 10, 1)
    ws.month_date = '2026-06-01'
    ws.result_status = 'skipped'
    ws.skip_category = 'access_issues'
    ws.scheduled_annual_auto_skip = true
    expect(worksheetStopIsAnnualSkip(ws, '2026-06-01')).toBe(false)
    expect(officeStopStatus(ws, '2026-06-01')).toBe('skipped')
  })

  it('marks pending stops with scheduled annual auto-skip as annual', () => {
    const ws = stop(1, 10, 1)
    ws.scheduled_annual_auto_skip = true
    expect(officeStopStatus(ws, '2026-06-01')).toBe('annual')
  })
})
