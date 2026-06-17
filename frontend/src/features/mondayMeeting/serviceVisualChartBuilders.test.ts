import { describe, expect, it } from 'vitest'
import type { ScheduledWithinSlaGoal } from './ScheduledWithinSlaGoalTile'
import type { ServiceMetrics } from './serviceMetricsTypes'
import {
  getFunnelStages,
  getRepairedDoughnutSlices,
  getSlaBucketSegments,
} from './serviceVisualChartBuilders'

const baseMetrics = (): ServiceMetrics => ({
  all_quotes: { total: 100, approved: 60, approved_pct: 60 },
  deficiency_pipeline: {
    total: 200,
    quoted: 150,
    quoted_pct: 75,
    approved_of_quoted: 90,
    approved_of_quoted_pct: 60,
    approved_with_job: 70,
    approved_with_job_pct: 77.8,
    excluded_non_quoteable: 12,
  },
  goals: {
    deficiencies_repaired: {
      actual_pct: 40,
      target_pct: 35,
      meeting_goal: true,
      repaired_count: 80,
      total_deficiencies: 200,
    },
    scheduled_within_10_business_days: {
      actual_pct: 80,
      target_pct: 100,
      meeting_goal: false,
      eligible_count: 10,
      within_sla_count: 8,
      business_day_limit: 10,
      within_sla_jobs: [
        { quote_id: 1, job_id: 1, within_sla: true, business_days: 5 } as never,
        { quote_id: 2, job_id: 2, within_sla: true, business_days: 3 } as never,
      ],
      eligible_jobs: [
        { quote_id: 1, job_id: 1, within_sla: true, business_days: 5 } as never,
        { quote_id: 2, job_id: 2, within_sla: true, business_days: 3 } as never,
        { quote_id: 3, job_id: 3, within_sla: false, business_days: 12 } as never,
      ],
      unscheduled_under_sla_jobs: [{ quote_id: 4 } as never],
      awaiting_job_under_sla_jobs: [{ quote_id: 5 } as never, { quote_id: 6 } as never],
      unscheduled_over_sla_jobs: [],
      awaiting_job_over_sla_jobs: [{ quote_id: 7 } as never],
    },
  },
})

describe('getRepairedDoughnutSlices', () => {
  it('computes repaired vs not repaired slices', () => {
    const slices = getRepairedDoughnutSlices(baseMetrics().goals.deficiencies_repaired)
    expect(slices.repaired).toBe(80)
    expect(slices.notRepaired).toBe(120)
    expect(slices.meetingGoal).toBe(true)
    expect(slices.empty).toBe(false)
  })

  it('marks empty when total deficiencies is zero', () => {
    const slices = getRepairedDoughnutSlices({
      actual_pct: 0,
      target_pct: 35,
      meeting_goal: false,
      repaired_count: 0,
      total_deficiencies: 0,
    })
    expect(slices.empty).toBe(true)
    expect(slices.notRepaired).toBe(0)
  })
})

describe('getFunnelStages', () => {
  it('returns stage counts and conversion percentages', () => {
    const metrics = baseMetrics()
    const stages = getFunnelStages(metrics.deficiency_pipeline, metrics.goals.deficiencies_repaired.repaired_count)

    expect(stages.map((s) => s.count)).toEqual([200, 150, 90, 70, 80])
    expect(stages[0]?.pctOfReported).toBe(100)
    expect(stages[1]?.pctOfReported).toBe(75)
    expect(stages[1]?.stepConversionPct).toBe(75)
    expect(stages[4]?.stepConversionPct).toBeCloseTo(114.3, 1)
  })
})

describe('getSlaBucketSegments', () => {
  it('derives scheduled and approved quote bucket counts from job arrays', () => {
    const slaGoal = baseMetrics().goals.scheduled_within_10_business_days as ScheduledWithinSlaGoal
    const segments = getSlaBucketSegments(slaGoal)

    expect(segments.scheduled.map((s) => s.count)).toEqual([2, 1])
    expect(segments.approvedQuotes.map((s) => s.count)).toEqual([1, 2, 0, 1])
  })
})
