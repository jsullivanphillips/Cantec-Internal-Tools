/**
 * Structured progress for office paperwork lifecycle transitions.
 *
 * Lifecycle actions patch the run header in place — the worksheet on screen is
 * already current while office staff work in prep. No full run_details reload.
 */

import {
  paperworkViewModeLabel,
  type PaperworkViewMode,
} from './paperworkViewMode'

export type OfficePaperworkLifecycleOperation = 'prepare' | 'unprepare' | 'complete' | 'reopen'

export type OfficePaperworkLifecycleStepId = 'submit' | 'update_ui'

export type OfficePaperworkLifecycleDisplayMode = 'banner'

export type OfficePaperworkLifecycleStepDef = {
  id: OfficePaperworkLifecycleStepId
  title: string
  description: string
}

export type OfficePaperworkLifecycleProgress = {
  operation: OfficePaperworkLifecycleOperation
  displayMode: OfficePaperworkLifecycleDisplayMode
  fromView: PaperworkViewMode
  toView: PaperworkViewMode
  activeStepId: OfficePaperworkLifecycleStepId
  completedStepIds: OfficePaperworkLifecycleStepId[]
}

const FAST_OPERATION_STEPS: OfficePaperworkLifecycleStepDef[] = [
  {
    id: 'submit',
    title: 'Update run status',
    description: 'Saving the workflow change on the server.',
  },
  {
    id: 'update_ui',
    title: 'Update paperwork',
    description: 'Applying the new workflow state on this page.',
  },
]

const OPERATION_STEPS: Record<OfficePaperworkLifecycleOperation, OfficePaperworkLifecycleStepDef[]> = {
  prepare: FAST_OPERATION_STEPS,
  unprepare: FAST_OPERATION_STEPS,
  complete: FAST_OPERATION_STEPS,
  reopen: FAST_OPERATION_STEPS,
}

const OPERATION_TITLES: Record<OfficePaperworkLifecycleOperation, string> = {
  prepare: 'Marking route prepared',
  unprepare: 'Returning to preparation',
  complete: 'Completing job',
  reopen: 'Reopening job',
}

export function officePaperworkLifecycleDisplayMode(
  _operation: OfficePaperworkLifecycleOperation,
): OfficePaperworkLifecycleDisplayMode {
  return 'banner'
}

export function predictPaperworkLifecycleTargetView(
  operation: OfficePaperworkLifecycleOperation,
): PaperworkViewMode {
  switch (operation) {
    case 'prepare':
    case 'unprepare':
      return 'preparation'
    case 'complete':
      return 'exact_history'
    case 'reopen':
      return 'run_review'
    default:
      return 'run_review'
  }
}

export function stepsForOfficePaperworkLifecycle(
  operation: OfficePaperworkLifecycleOperation,
): OfficePaperworkLifecycleStepDef[] {
  return OPERATION_STEPS[operation]
}

export function officePaperworkLifecycleTitle(
  operation: OfficePaperworkLifecycleOperation,
): string {
  return OPERATION_TITLES[operation]
}

export function createOfficePaperworkLifecycleProgress(
  operation: OfficePaperworkLifecycleOperation,
  fromView: PaperworkViewMode,
): OfficePaperworkLifecycleProgress {
  const steps = stepsForOfficePaperworkLifecycle(operation)
  return {
    operation,
    displayMode: officePaperworkLifecycleDisplayMode(operation),
    fromView,
    toView: predictPaperworkLifecycleTargetView(operation),
    activeStepId: steps[0].id,
    completedStepIds: [],
  }
}

export function completeOfficePaperworkLifecycleStep(
  progress: OfficePaperworkLifecycleProgress,
): OfficePaperworkLifecycleProgress {
  const steps = stepsForOfficePaperworkLifecycle(progress.operation)
  const currentIndex = steps.findIndex((step) => step.id === progress.activeStepId)
  if (currentIndex < 0) return progress

  const completed = new Set(progress.completedStepIds)
  completed.add(progress.activeStepId)
  const nextStep = steps[currentIndex + 1]
  if (!nextStep) {
    return {
      ...progress,
      completedStepIds: [...completed],
    }
  }
  return {
    ...progress,
    activeStepId: nextStep.id,
    completedStepIds: [...completed],
  }
}

export function updateOfficePaperworkLifecycleTargetView(
  progress: OfficePaperworkLifecycleProgress,
  toView: PaperworkViewMode,
): OfficePaperworkLifecycleProgress {
  return { ...progress, toView }
}

/** User-facing banner detail — workflow stage vs paperwork view mode. */
export function officePaperworkLifecycleBannerDetail(
  progress: OfficePaperworkLifecycleProgress,
): string {
  switch (progress.operation) {
    case 'prepare':
      return 'Moving to Ready — prep paperwork will lock until you return to preparation.'
    case 'unprepare':
      return 'Returning to Draft — prep paperwork is editable again.'
    case 'complete':
      return `Switching: ${officePaperworkLifecycleTransitionLine(progress)}…`
    case 'reopen':
      return `Switching: ${officePaperworkLifecycleTransitionLine(progress)}…`
    default:
      return `Switching: ${officePaperworkLifecycleTransitionLine(progress)}…`
  }
}

export function officePaperworkLifecycleTransitionLine(
  progress: OfficePaperworkLifecycleProgress,
): string {
  return `${paperworkViewModeLabel(progress.fromView)} → ${paperworkViewModeLabel(progress.toView)}`
}

export function officePaperworkLifecycleDetailLine(
  progress: OfficePaperworkLifecycleProgress,
): string {
  const step = stepsForOfficePaperworkLifecycle(progress.operation).find(
    (candidate) => candidate.id === progress.activeStepId,
  )
  return step?.description ?? ''
}
