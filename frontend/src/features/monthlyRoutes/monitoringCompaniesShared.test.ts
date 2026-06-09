import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TechnicianWorksheetStop } from './monthlyRoutesShared'
import {
  enrichStopMonitoringFromDirectory,
  loadMonitoringCompaniesCache,
  MONITORING_COMPANIES_CACHE_KEY,
  saveMonitoringCompaniesCache,
} from './monitoringCompaniesShared'

function stop(patch: Partial<TechnicianWorksheetStop> = {}): TechnicianWorksheetStop {
  return {
    testing_site_id: 1,
    location_id: 1,
    stop_number: 1,
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
    monitoring_company_id: null,
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

function installLocalStorageMock(): void {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
  })
}

describe('monitoringCompaniesShared cache', () => {
  beforeEach(() => {
    installLocalStorageMock()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('round-trips companies through the versioned cache bundle', () => {
    saveMonitoringCompaniesCache([
      { id: 9, name: 'Acme Monitoring', primary_phone: '604-555-0100', active: true },
    ])
    expect(loadMonitoringCompaniesCache()).toEqual([
      { id: 9, name: 'Acme Monitoring', primary_phone: '604-555-0100', active: true },
    ])
  })

  it('reads legacy array-only cache payloads', () => {
    localStorage.setItem(
      MONITORING_COMPANIES_CACHE_KEY,
      JSON.stringify([{ id: 2, name: 'Legacy Co', primary_phone: '604-555-0200' }]),
    )
    expect(loadMonitoringCompaniesCache()).toEqual([
      { id: 2, name: 'Legacy Co', primary_phone: '604-555-0200' },
    ])
  })
})

describe('enrichStopMonitoringFromDirectory', () => {
  const directory = [
    { id: 9, name: 'Acme Monitoring', primary_phone: '604-555-0100', secondary_phone: '604-555-0101' },
  ]

  it('fills phones from the directory when the stop only has an id', () => {
    const enriched = enrichStopMonitoringFromDirectory(
      stop({ monitoring_company_id: 9, monitoring_company: 'Acme Monitoring' }),
      directory,
    )
    expect(enriched.monitoring_company_record?.primary_phone).toBe('604-555-0100')
    expect(enriched.monitoring_company_record?.secondary_phone).toBe('604-555-0101')
  })

  it('keeps stop-specific record fields when already present', () => {
    const enriched = enrichStopMonitoringFromDirectory(
      stop({
        monitoring_company_id: 9,
        monitoring_company_record: {
          id: 9,
          name: 'Acme Monitoring',
          primary_phone: '604-555-9999',
        },
      }),
      directory,
    )
    expect(enriched.monitoring_company_record?.primary_phone).toBe('604-555-9999')
    expect(enriched.monitoring_company_record?.secondary_phone).toBe('604-555-0101')
  })
})
