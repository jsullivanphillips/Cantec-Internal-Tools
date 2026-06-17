import type { ScheduledWithinSlaGoal } from './ScheduledWithinSlaGoalTile'
import type { SlaJobRow } from './slaSchedulingTypes'

export type DeficiencyPipelineMetrics = {
  total: number
  quoted: number
  quoted_pct: number
  approved_of_quoted: number
  approved_of_quoted_pct: number
  approved_with_job: number
  approved_with_job_pct: number
  excluded_non_quoteable?: number
  excluded_keyword?: number
  excluded_stale_cluster?: number
  classification?: {
    classified_count: number
    needs_classification: boolean
    last_classified_at: string | null
  }
}

export type DeficienciesRepairedGoal = {
  actual_pct: number
  target_pct: number
  meeting_goal: boolean
  repaired_count: number
  total_deficiencies: number
}

export type ServiceMetrics = {
  all_quotes: {
    total: number
    approved: number
    approved_pct: number
  }
  deficiency_pipeline: DeficiencyPipelineMetrics
  goals: {
    deficiencies_repaired: DeficienciesRepairedGoal
    scheduled_within_10_business_days: ScheduledWithinSlaGoal & {
      within_sla_jobs: SlaJobRow[]
      eligible_jobs?: SlaJobRow[]
    }
  }
}

export type ServiceViewMode = 'metrics' | 'visuals'

export const SERVICE_VIEW_MODE_STORAGE_KEY = 'monday-meeting-service-view-mode'
