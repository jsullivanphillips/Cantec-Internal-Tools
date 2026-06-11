import { describe, expect, it } from 'vitest'
import {
  groupOfficeWorksheetStops,
  groupOfficeWorksheetStopsInSubmissionOrder,
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
