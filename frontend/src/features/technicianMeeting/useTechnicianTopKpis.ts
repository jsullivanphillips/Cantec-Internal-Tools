import { useMemo } from 'react'
import {
  topTechnicianFromRecord,
  topTechnicianLeader,
  type TopTechnicianLeader,
} from './technicianMetricsCharts'

export type TechnicianTopKpi = {
  key: string
  label: string
  leader: TopTechnicianLeader | null
  countLabel: string
}

export function useTechnicianTopKpis(techData: Record<string, unknown> | null): TechnicianTopKpi[] {
  return useMemo(() => {
    const techMetrics = techData?.technician_metrics as
      | { jobs_completed_by_tech?: Record<string, number> }
      | undefined
    const jobItems = techData?.job_items_created_by_tech as
      | { technicians?: string[]; counts?: number[] }
      | undefined
    const deficiencyPayload = techData?.deficiencies_by_tech_service_line as
      | { entries?: { technician: string; count: number }[] }
      | undefined
    const attachments = techData?.attachments_by_tech as
      | { technician: string; count: number }[]
      | undefined

    const jobItemEntries = (jobItems?.technicians ?? []).map((technician, index) => ({
      technician,
      count: jobItems?.counts?.[index] ?? 0,
    }))

    const deficiencyTotals: Record<string, number> = {}
    for (const { technician, count } of deficiencyPayload?.entries ?? []) {
      deficiencyTotals[technician] = (deficiencyTotals[technician] ?? 0) + count
    }

    return [
      {
        key: 'job-items',
        label: 'Job items added',
        leader: topTechnicianLeader(jobItemEntries),
        countLabel: 'job items',
      },
      {
        key: 'jobs-completed',
        label: 'Jobs completed',
        leader: topTechnicianFromRecord(techMetrics?.jobs_completed_by_tech ?? {}),
        countLabel: 'jobs',
      },
      {
        key: 'deficiencies-created',
        label: 'Deficiencies created',
        leader: topTechnicianFromRecord(deficiencyTotals),
        countLabel: 'deficiencies',
      },
      {
        key: 'attachments',
        label: 'Attachments on deficiencies',
        leader: topTechnicianLeader(attachments ?? []),
        countLabel: 'attachments',
      },
    ]
  }, [techData])
}
