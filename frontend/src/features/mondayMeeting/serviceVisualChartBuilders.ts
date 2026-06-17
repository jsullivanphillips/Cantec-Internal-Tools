import type { ChartData, ChartOptions } from 'chart.js'
import type { ScheduledWithinSlaGoal } from './ScheduledWithinSlaGoalTile'
import { SERVICE_CHART_COLORS, SERVICE_CHART_FONT_FAMILY, serviceChartDevicePixelRatio } from './serviceMetricShared'
import type { DeficienciesRepairedGoal, DeficiencyPipelineMetrics } from './serviceMetricsTypes'
import type { SlaModalView } from './ScheduledWithinSlaGoalTile'

export type FunnelStage = {
  key: string
  label: string
  count: number
  pctOfReported: number
  stepConversionPct: number | null
}

export type RepairedDoughnutSlices = {
  repaired: number
  notRepaired: number
  actualPct: number
  targetPct: number
  meetingGoal: boolean
  empty: boolean
}

export type SlaBucketSegment = {
  key: SlaModalView
  label: string
  count: number
  color: string
}

const DOUGHNUT_BASE_OPTIONS: ChartOptions<'doughnut'> = {
  responsive: true,
  maintainAspectRatio: false,
  devicePixelRatio: serviceChartDevicePixelRatio(),
  cutout: '68%',
  plugins: {
    legend: { display: false },
    datalabels: { display: false },
    tooltip: {
      callbacks: {
        label: (ctx) => {
          const value = typeof ctx.parsed === 'number' ? ctx.parsed : 0
          const total = ctx.dataset.data.reduce((sum, n) => sum + (typeof n === 'number' ? n : 0), 0)
          const pct = total > 0 ? Math.round((value / total) * 1000) / 10 : 0
          return `${ctx.label}: ${value} (${pct}%)`
        },
      },
    },
  },
}

export function getRepairedDoughnutSlices(goal: DeficienciesRepairedGoal | undefined): RepairedDoughnutSlices {
  const repaired = goal?.repaired_count ?? 0
  const total = goal?.total_deficiencies ?? 0
  const notRepaired = Math.max(0, total - repaired)
  return {
    repaired,
    notRepaired,
    actualPct: goal?.actual_pct ?? 0,
    targetPct: goal?.target_pct ?? 35,
    meetingGoal: goal?.meeting_goal ?? false,
    empty: total <= 0,
  }
}

export function buildRepairedDoughnutChart(goal: DeficienciesRepairedGoal | undefined): {
  data: ChartData<'doughnut'>
  options: ChartOptions<'doughnut'>
  slices: RepairedDoughnutSlices
} {
  const slices = getRepairedDoughnutSlices(goal)
  return {
    slices,
    data: {
      labels: ['Repaired', 'Not yet repaired'],
      datasets: [
        {
          data: [slices.repaired, slices.notRepaired],
          backgroundColor: [SERVICE_CHART_COLORS.good, SERVICE_CHART_COLORS.neutralMuted],
          borderWidth: 0,
        },
      ],
    },
    options: DOUGHNUT_BASE_OPTIONS,
  }
}

export function buildSlaSchedulingDoughnutChart(slaGoal: ScheduledWithinSlaGoal | undefined): {
  data: ChartData<'doughnut'>
  options: ChartOptions<'doughnut'>
  withinSla: number
  outsideSla: number
  actualPct: number
  targetPct: number
  meetingGoal: boolean
  empty: boolean
  modalKeys: SlaModalView[]
} {
  const withinSla = slaGoal?.within_sla_count ?? 0
  const denominator = slaGoal?.denominator_count ?? slaGoal?.eligible_count ?? 0
  const outsideSla = Math.max(0, denominator - withinSla)
  const empty = denominator <= 0

  return {
    withinSla,
    outsideSla,
    actualPct: slaGoal?.actual_pct ?? 0,
    targetPct: slaGoal?.target_pct ?? 100,
    meetingGoal: slaGoal?.meeting_goal ?? false,
    empty,
    modalKeys: ['met', 'over'],
    data: {
      labels: ['Within SLA', 'Over SLA'],
      datasets: [
        {
          data: [withinSla, outsideSla],
          backgroundColor: [SERVICE_CHART_COLORS.good, SERVICE_CHART_COLORS.dangerMuted],
          borderWidth: 0,
        },
      ],
    },
    options: DOUGHNUT_BASE_OPTIONS,
  }
}

export function getFunnelStages(
  pipeline: DeficiencyPipelineMetrics | undefined,
  repairedCount: number,
): FunnelStage[] {
  const stages = [
    { key: 'reported', label: 'Reported', count: pipeline?.total ?? 0 },
    { key: 'quoted', label: 'Quoted', count: pipeline?.quoted ?? 0 },
    { key: 'approved', label: 'Approved', count: pipeline?.approved_of_quoted ?? 0 },
    { key: 'job_assigned', label: 'Job assigned', count: pipeline?.approved_with_job ?? 0 },
    { key: 'repaired', label: 'Repaired', count: repairedCount },
  ]
  const reported = stages[0]?.count ?? 0

  return stages.map((stage, index) => {
    const prev = index > 0 ? (stages[index - 1]?.count ?? 0) : null
    return {
      ...stage,
      pctOfReported: reported > 0 ? Math.round((stage.count / reported) * 1000) / 10 : 0,
      stepConversionPct:
        prev != null && prev > 0 ? Math.round((stage.count / prev) * 1000) / 10 : index === 0 ? 100 : null,
    }
  })
}

export function buildDeficiencyFunnelChart(
  pipeline: DeficiencyPipelineMetrics | undefined,
  repairedCount: number,
): {
  data: ChartData<'bar'>
  options: ChartOptions<'bar'>
  stages: FunnelStage[]
  empty: boolean
} {
  const stages = getFunnelStages(pipeline, repairedCount)
  const empty = (pipeline?.total ?? 0) <= 0

  return {
    stages,
    empty,
    data: {
      labels: stages.map((s) => s.label),
      datasets: [
        {
          label: 'Deficiencies',
          data: stages.map((s) => s.count),
          backgroundColor: [...SERVICE_CHART_COLORS.funnel],
          borderRadius: 6,
          borderSkipped: false,
        },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      devicePixelRatio: serviceChartDevicePixelRatio(),
      plugins: {
        legend: { display: false },
        datalabels: {
          anchor: 'end',
          align: 'end',
          color: '#334155',
          font: {
            size: 12,
            weight: 600,
            family: SERVICE_CHART_FONT_FAMILY,
          },
          formatter: (_value, ctx) => {
            const stage = stages[ctx.dataIndex]
            if (!stage) return ''
            const step =
              stage.stepConversionPct != null && ctx.dataIndex > 0
                ? ` · ${stage.stepConversionPct}% step`
                : ''
            return `${stage.count} (${stage.pctOfReported}% of reported${step})`
          },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const stage = stages[ctx.dataIndex]
              if (!stage) return ''
              const lines = [`${stage.count} deficiencies`, `${stage.pctOfReported}% of reported`]
              if (stage.stepConversionPct != null && ctx.dataIndex > 0) {
                lines.push(`${stage.stepConversionPct}% from prior stage`)
              }
              return lines
            },
          },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          grid: { color: 'rgba(148, 163, 184, 0.2)' },
          ticks: { precision: 0 },
        },
        y: {
          grid: { display: false },
        },
      },
    },
  }
}

export function getSlaBucketSegments(slaGoal: ScheduledWithinSlaGoal | undefined): {
  scheduled: SlaBucketSegment[]
  approvedQuotes: SlaBucketSegment[]
} {
  const eligibleJobs = slaGoal?.eligible_jobs ?? slaGoal?.within_sla_jobs ?? []
  const withinSla = eligibleJobs.filter((row) => row.within_sla).length
  const outsideSla = eligibleJobs.filter((row) => !row.within_sla).length

  return {
    scheduled: [
      { key: 'met', label: 'Met SLA', count: withinSla, color: SERVICE_CHART_COLORS.good },
      { key: 'over', label: 'Over SLA', count: outsideSla, color: SERVICE_CHART_COLORS.danger },
    ],
    approvedQuotes: [
      {
        key: 'unscheduledUnderSla',
        label: 'Unscheduled under SLA',
        count: slaGoal?.unscheduled_under_sla_jobs?.length ?? 0,
        color: SERVICE_CHART_COLORS.warn,
      },
      {
        key: 'awaitingJobUnderSla',
        label: 'Awaiting job under SLA',
        count: slaGoal?.awaiting_job_under_sla_jobs?.length ?? 0,
        color: SERVICE_CHART_COLORS.warnMuted,
      },
      {
        key: 'unscheduledOverSla',
        label: 'Unscheduled over SLA',
        count: slaGoal?.unscheduled_over_sla_jobs?.length ?? 0,
        color: SERVICE_CHART_COLORS.dangerMuted,
      },
      {
        key: 'awaitingJobOverSla',
        label: 'Awaiting job over SLA',
        count: slaGoal?.awaiting_job_over_sla_jobs?.length ?? 0,
        color: SERVICE_CHART_COLORS.danger,
      },
    ],
  }
}

function buildSingleStackedBarChart(
  segments: SlaBucketSegment[],
  title: string,
): { data: ChartData<'bar'>; options: ChartOptions<'bar'>; segments: SlaBucketSegment[]; empty: boolean } {
  const total = segments.reduce((sum, s) => sum + s.count, 0)
  const empty = total <= 0

  return {
    segments,
    empty,
    data: {
      labels: [title],
      datasets: segments.map((segment) => ({
        label: segment.label,
        data: [segment.count],
        backgroundColor: segment.color,
        borderRadius: 4,
        borderSkipped: false,
      })),
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      devicePixelRatio: serviceChartDevicePixelRatio(),
      layout: {
        padding: { top: 4, bottom: 4, left: 0, right: 8 },
      },
      plugins: {
        legend: { display: false },
        datalabels: {
          display: (ctx) => {
            const raw = ctx.dataset.data[ctx.dataIndex]
            const value = typeof raw === 'number' ? raw : 0
            return value > 0
          },
          color: '#fff',
          font: {
            size: 12,
            weight: 700,
            family: SERVICE_CHART_FONT_FAMILY,
          },
          formatter: (value) => (typeof value === 'number' && value > 0 ? String(value) : ''),
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.x ?? 0}`,
          },
        },
      },
      scales: {
        x: { stacked: true, beginAtZero: true, display: false },
        y: { stacked: true, grid: { display: false }, ticks: { display: false } },
      },
    },
  }
}

export function buildScheduledBucketsStackedBar(slaGoal: ScheduledWithinSlaGoal | undefined) {
  const { scheduled } = getSlaBucketSegments(slaGoal)
  return buildSingleStackedBarChart(scheduled, 'Scheduled repair quotes')
}

export function buildApprovedQuotesBucketsStackedBar(slaGoal: ScheduledWithinSlaGoal | undefined) {
  const { approvedQuotes } = getSlaBucketSegments(slaGoal)
  return buildSingleStackedBarChart(approvedQuotes, 'Approved quotes')
}
