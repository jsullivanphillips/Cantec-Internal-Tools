import type {
  MonthlyRunDetailDeficiencySummary,
  MonthlyRunDetailLocation,
  MonthlyRunDetailLocationStop,
  TechnicianWorksheetRun,
  TechnicianWorksheetStop,
} from './monthlyRoutesShared'
import { openDeficiencySummaries, runReviewDeficiencySummaries } from './runDetailsDeficiencyDisplay'
import { patchRunDetailLocationStop } from './runDetailsLocationReview'

export type PrepStopPatchChanges = Record<string, string | number | boolean | null>

function normNullableText(value: string | number | boolean | null | undefined): string | null {
  if (value == null) return null
  const text = String(value).trim()
  return text.length > 0 ? text : null
}

/** Map prep-table PATCH ``changes`` to run-details stop fields for optimistic UI. */
export function prepChangesToStopPatch(changes: PrepStopPatchChanges): Partial<MonthlyRunDetailLocationStop> {
  const patch: Partial<MonthlyRunDetailLocationStop> = {}
  if ('run_comments' in changes) {
    patch.run_comments = normNullableText(changes.run_comments)
  }
  if ('office_job_comment' in changes) {
    patch.office_job_comment = normNullableText(changes.office_job_comment)
  }
  if ('testing_procedures' in changes) {
    patch.testing_procedures = changes.testing_procedures == null ? null : String(changes.testing_procedures)
  }
  if ('inspection_tech_notes' in changes) {
    patch.inspection_tech_notes =
      changes.inspection_tech_notes == null ? null : String(changes.inspection_tech_notes)
  }
  if ('annual_month' in changes) {
    patch.annual_month = normNullableText(changes.annual_month)
  }
  if ('office_attention' in changes) {
    patch.office_attention = Boolean(changes.office_attention)
  }
  if ('prior_month_out_of_order_dismissed' in changes && changes.prior_month_out_of_order_dismissed) {
    patch.prior_month_out_of_order_dismissed = true
    patch.prior_month_out_of_order = false
    patch.prior_month_expected_stop_number = null
  }
  if ('ring' in changes) patch.ring = normNullableText(changes.ring)
  if ('key_number' in changes) patch.key_number = normNullableText(changes.key_number)
  if ('door_code' in changes) patch.door_code = normNullableText(changes.door_code)
  if ('monitoring_account_number' in changes) {
    patch.monitoring_account_number = normNullableText(changes.monitoring_account_number)
  }
  if ('monitoring_notes' in changes) {
    patch.monitoring_notes = changes.monitoring_notes == null ? null : String(changes.monitoring_notes)
  }
  if ('monitoring_company_id' in changes) {
    const raw = changes.monitoring_company_id
    patch.monitoring_company_id =
      raw == null || raw === '' ? null : typeof raw === 'number' ? raw : parseInt(String(raw), 10)
  }
  return patch
}

/** Reconcile optimistic prep edits from worksheet stop PATCH response. */
export function prepPatchFromWorksheetStop(
  stop: TechnicianWorksheetStop,
  changeKeys: string[],
): Partial<MonthlyRunDetailLocationStop> {
  const keys = new Set(changeKeys)
  const patch: Partial<MonthlyRunDetailLocationStop> = {}
  if (keys.has('run_comments')) patch.run_comments = stop.run_comments
  if (keys.has('office_job_comment')) patch.office_job_comment = stop.office_job_comment ?? null
  if (keys.has('testing_procedures')) patch.testing_procedures = stop.testing_procedures
  if (keys.has('inspection_tech_notes')) patch.inspection_tech_notes = stop.inspection_tech_notes
  if (keys.has('annual_month')) patch.annual_month = stop.annual_month
  if (keys.has('office_attention')) patch.office_attention = Boolean(stop.office_attention)
  if (keys.has('ring')) patch.ring = stop.ring ?? null
  if (keys.has('key_number')) patch.key_number = stop.key_number ?? null
  if (keys.has('door_code')) patch.door_code = stop.door_code ?? null
  if (keys.has('monitoring_account_number')) {
    patch.monitoring_account_number = stop.monitoring_account_number ?? null
  }
  if (keys.has('monitoring_notes')) patch.monitoring_notes = stop.monitoring_notes ?? null
  if (keys.has('monitoring_company_id')) {
    patch.monitoring_company_id = stop.monitoring_company_id ?? null
    patch.monitoring_company = stop.monitoring_company ?? null
    patch.monitoring_company_record = stop.monitoring_company_record ?? null
  }
  return patch
}

/** Rollback snapshot for fields present in a PATCH attempt. */
type PrepRollbackStop = Pick<
  MonthlyRunDetailLocationStop,
  | 'run_comments'
  | 'office_job_comment'
  | 'testing_procedures'
  | 'inspection_tech_notes'
  | 'annual_month'
  | 'office_attention'
  | 'prior_month_out_of_order'
  | 'prior_month_expected_stop_number'
  | 'prior_month_out_of_order_dismissed'
  | 'ring'
  | 'key_number'
  | 'door_code'
  | 'monitoring_account_number'
  | 'monitoring_notes'
  | 'monitoring_company_id'
  | 'monitoring_company'
  | 'monitoring_company_record'
>

export function rollbackPatchForChanges(
  stop: PrepRollbackStop,
  changes: PrepStopPatchChanges,
): Partial<MonthlyRunDetailLocationStop> {
  const rollback: Partial<MonthlyRunDetailLocationStop> = {}
  if ('run_comments' in changes) rollback.run_comments = stop.run_comments ?? null
  if ('office_job_comment' in changes) {
    rollback.office_job_comment = stop.office_job_comment ?? null
  }
  if ('testing_procedures' in changes) rollback.testing_procedures = stop.testing_procedures ?? null
  if ('inspection_tech_notes' in changes) {
    rollback.inspection_tech_notes = stop.inspection_tech_notes ?? null
  }
  if ('annual_month' in changes) rollback.annual_month = stop.annual_month ?? null
  if ('office_attention' in changes) rollback.office_attention = Boolean(stop.office_attention)
  if ('prior_month_out_of_order_dismissed' in changes) {
    rollback.prior_month_out_of_order_dismissed = Boolean(stop.prior_month_out_of_order_dismissed)
    rollback.prior_month_out_of_order = Boolean(stop.prior_month_out_of_order)
    rollback.prior_month_expected_stop_number = stop.prior_month_expected_stop_number ?? null
  }
  if ('ring' in changes) rollback.ring = stop.ring ?? null
  if ('key_number' in changes) rollback.key_number = stop.key_number ?? null
  if ('door_code' in changes) rollback.door_code = stop.door_code ?? null
  if ('monitoring_account_number' in changes) {
    rollback.monitoring_account_number = stop.monitoring_account_number ?? null
  }
  if ('monitoring_notes' in changes) rollback.monitoring_notes = stop.monitoring_notes ?? null
  if ('monitoring_company_id' in changes) {
    rollback.monitoring_company_id = stop.monitoring_company_id ?? null
    rollback.monitoring_company = stop.monitoring_company ?? null
    rollback.monitoring_company_record = stop.monitoring_company_record ?? null
  }
  return rollback
}

/** Normalize prep PATCH body to match optimistic merge (trim text, etc.). */
export function syncPrepChangesForApi(changes: PrepStopPatchChanges): PrepStopPatchChanges {
  const patch = prepChangesToStopPatch(changes)
  const synced: PrepStopPatchChanges = {}
  for (const key of Object.keys(changes)) {
    if (key === 'monitoring_company' || key === 'monitoring_company_record') {
      continue
    }
    if (key in patch) {
      ;(synced as Record<string, string | number | boolean | null>)[key] = (
        patch as Record<string, string | number | boolean | null | undefined>
      )[key] as string | number | boolean | null
    }
  }
  return synced
}

/** Server-only fields to merge after a successful save (optimistic UI already has the value). */
export function enrichmentPatchFromWorksheetStop(
  stop: TechnicianWorksheetStop,
  changeKeys: string[],
): Partial<MonthlyRunDetailLocationStop> {
  const keys = new Set(changeKeys)
  const patch: Partial<MonthlyRunDetailLocationStop> = {}
  if (keys.has('monitoring_company_id')) {
    patch.monitoring_company_id = stop.monitoring_company_id ?? null
    patch.monitoring_company = stop.monitoring_company ?? null
    patch.monitoring_company_record = stop.monitoring_company_record ?? null
  }
  if (keys.has('monitoring_notes')) {
    patch.monitoring_notes = stop.monitoring_notes ?? null
  }
  return patch
}

function deficiencySummariesFromWorksheetStop(
  stop: TechnicianWorksheetStop,
): MonthlyRunDetailDeficiencySummary[] {
  return (stop.deficiencies ?? []).map((def) => ({
    id: def.id,
    monthly_testing_site_id: def.monthly_testing_site_id,
    created_run_id: def.created_run_id,
    title: def.title,
    severity: def.severity,
    status: def.status,
    description: def.description,
    verification_notes: def.verification_notes,
    reported_by_tech_id: def.reported_by_tech_id ?? null,
    reported_by_tech_name: def.reported_by_tech_name ?? null,
    last_edited_by_tech_id: def.last_edited_by_tech_id ?? null,
    last_edited_by_tech_name: def.last_edited_by_tech_name ?? null,
    created_at: def.created_at ?? null,
    updated_at: def.updated_at ?? null,
  }))
}

/** Merge one saved deficiency onto a run-details stop row (prep / review lists). */
export function deficiencySummaryPatchOnStop(
  stop: MonthlyRunDetailLocationStop,
  updated: MonthlyRunDetailDeficiencySummary,
): Partial<MonthlyRunDetailLocationStop> {
  const summaries = (stop.deficiency_summaries ?? []).map((def) =>
    def.id === updated.id ? updated : def,
  )
  return {
    deficiency_summaries: summaries,
    has_active_deficiencies: openDeficiencySummaries(summaries).length > 0,
  }
}

export function patchRunDetailStopDeficiency(
  locations: MonthlyRunDetailLocation[],
  testingSiteId: number,
  monthDate: string,
  updated: MonthlyRunDetailDeficiencySummary,
): MonthlyRunDetailLocation[] {
  for (const loc of locations) {
    const hit = loc.stops.find((s) => s.testing_site_id === testingSiteId)
    if (hit) {
      return patchRunDetailLocationStop(
        locations,
        testingSiteId,
        monthDate,
        deficiencySummaryPatchOnStop(hit, updated),
      )
    }
  }
  return locations
}

/** Merge deficiency API responses without touching unrelated prep fields. */
export function deficiencyPatchFromWorksheetStop(
  stop: TechnicianWorksheetStop,
  run?: TechnicianWorksheetRun | null,
): Partial<MonthlyRunDetailLocationStop> {
  const patch: Partial<MonthlyRunDetailLocationStop> = {}
  if (stop.deficiencies !== undefined) {
    const summaries = deficiencySummariesFromWorksheetStop(stop)
    patch.deficiency_summaries = runReviewDeficiencySummaries(summaries, run ?? null)
    patch.has_active_deficiencies = patch.deficiency_summaries.length > 0
  }
  if (stop.confirmed_no_deficiencies !== undefined) {
    patch.confirmed_no_deficiencies = stop.confirmed_no_deficiencies
  }
  return patch
}

/** Map full worksheet stop PATCH response onto run-details list stop fields. */
export function detailPatchFromWorksheetStop(
  stop: TechnicianWorksheetStop,
): Partial<MonthlyRunDetailLocationStop> {
  return {
    run_comments: stop.run_comments,
    office_job_comment: stop.office_job_comment ?? null,
    testing_procedures: stop.testing_procedures,
    inspection_tech_notes: stop.inspection_tech_notes,
    annual_month: stop.annual_month,
    office_attention: Boolean(stop.office_attention),
    ring: stop.ring ?? null,
    key_number: stop.key_number ?? null,
    door_code: stop.door_code ?? null,
    monitoring_company: stop.monitoring_company ?? null,
    monitoring_company_id: stop.monitoring_company_id ?? null,
    monitoring_account_number: stop.monitoring_account_number ?? null,
    monitoring_notes: stop.monitoring_notes ?? null,
    monitoring_company_record: stop.monitoring_company_record ?? null,
    result_status: stop.result_status,
    test_outcome: stop.test_outcome ?? null,
    skip_reason: stop.skip_reason,
    skip_category: stop.skip_category ?? null,
    skip_note: stop.skip_note ?? null,
    confirmed_no_deficiencies: stop.confirmed_no_deficiencies,
  }
}
