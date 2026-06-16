import { useMemo } from 'react'
import {
  buildDefsByTechDatasets,
  buildJobsCompletedDatasets,
  noDatalabels,
  type TopN,
} from './technicianMetricsCharts'

export function useTechnicianMetricsCharts(
  techData: Record<string, unknown> | null,
  techTopN: TopN,
) {
  const techMetrics = techData?.technician_metrics as
    | {
        revenue_per_hour?: Record<string, number>
        jobs_completed_by_tech?: Record<string, number>
        jobs_completed_by_tech_job_type?: {
          technicians?: string[]
          job_types?: string[]
          entries?: { technician: string; job_type: string; count: number }[]
        }
      }
    | undefined

  const revenueChart = useMemo(() => {
    const rev = techMetrics?.revenue_per_hour
    if (!rev || !Object.keys(rev).length) return null
    const pairs = Object.entries(rev).sort((a, b) => b[1] - a[1])
    const N = techTopN === 'all' ? pairs.length : techTopN
    const slice = pairs.slice(0, N)
    return {
      type: 'bar' as const,
      data: {
        labels: slice.map(([k]) => k),
        datasets: [
          {
            label: 'Revenue / hr',
            data: slice.map(([, v]) => v),
            backgroundColor: 'rgba(89, 161, 79, 0.75)',
            borderRadius: 6,
          },
        ],
      },
      options: {
        indexAxis: 'y' as const,
        responsive: true,
        plugins: { legend: { display: false }, ...noDatalabels },
        scales: {
          x: { beginAtZero: true, title: { display: true, text: '$ / hr' } },
        },
      },
    }
  }, [techMetrics, techTopN])

  const jobItemsChart = useMemo(() => {
    const ji = techData?.job_items_created_by_tech as
      | { technicians?: string[]; counts?: number[] }
      | undefined
    const techs = ji?.technicians || []
    const counts = ji?.counts || []
    if (!techs.length) return null
    const N = techTopN === 'all' ? techs.length : techTopN
    return {
      type: 'bar' as const,
      data: {
        labels: techs.slice(0, N),
        datasets: [
          {
            label: 'Job items',
            data: counts.slice(0, N),
            backgroundColor: 'rgba(22, 75, 124, 0.75)',
            borderRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: true }, ...noDatalabels },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    }
  }, [techData, techTopN])

  const jobsCompletedChart = useMemo(() => {
    const p = techMetrics?.jobs_completed_by_tech_job_type
    if (!p?.technicians?.length) return null
    const { labels, datasets, jobTotalsByTech } = buildJobsCompletedDatasets(p, techTopN)
    return {
      type: 'bar' as const,
      data: { labels, datasets },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'top' as const },
          ...noDatalabels,
          tooltip: {
            mode: 'index' as const,
            intersect: false,
            callbacks: {
              title: (items: { label: string; dataIndex: number }[]) => {
                const tech = items[0]?.label
                const i = items[0]?.dataIndex
                const total = i != null ? jobTotalsByTech[i] : ''
                return `${tech} (total jobs: ${total})`
              },
            },
          },
        },
        scales: {
          y: { beginAtZero: true, title: { display: true, text: 'Jobs' } },
          y1: {
            position: 'right' as const,
            beginAtZero: true,
            grid: { drawOnChartArea: false },
            title: { display: true, text: 'Total' },
          },
        },
      },
    }
  }, [techMetrics, techTopN])

  const defsTechChart = useMemo(() => {
    const p = techData?.deficiencies_by_tech_service_line as
      | Parameters<typeof buildDefsByTechDatasets>[0]
      | undefined
    if (!p?.technicians?.length) return null
    const { labels, datasets, defTotalsByTech } = buildDefsByTechDatasets(p, techTopN)
    return {
      data: { labels, datasets },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'top' as const },
          ...noDatalabels,
          tooltip: {
            mode: 'index' as const,
            intersect: false,
            callbacks: {
              title: (items: { label: string; dataIndex: number }[]) => {
                const tech = items[0]?.label
                const i = items[0]?.dataIndex
                const total = i != null ? defTotalsByTech[i] : ''
                return `${tech} (total defs: ${total})`
              },
            },
          },
        },
        scales: {
          y: { beginAtZero: true, title: { display: true, text: 'Deficiencies' } },
          y1: {
            position: 'right' as const,
            beginAtZero: true,
            grid: { drawOnChartArea: false },
            title: { display: true, text: 'Total' },
          },
        },
      },
    }
  }, [techData, techTopN])

  const attachmentsChart = useMemo(() => {
    const attachments = techData?.attachments_by_tech as
      | { technician: string; count: number }[]
      | undefined
    if (!attachments?.length) return null
    const sorted = [...attachments].sort((a, b) => b.count - a.count)
    const N = techTopN === 'all' ? sorted.length : techTopN
    const top = sorted.slice(0, N)
    return {
      type: 'bar' as const,
      data: {
        labels: top.map((d) => d.technician),
        datasets: [
          {
            label: 'Attachments',
            data: top.map((d) => d.count),
            backgroundColor: '#8eb0d6',
            borderRadius: 6,
          },
        ],
      },
      options: {
        indexAxis: 'y' as const,
        responsive: true,
        plugins: { legend: { display: false }, ...noDatalabels },
        scales: {
          x: { beginAtZero: true, title: { display: true, text: 'Attachments' } },
        },
      },
    }
  }, [techData, techTopN])

  return { revenueChart, jobItemsChart, jobsCompletedChart, defsTechChart, attachmentsChart }
}
