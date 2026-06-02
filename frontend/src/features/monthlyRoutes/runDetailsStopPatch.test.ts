import { describe, expect, it } from 'vitest'
import {
  deficiencyPatchFromWorksheetStop,
  detailPatchFromWorksheetStop,
  enrichmentPatchFromWorksheetStop,
  prepPatchFromWorksheetStop,
  rollbackPatchForChanges,
  syncPrepChangesForApi,
} from './runDetailsPrepPatch'
import { isStopPatchGenerationCurrent } from './useRunDetailsStopPatch'
import type { TechnicianWorksheetStop } from './monthlyRoutesShared'

function sampleWorksheetStop(overrides: Partial<TechnicianWorksheetStop> = {}): TechnicianWorksheetStop {
  return {
    testing_site_id: 12,
    location_id: 1,
    history_month_row_id: 1,
    month_date: '2026-06-01',
    display_address: '1 Main St',
    building_name: null,
    property_management_company: null,
    label: null,
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
    run_comments: 'hello',
    time_in: null,
    time_out: null,
    route_stop_order: null,
    session_route_stop_order: null,
    stop_number: 1,
    version_updated_at: null,
    ...overrides,
  }
}

describe('isStopPatchGenerationCurrent', () => {
  it('ignores stale response when a newer save superseded it', () => {
    const generations = new Map<number, number>([[12, 2]])
    expect(isStopPatchGenerationCurrent(generations, 12, 1)).toBe(false)
    expect(isStopPatchGenerationCurrent(generations, 12, 2)).toBe(true)
  })
})

describe('detailPatchFromWorksheetStop', () => {
  it('maps run_comments from worksheet stop', () => {
    const stop = sampleWorksheetStop({ run_comments: 'Job note' })
    expect(detailPatchFromWorksheetStop(stop).run_comments).toBe('Job note')
  })
})

describe('prepPatchFromWorksheetStop', () => {
  it('only merges keys present in the change set', () => {
    const stop = sampleWorksheetStop({ run_comments: 'new', ring: '5' })
    const patch = prepPatchFromWorksheetStop(stop, ['run_comments'])
    expect(patch.run_comments).toBe('new')
    expect(patch.ring).toBeUndefined()
    expect(patch.office_attention).toBeUndefined()
  })
})

describe('detailPatchFromWorksheetStop vs field reconcile', () => {
  it('full worksheet patch overwrites unrelated fields that partial reconcile preserves', () => {
    const stop = sampleWorksheetStop({
      run_comments: null,
      office_attention: false,
    })
    const partial = prepPatchFromWorksheetStop(stop, ['office_attention'])
    const full = detailPatchFromWorksheetStop(stop)
    expect(partial.run_comments).toBeUndefined()
    expect(full.run_comments).toBeNull()
  })
})

describe('syncPrepChangesForApi', () => {
  it('trims run_comments before PATCH', () => {
    expect(syncPrepChangesForApi({ run_comments: '  hello  ' })).toEqual({
      run_comments: 'hello',
    })
  })
})

describe('enrichmentPatchFromWorksheetStop', () => {
  it('only adds monitoring labels when company id changed', () => {
    const stop = sampleWorksheetStop({
      monitoring_company_id: 9,
      monitoring_company: 'Acme',
    })
    const patch = enrichmentPatchFromWorksheetStop(stop, ['monitoring_company_id'])
    expect(patch.monitoring_company).toBe('Acme')
    expect(patch.run_comments).toBeUndefined()
  })
})

describe('deficiencyPatchFromWorksheetStop', () => {
  it('does not touch prep fields like run_comments', () => {
    const stop = sampleWorksheetStop({
      run_comments: null,
      deficiencies: [],
    })
    const patch = deficiencyPatchFromWorksheetStop(stop)
    expect(patch.deficiency_summaries).toEqual([])
    expect(patch).not.toHaveProperty('run_comments')
  })
})

describe('rollbackPatchForChanges', () => {
  it('captures prior values for edited fields only', () => {
    const stop = {
      run_comments: 'old',
      testing_procedures: null,
      inspection_tech_notes: null,
      annual_month: null,
      office_attention: false,
      ring: null,
      key_number: null,
      door_code: null,
      monitoring_account_number: null,
      monitoring_notes: null,
      monitoring_company_id: null,
      monitoring_company: null,
      monitoring_company_record: null,
    }
    expect(rollbackPatchForChanges(stop, { run_comments: 'new' })).toEqual({
      run_comments: 'old',
    })
  })
})
