import { describe, expect, it } from 'vitest'
import {
  groupOfficeWorksheetStops,
  groupOfficeWorksheetStopsInSubmissionOrder,
} from './officeWorksheetTableShared'
import type { TechnicianWorksheetStop } from './monthlyRoutesShared'

function stop(
  stopNumber: number,
  locationId: number,
  testingSiteId: number,
): TechnicianWorksheetStop {
  return {
    testing_site_id: testingSiteId,
    location_id: locationId,
    stop_number: stopNumber,
    display_address: `Addr ${locationId}`,
    month_date: '2026-06-01',
  } as TechnicianWorksheetStop
}

describe('groupOfficeWorksheetStopsInSubmissionOrder', () => {
  it('preserves array order and only merges consecutive same-address rows', () => {
    const stops = [stop(1, 10, 1), stop(2, 20, 2), stop(3, 10, 3)]
    const groups = groupOfficeWorksheetStopsInSubmissionOrder(stops)
    expect(groups.map((g) => g.locationId)).toEqual([10, 20, 10])
    expect(groups[0].stops.map((s) => s.testing_site_id)).toEqual([1])
    expect(groups[2].stops.map((s) => s.testing_site_id)).toEqual([3])
  })

  it('does not reorder by stop_number like groupOfficeWorksheetStops', () => {
    const stops = [stop(3, 30, 3), stop(1, 10, 1), stop(2, 20, 2)]
    const submissionOrder = groupOfficeWorksheetStopsInSubmissionOrder(stops).flatMap((g) =>
      g.stops.map((s) => s.testing_site_id),
    )
    const sortedOrder = groupOfficeWorksheetStops(stops).flatMap((g) =>
      g.stops.map((s) => s.testing_site_id),
    )
    expect(submissionOrder).toEqual([3, 1, 2])
    expect(sortedOrder).toEqual([1, 2, 3])
  })
})
