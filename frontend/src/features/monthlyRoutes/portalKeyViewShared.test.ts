import { describe, expect, it } from 'vitest'
import type { TechnicianWorksheetStop } from './monthlyRoutesShared'
import { buildKeyViewItems } from './portalKeyViewShared'

function baseStop(overrides: Partial<TechnicianWorksheetStop> = {}): TechnicianWorksheetStop {
  return {
    testing_site_id: 1,
    location_id: 1,
    stop_number: 1,
    display_address: '2565 Beach Dr',
    month_date: '2026-05-01',
    history_month_row_id: 0,
    route_stop_order: null,
    session_route_stop_order: null,
    version_updated_at: null,
    building_name: null,
    property_management_company: null,
    label: null,
    ring: 'R1',
    key_number: '98',
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

describe('buildKeyViewItems', () => {
  it('sorts by stop_number and maps key fields', () => {
    const stops = [
      baseStop({ testing_site_id: 2, location_id: 3, stop_number: 3, key_number: 'C', ring: 'R3', display_address: '3 Main' }),
      baseStop({ testing_site_id: 1, location_id: 1, stop_number: 1, key_number: 'A', ring: 'R1', display_address: '1 Main' }),
      baseStop({ testing_site_id: 3, location_id: 2, stop_number: 2, key_number: 'B', ring: 'R2', display_address: '2 Main' }),
    ]
    const items = buildKeyViewItems(stops, 2)
    expect(items.map((item) => item.stopNumber)).toEqual([1, 2, 3])
    expect(items.map((item) => item.keyCode)).toEqual(['A', 'B', 'C'])
    expect(items[2]?.isActiveStop).toBe(true)
    expect(items[2]?.ring).toBe('R3')
    expect(items[0]?.addressLabel).toContain('Main')
  })

  it('uses em dash when key or ring missing', () => {
    const items = buildKeyViewItems([baseStop({ key_number: null, ring: null })], null)
    expect(items[0]?.keyCode).toBe('—')
    expect(items[0]?.ring).toBe('—')
  })
})
