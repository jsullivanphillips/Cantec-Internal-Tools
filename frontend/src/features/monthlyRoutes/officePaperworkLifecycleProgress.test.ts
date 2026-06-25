import { describe, expect, it } from 'vitest'

import {
  completeOfficePaperworkLifecycleStep,
  createOfficePaperworkLifecycleProgress,
  officePaperworkLifecycleBannerDetail,
  officePaperworkLifecycleDisplayMode,
  officePaperworkLifecycleTitle,
  officePaperworkLifecycleTransitionLine,
  predictPaperworkLifecycleTargetView,
  stepsForOfficePaperworkLifecycle,
} from './officePaperworkLifecycleProgress'

describe('officePaperworkLifecycleDisplayMode', () => {
  it('uses banner for all lifecycle actions', () => {
    expect(officePaperworkLifecycleDisplayMode('prepare')).toBe('banner')
    expect(officePaperworkLifecycleDisplayMode('complete')).toBe('banner')
    expect(officePaperworkLifecycleDisplayMode('reopen')).toBe('banner')
    expect(officePaperworkLifecycleDisplayMode('unprepare')).toBe('banner')
  })
})

describe('stepsForOfficePaperworkLifecycle', () => {
  it('uses the same fast in-place steps for every operation', () => {
    expect(stepsForOfficePaperworkLifecycle('prepare').map((step) => step.id)).toEqual([
      'submit',
      'update_ui',
    ])
    expect(stepsForOfficePaperworkLifecycle('complete').map((step) => step.id)).toEqual([
      'submit',
      'update_ui',
    ])
  })
})

describe('predictPaperworkLifecycleTargetView', () => {
  it('keeps preparation view for prepare and unprepare', () => {
    expect(predictPaperworkLifecycleTargetView('prepare')).toBe('preparation')
    expect(predictPaperworkLifecycleTargetView('unprepare')).toBe('preparation')
  })

  it('maps complete and reopen to their paperwork views', () => {
    expect(predictPaperworkLifecycleTargetView('complete')).toBe('exact_history')
    expect(predictPaperworkLifecycleTargetView('reopen')).toBe('run_review')
  })
})

describe('officePaperworkLifecycleBannerDetail', () => {
  it('describes workflow stage for prepare instead of a view switch', () => {
    const progress = createOfficePaperworkLifecycleProgress('prepare', 'preparation')
    expect(officePaperworkLifecycleBannerDetail(progress)).toContain('Ready')
    expect(officePaperworkLifecycleBannerDetail(progress)).not.toContain('Run review')
  })
})

describe('officePaperworkLifecycleTransitionLine', () => {
  it('formats from and to view labels', () => {
    const progress = createOfficePaperworkLifecycleProgress('complete', 'run_review')
    expect(officePaperworkLifecycleTransitionLine(progress)).toBe(
      'Run review → Exact history',
    )
  })
})

describe('completeOfficePaperworkLifecycleStep', () => {
  it('advances through fast steps', () => {
    let progress = createOfficePaperworkLifecycleProgress('prepare', 'preparation')
    expect(progress.activeStepId).toBe('submit')

    progress = completeOfficePaperworkLifecycleStep(progress)
    expect(progress.activeStepId).toBe('update_ui')
    expect(progress.completedStepIds).toEqual(['submit'])
  })
})

describe('officePaperworkLifecycleTitle', () => {
  it('returns readable headlines', () => {
    expect(officePaperworkLifecycleTitle('prepare')).toBe('Marking route prepared')
    expect(officePaperworkLifecycleTitle('complete')).toBe('Completing job')
  })
})
