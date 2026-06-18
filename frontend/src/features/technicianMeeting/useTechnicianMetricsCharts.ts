import { useMemo } from 'react'
import { coerceUiText } from '../../lib/apiClient'
import {
  aggregateDeficiencyCountsByTech,
  compactCartesianScales,
  horizontalBarChartHeight,
  noDatalabels,
  technicianBarChartBaseOptions,
  topTechCountsFromRecord,
  type TopN,
  verticalBarChartHeight,
} from './technicianMetricsCharts'

type SimpleBarChart = {
  type: 'bar'
  height: number
  data: {
    labels: string[]
    datasets: {
      label: string
      data: number[]
      backgroundColor: string
      borderRadius: number
    }[]
  }
  options: ReturnType<typeof buildSimpleVerticalBarOptions>
}

function buildSimpleVerticalBarOptions() {
  const scales = compactCartesianScales()
  return {
    ...technicianBarChartBaseOptions(),
    plugins: { legend: { display: false }, ...noDatalabels },
    scales: {
      ...scales,
      y: {
        ...scales.y,
        beginAtZero: true,
      },
    },
  }
}

function buildSimpleVerticalBarChart(
  labels: string[],
  counts: number[],
  datasetLabel: string,
  backgroundColor: string,
): SimpleBarChart | null {
  if (!labels.length) return null
  return {
    type: 'bar',
    height: verticalBarChartHeight(labels.length),
    data: {
      labels,
      datasets: [
        {
          label: datasetLabel,
          data: counts,
          backgroundColor,
          borderRadius: 4,
        },
      ],
    },
    options: buildSimpleVerticalBarOptions(),
  }
}

export function useTechnicianMetricsCharts(
  techData: Record<string, unknown> | null,
  techTopN: TopN,
) {
  const techMetrics = techData?.technician_metrics as
    | {
        jobs_completed_by_tech?: Record<string, number>
      }
    | undefined

  const jobItemsChart = useMemo(() => {
    const ji = techData?.job_items_created_by_tech as
      | { technicians?: string[]; counts?: number[] }
      | undefined
    const techs = (ji?.technicians || [])
      .map((name) => coerceUiText(name, ''))
      .filter(Boolean)
    const counts = ji?.counts || []
    if (!techs.length) return null
    const N = techTopN === 'all' ? techs.length : techTopN
    return buildSimpleVerticalBarChart(
      techs.slice(0, N),
      counts.slice(0, N),
      'Job items',
      'rgba(22, 75, 124, 0.75)',
    )
  }, [techData, techTopN])

  const jobsCompletedChart = useMemo(() => {
    const jobs = techMetrics?.jobs_completed_by_tech
    if (!jobs || !Object.keys(jobs).length) return null
    const { labels, counts } = topTechCountsFromRecord(jobs, techTopN)
    return buildSimpleVerticalBarChart(labels, counts, 'Jobs completed', 'rgba(89, 161, 79, 0.75)')
  }, [techMetrics, techTopN])

  const defsCreatedChart = useMemo(() => {
    const payload = techData?.deficiencies_by_tech_service_line as
      | { entries?: { technician: string; count: number }[] }
      | undefined
    const entries = payload?.entries || []
    if (!entries.length) return null
    const { labels, counts } = aggregateDeficiencyCountsByTech(entries, techTopN)
    return buildSimpleVerticalBarChart(labels, counts, 'Deficiencies', 'rgba(22, 75, 124, 0.75)')
  }, [techData, techTopN])

  const attachmentsChart = useMemo(() => {
    const attachments = techData?.attachments_by_tech as
      | { technician: string; count: number }[]
      | undefined
    if (!attachments?.length) return null
    const sorted = [...attachments].sort((a, b) => b.count - a.count)
    const N = techTopN === 'all' ? sorted.length : techTopN
    const top = sorted.slice(0, N)
    const barCount = top.length
    const scales = compactCartesianScales()
    return {
      type: 'bar' as const,
      height: horizontalBarChartHeight(barCount),
      data: {
        labels: top.map((d) => d.technician),
        datasets: [
          {
            label: 'Attachments',
            data: top.map((d) => d.count),
            backgroundColor: '#8eb0d6',
            borderRadius: 4,
          },
        ],
      },
      options: {
        ...technicianBarChartBaseOptions(),
        indexAxis: 'y' as const,
        plugins: { legend: { display: false }, ...noDatalabels },
        scales: {
          ...scales,
          x: {
            ...scales.x,
            beginAtZero: true,
          },
          y: {
            ...scales.y,
            grid: { display: false },
          },
        },
      },
    }
  }, [techData, techTopN])

  return { jobItemsChart, jobsCompletedChart, defsCreatedChart, attachmentsChart }
}
