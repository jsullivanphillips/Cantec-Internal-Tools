import type {
  MonthlyRunDetailLocationStop,
  TechnicianWorksheetStop,
} from './monthlyRoutesShared'

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
