import type { TechnicianWorksheetRun } from './monthlyRoutesShared'

function runExplicitlyCompleted(run: TechnicianWorksheetRun | null | undefined): boolean {
  if (!run) return false
  const ts = (run.completed_at || '').trim()
  if (ts.length > 0) return true
  const st = (run.status || '').trim().toLowerCase()
  return st === 'completed' || st === 'closed'
}

export const RUN_WORKFLOW_STAGES = [
  'draft',
  'prepared',
  'field_in_progress',
  'awaiting_office_review',
  'ready_to_close',
  'completed',
] as const

export type RunWorkflowStage = (typeof RUN_WORKFLOW_STAGES)[number]

const STAGE_LABELS: Record<RunWorkflowStage, string> = {
  draft: 'Draft',
  prepared: 'Prepared',
  field_in_progress: 'Field in progress',
  awaiting_office_review: 'Awaiting office review',
  ready_to_close: 'Ready to close',
  completed: 'Completed',
}

export const RUN_WORKFLOW_STEP_LABELS: readonly string[] = [
  'Prepare',
  'Field start',
  'Field end',
  'Office review',
  'Close',
]

function hasTs(value: string | null | undefined): boolean {
  return (value ?? '').trim().length > 0
}

export function deriveRunWorkflowStage(
  run: TechnicianWorksheetRun | null | undefined,
): RunWorkflowStage {
  if (!run) return 'draft'
  if (runExplicitlyCompleted(run)) return 'completed'
  if (hasTs(run.office_review_completed_at)) return 'ready_to_close'
  if (hasTs(run.field_ended_at)) return 'awaiting_office_review'
  if (hasTs(run.started_at)) return 'field_in_progress'
  if (hasTs(run.prepared_at)) return 'prepared'
  return 'draft'
}

export function runWorkflowStageLabel(stage: RunWorkflowStage): string {
  return STAGE_LABELS[stage] ?? stage
}

export function runWorkflowStageIndex(stage: RunWorkflowStage): number {
  switch (stage) {
    case 'draft':
      return 0
    case 'prepared':
      return 1
    case 'field_in_progress':
      return 2
    case 'awaiting_office_review':
      return 3
    case 'ready_to_close':
      return 4
    case 'completed':
      return 5
    default:
      return 0
  }
}

export function canPortalEditRun(run: TechnicianWorksheetRun | null | undefined): boolean {
  if (!run || runExplicitlyCompleted(run)) return false
  return hasTs(run.started_at) && !hasTs(run.field_ended_at)
}

export function canOfficeEditOutcomes(run: TechnicianWorksheetRun | null | undefined): boolean {
  if (!run || runExplicitlyCompleted(run)) return false
  return hasTs(run.field_ended_at)
}

/** Office bill / do-not-bill toggles unlock after technicians end the field run. */
export function canOfficeEditBilling(run: TechnicianWorksheetRun | null | undefined): boolean {
  return canOfficeEditOutcomes(run)
}

export function canOfficeCompleteRun(run: TechnicianWorksheetRun | null | undefined): boolean {
  if (!run || runExplicitlyCompleted(run)) return false
  return hasTs(run.office_review_completed_at)
}

export function worksheetRunFieldInProgress(run: TechnicianWorksheetRun | null | undefined): boolean {
  if (!run || runExplicitlyCompleted(run)) return false
  return hasTs(run.started_at) && !hasTs(run.field_ended_at)
}

export function runIsPrepared(run: TechnicianWorksheetRun | null | undefined): boolean {
  return run != null && hasTs(run.prepared_at)
}

export function runFieldEnded(run: TechnicianWorksheetRun | null | undefined): boolean {
  return run != null && hasTs(run.field_ended_at)
}

export function runInOfficePrepPhase(run: TechnicianWorksheetRun | null | undefined): boolean {
  if (run && runExplicitlyCompleted(run)) return false
  if (run && hasTs(run.started_at)) return false
  return true
}

/** Office may undo prepare while technicians have not started field work. */
export function canOfficeReturnRunToPrep(run: TechnicianWorksheetRun | null | undefined): boolean {
  if (!run || runExplicitlyCompleted(run)) return false
  if (!hasTs(run.prepared_at)) return false
  return !hasTs(run.started_at)
}

export function routeMonthRunStatusLabel(
  runSummary: { workflow_stage?: string; workflow_stage_label?: string } | null | undefined,
  hasSheetHistory: boolean,
): string {
  const label = (runSummary?.workflow_stage_label ?? '').trim()
  if (label) return label
  const stage = (runSummary?.workflow_stage ?? '').trim() as RunWorkflowStage
  if (stage && RUN_WORKFLOW_STAGES.includes(stage)) return runWorkflowStageLabel(stage)
  if (hasSheetHistory) return 'Legacy sheet'
  return 'Draft'
}
