import { describe, expect, it } from 'vitest'
import type { TechnicianWorksheetLocation } from './monthlyRoutesShared'
import { buildKeyViewItems } from './portalKeyViewShared'

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

describe('buildKeyViewItems', () => {
  it('sorts by stop_number and maps key fields', () => {
    const stops = [
      baseStop({ location_id: 3, stop_number: 3, key_number: 'C', ring: 'R3', display_address: '3 Main' }),
      baseStop({ location_id: 1, stop_number: 1, key_number: 'A', ring: 'R1', display_address: '1 Main' }),
      baseStop({ location_id: 2, stop_number: 2, key_number: 'B', ring: 'R2', display_address: '2 Main' }),
    ]
    const items = buildKeyViewItems(stops, 2)
    expect(items.map((item) => item.stopNumber)).toEqual([1, 2, 3])
    expect(items.map((item) => item.keyCode)).toEqual(['A', 'B', 'C'])
    expect(items[1]?.isActiveStop).toBe(true)
    expect(items[2]?.ring).toBe('R3')
    expect(items[0]?.addressLabel).toContain('Main')
  })

  it('uses em dash when key or ring missing', () => {
    const items = buildKeyViewItems([baseStop({ key_number: null, ring: null })], null)
    expect(items[0]?.keyCode).toBe('—')
    expect(items[0]?.ring).toBe('—')
  })
})
