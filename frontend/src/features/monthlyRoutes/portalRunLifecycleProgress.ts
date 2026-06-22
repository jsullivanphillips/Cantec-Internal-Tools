/**
 * Structured progress for portal run lifecycle blocking overlays.
 */

export type PortalRunLifecycleOperation =
  | 'start_run'
  | 'end_run'
  | 'skip_and_end'
  | 'reopen_field'
  | 'end_run_direct'

export type PortalRunLifecycleStepId =
  | 'register'
  | 'skip'
  | 'sync'
  | 'verify'
  | 'submit'

export type PortalSyncActiveQueue = 'workflow' | 'field' | 'run_lifecycle' | null

export type PortalRunLifecycleStepDef = {
  id: PortalRunLifecycleStepId
  title: string
  description: string
}

export type PortalRunLifecycleProgress = {
  operation: PortalRunLifecycleOperation
  activeStepId: PortalRunLifecycleStepId
  completedStepIds: PortalRunLifecycleStepId[]
  sync?: {
    initialTotal: number
    remaining: number
    activeQueue: PortalSyncActiveQueue
  }
  skip?: { current: number; total: number }
}

export type PortalSyncProgressSnapshot = {
  initialTotal: number
  remaining: number
  breakdown: { field: number; workflow: number; runLifecycle: number; total: number }
  activeQueue: PortalSyncActiveQueue
}

const OPERATION_STEPS: Record<PortalRunLifecycleOperation, PortalRunLifecycleStepDef[]> = {
  start_run: [
    {
      id: 'register',
      title: 'Register run start',
      description: 'Recording that your field run has started.',
    },
    {
      id: 'sync',
      title: 'Save pending changes',
      description: 'Uploading any unsaved worksheet edits before you begin.',
    },
  ],
  end_run: [
    {
      id: 'sync',
      title: 'Save pending changes',
      description: 'Uploading stop outcomes, clocks, and field edits.',
    },
    {
      id: 'verify',
      title: 'Verify worksheet',
      description: 'Checking clocks and test outcomes before ending the run.',
    },
    {
      id: 'submit',
      title: 'End field run',
      description: 'Finalizing your field run on the server.',
    },
  ],
  skip_and_end: [
    {
      id: 'skip',
      title: 'Record skipped stops',
      description: 'Marking remaining stops as skipped for lack of time.',
    },
    {
      id: 'sync',
      title: 'Save pending changes',
      description: 'Uploading stop outcomes and field edits.',
    },
    {
      id: 'submit',
      title: 'End field run',
      description: 'Finalizing your field run on the server.',
    },
  ],
  reopen_field: [
    {
      id: 'submit',
      title: 'Reopen field run',
      description: 'Restoring the run so you can continue testing in the field.',
    },
  ],
  end_run_direct: [
    {
      id: 'submit',
      title: 'End field run',
      description: 'Finalizing your field run on the server.',
    },
  ],
}

const OPERATION_TITLES: Record<PortalRunLifecycleOperation, string> = {
  start_run: 'Starting field run',
  end_run: 'Ending field run',
  skip_and_end: 'Ending field run',
  reopen_field: 'Reopening field run',
  end_run_direct: 'Ending field run',
}

const QUEUE_DETAIL_LABELS: Record<Exclude<PortalSyncActiveQueue, null>, string> = {
  workflow: 'stop outcomes, clocks, and deficiencies',
  field: 'field worksheet edits',
  run_lifecycle: 'run start and end actions',
}

export function stepsForOperation(operation: PortalRunLifecycleOperation): PortalRunLifecycleStepDef[] {
  return OPERATION_STEPS[operation]
}

export function operationTitle(operation: PortalRunLifecycleOperation): string {
  return OPERATION_TITLES[operation]
}

export function createRunLifecycleProgress(
  operation: PortalRunLifecycleOperation,
  activeStepId?: PortalRunLifecycleStepId,
): PortalRunLifecycleProgress {
  const steps = stepsForOperation(operation)
  return {
    operation,
    activeStepId: activeStepId ?? steps[0].id,
    completedStepIds: [],
  }
}

export function advanceRunLifecycleStep(
  progress: PortalRunLifecycleProgress,
  nextActiveStepId: PortalRunLifecycleStepId,
): PortalRunLifecycleProgress {
  const steps = stepsForOperation(progress.operation)
  const currentIndex = steps.findIndex((step) => step.id === progress.activeStepId)
  const nextIndex = steps.findIndex((step) => step.id === nextActiveStepId)
  const completed = new Set(progress.completedStepIds)
  if (currentIndex >= 0 && nextIndex > currentIndex) {
    for (let i = currentIndex; i < nextIndex; i += 1) {
      completed.add(steps[i].id)
    }
  }
  return {
    ...progress,
    activeStepId: nextActiveStepId,
    completedStepIds: [...completed],
    sync: nextActiveStepId === 'sync' ? progress.sync : undefined,
    skip: nextActiveStepId === 'skip' ? progress.skip : undefined,
  }
}

export function completeRunLifecycleStep(
  progress: PortalRunLifecycleProgress,
): PortalRunLifecycleProgress {
  const steps = stepsForOperation(progress.operation)
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
    sync: nextStep.id === 'sync' ? progress.sync : undefined,
    skip: nextStep.id === 'skip' ? progress.skip : undefined,
  }
}

function queueDetailLabel(activeQueue: PortalSyncActiveQueue): string {
  if (!activeQueue) return 'stop outcomes and field edits'
  return QUEUE_DETAIL_LABELS[activeQueue]
}

export function runLifecycleDetailLine(progress: PortalRunLifecycleProgress): string {
  const step = stepsForOperation(progress.operation).find((s) => s.id === progress.activeStepId)
  if (!step) return ''

  if (progress.activeStepId === 'sync' && progress.sync) {
    const { initialTotal, remaining, activeQueue } = progress.sync
    if (initialTotal <= 0) {
      return 'No pending changes — worksheet is up to date.'
    }
    const saved = Math.max(0, initialTotal - remaining)
    return `Saving ${saved} of ${initialTotal} changes — ${queueDetailLabel(activeQueue)}`
  }

  if (progress.activeStepId === 'skip' && progress.skip) {
    const { current, total } = progress.skip
    if (total <= 0) return step.description
    return `Recording skipped stops — ${current} of ${total} complete`
  }

  return step.description
}

function withinStepFraction(progress: PortalRunLifecycleProgress): number {
  if (progress.activeStepId === 'sync' && progress.sync) {
    const { initialTotal, remaining } = progress.sync
    if (initialTotal <= 0) return 1
    return Math.min(1, Math.max(0, (initialTotal - remaining) / initialTotal))
  }
  if (progress.activeStepId === 'skip' && progress.skip) {
    const { current, total } = progress.skip
    if (total <= 0) return 0
    return Math.min(1, Math.max(0, current / total))
  }
  if (progress.activeStepId === 'verify' || progress.activeStepId === 'register') {
    return 0.5
  }
  if (progress.activeStepId === 'submit') {
    return 0.65
  }
  return 0
}

export function runLifecycleProgressPercent(progress: PortalRunLifecycleProgress): number {
  const steps = stepsForOperation(progress.operation)
  const activeIndex = steps.findIndex((step) => step.id === progress.activeStepId)
  if (activeIndex < 0) return 0

  const allDone =
    activeIndex === steps.length - 1 &&
    progress.completedStepIds.includes(progress.activeStepId)
  if (allDone) return 100

  const stepWeight = 100 / steps.length
  const base = activeIndex * stepWeight
  let within = withinStepFraction(progress)
  if (within === 0 && progress.activeStepId === steps[activeIndex]?.id) {
    within = 0.06
  }
  return Math.min(99, Math.round(base + within * stepWeight))
}

export function stepStatus(
  progress: PortalRunLifecycleProgress,
  stepId: PortalRunLifecycleStepId,
): 'done' | 'active' | 'pending' {
  if (progress.completedStepIds.includes(stepId)) return 'done'
  if (progress.activeStepId === stepId) return 'active'
  return 'pending'
}

export function syncProgressFromSnapshot(
  progress: PortalRunLifecycleProgress,
  snapshot: PortalSyncProgressSnapshot,
): PortalRunLifecycleProgress {
  return {
    ...progress,
    sync: {
      initialTotal: snapshot.initialTotal,
      remaining: snapshot.remaining,
      activeQueue: snapshot.activeQueue,
    },
  }
}
