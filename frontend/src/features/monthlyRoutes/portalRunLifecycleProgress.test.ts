import { describe, expect, it } from 'vitest'

import {
  createRunLifecycleProgress,
  operationTitle,
  runLifecycleDetailLine,
  runLifecycleProgressPercent,
  stepStatus,
  stepsForOperation,
  syncProgressFromSnapshot,
} from './portalRunLifecycleProgress'

describe('stepsForOperation', () => {
  it('defines end run steps in order', () => {
    expect(stepsForOperation('end_run').map((step) => step.id)).toEqual([
      'sync',
      'verify',
      'submit',
    ])
  })

  it('defines skip-and-end with skip first', () => {
    expect(stepsForOperation('skip_and_end').map((step) => step.id)).toEqual([
      'skip',
      'sync',
      'submit',
    ])
  })
})

describe('operationTitle', () => {
  it('returns readable headlines', () => {
    expect(operationTitle('end_run')).toBe('Ending field run')
    expect(operationTitle('start_run')).toBe('Starting field run')
  })
})

describe('runLifecycleDetailLine', () => {
  it('formats sync progress with queue detail', () => {
    const progress = {
      ...createRunLifecycleProgress('end_run', 'sync'),
      sync: {
        initialTotal: 5,
        remaining: 3,
        activeQueue: 'workflow' as const,
      },
    }
    expect(runLifecycleDetailLine(progress)).toBe(
      'Saving 2 of 5 changes — stop outcomes, clocks, and deficiencies',
    )
  })

  it('describes empty sync queue', () => {
    const progress = {
      ...createRunLifecycleProgress('end_run', 'sync'),
      sync: {
        initialTotal: 0,
        remaining: 0,
        activeQueue: null,
      },
    }
    expect(runLifecycleDetailLine(progress)).toBe(
      'No pending changes — worksheet is up to date.',
    )
  })

  it('formats skip progress', () => {
    const progress = {
      ...createRunLifecycleProgress('skip_and_end', 'skip'),
      skip: { current: 2, total: 5 },
    }
    expect(runLifecycleDetailLine(progress)).toBe(
      'Recording skipped stops — 2 of 5 complete',
    )
  })
})

describe('runLifecycleProgressPercent', () => {
  it('allocates percent across steps', () => {
    const progress = {
      ...createRunLifecycleProgress('end_run', 'sync'),
      sync: { initialTotal: 6, remaining: 6, activeQueue: null },
    }
    expect(runLifecycleProgressPercent(progress)).toBeGreaterThan(0)
    expect(runLifecycleProgressPercent(progress)).toBeLessThan(40)
  })

  it('increases as sync drains', () => {
    const early = {
      ...createRunLifecycleProgress('end_run', 'sync'),
      sync: { initialTotal: 10, remaining: 10, activeQueue: null },
    }
    const later = {
      ...early,
      sync: { initialTotal: 10, remaining: 2, activeQueue: 'field' as const },
    }
    expect(runLifecycleProgressPercent(later)).toBeGreaterThan(
      runLifecycleProgressPercent(early),
    )
  })

  it('reaches near-complete on final submit step', () => {
    let progress = createRunLifecycleProgress('end_run', 'submit')
    progress = {
      ...progress,
      completedStepIds: ['sync', 'verify'],
    }
    expect(runLifecycleProgressPercent(progress)).toBeGreaterThanOrEqual(65)
  })
})

describe('stepStatus', () => {
  it('marks completed and active steps', () => {
    const progress = {
      ...createRunLifecycleProgress('end_run', 'verify'),
      completedStepIds: ['sync' as const],
    }
    expect(stepStatus(progress, 'sync')).toBe('done')
    expect(stepStatus(progress, 'verify')).toBe('active')
    expect(stepStatus(progress, 'submit')).toBe('pending')
  })
})

describe('syncProgressFromSnapshot', () => {
  it('merges sync snapshot into progress', () => {
    const progress = createRunLifecycleProgress('end_run', 'sync')
    const next = syncProgressFromSnapshot(progress, {
      initialTotal: 4,
      remaining: 1,
      breakdown: { field: 1, workflow: 0, runLifecycle: 0, total: 1 },
      activeQueue: 'field',
    })
    expect(next.sync).toEqual({
      initialTotal: 4,
      remaining: 1,
      activeQueue: 'field',
    })
  })
})
