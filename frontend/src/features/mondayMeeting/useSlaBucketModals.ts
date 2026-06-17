import { useMemo, useState } from 'react'
import { sortSlaJobsByApprovalToScheduledDesc, type ScheduledWithinSlaGoal, type SlaModalView } from './ScheduledWithinSlaGoalTile'

export function useSlaBucketModals(slaGoal: ScheduledWithinSlaGoal | undefined) {
  const [activeModal, setActiveModal] = useState<SlaModalView | null>(null)

  const businessDayLimit = slaGoal?.business_day_limit ?? 10
  const eligibleJobs = slaGoal?.eligible_jobs ?? slaGoal?.within_sla_jobs ?? []

  const buckets = useMemo(() => {
    const withinSlaJobs = eligibleJobs.filter((row) => row.within_sla)
    const outsideSlaJobs = sortSlaJobsByApprovalToScheduledDesc(eligibleJobs.filter((row) => !row.within_sla))
    const unscheduledUnderSlaJobs = slaGoal?.unscheduled_under_sla_jobs ?? []
    const awaitingJobUnderSlaJobs = slaGoal?.awaiting_job_under_sla_jobs ?? []
    const unscheduledOverSlaJobs = slaGoal?.unscheduled_over_sla_jobs ?? []
    const awaitingJobOverSlaJobs = slaGoal?.awaiting_job_over_sla_jobs ?? []

    return {
      withinSlaJobs,
      outsideSlaJobs,
      unscheduledUnderSlaJobs,
      awaitingJobUnderSlaJobs,
      unscheduledOverSlaJobs,
      awaitingJobOverSlaJobs,
    }
  }, [eligibleJobs, slaGoal])

  return {
    activeModal,
    openModal: setActiveModal,
    closeModal: () => setActiveModal(null),
    businessDayLimit,
    ...buckets,
  }
}

export type SlaBucketModalState = ReturnType<typeof useSlaBucketModals>
