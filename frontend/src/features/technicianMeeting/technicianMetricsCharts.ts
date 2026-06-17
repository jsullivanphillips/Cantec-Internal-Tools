import type { ChartOptions } from 'chart.js'

export type TopN = number | 'all'

export const noDatalabels = { datalabels: { display: false } }

export const TECHNICIAN_CHART_FONT_FAMILY =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'

/** Avoid fuzzy Chart.js text on fractional Windows display scaling (125%, 150%). */
export function technicianChartDevicePixelRatio(): number {
  if (typeof globalThis.window === 'undefined') return 2
  return Math.min(Math.max(globalThis.window.devicePixelRatio || 1, 2), 3)
}

const compactTickFont = { size: 10, family: TECHNICIAN_CHART_FONT_FAMILY }
const compactTitleFont = { size: 10, weight: 'bold' as const, family: TECHNICIAN_CHART_FONT_FAMILY }

export function technicianBarChartBaseOptions(): Pick<ChartOptions<'bar'>, 'responsive' | 'maintainAspectRatio' | 'devicePixelRatio' | 'animation'> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    devicePixelRatio: technicianChartDevicePixelRatio(),
    animation: false,
  }
}

export function compactScaleTitle(text: string) {
  return { display: true, text, font: compactTitleFont, padding: { top: 0, bottom: 4 } }
}

export function compactCartesianScales() {
  return {
    x: {
      ticks: { font: compactTickFont, maxRotation: 0, autoSkip: true },
      grid: { color: 'rgba(148, 163, 184, 0.25)' },
    },
    y: {
      ticks: { font: compactTickFont, precision: 0 },
      grid: { color: 'rgba(148, 163, 184, 0.25)' },
    },
  }
}

/** Fixed pixel height prevents responsive resize loops in grid layouts. */
export function horizontalBarChartHeight(barCount: number): number {
  return Math.min(Math.max(132, barCount * 22 + 44), 240)
}

export function verticalBarChartHeight(barCount: number): number {
  return Math.min(Math.max(152, barCount > 10 ? 188 : 168), 208)
}

export function topTechCountsFromRecord(
  record: Record<string, number>,
  topN: TopN,
): { labels: string[]; counts: number[] } {
  const pairs = Object.entries(record).sort((a, b) => b[1] - a[1])
  const limit = topN === 'all' ? pairs.length : topN
  const slice = pairs.slice(0, limit)
  return { labels: slice.map(([label]) => label), counts: slice.map(([, count]) => count) }
}

export function aggregateDeficiencyCountsByTech(
  entries: { technician: string; count: number }[],
  topN: TopN,
): { labels: string[]; counts: number[] } {
  const totals: Record<string, number> = {}
  for (const { technician, count } of entries) {
    totals[technician] = (totals[technician] ?? 0) + count
  }
  return topTechCountsFromRecord(totals, topN)
}

export type TopTechnicianLeader = {
  technician: string
  count: number
}

export function topTechnicianLeader(
  entries: { technician: string; count: number }[],
): TopTechnicianLeader | null {
  if (!entries.length) return null
  const sorted = [...entries].sort((a, b) => b.count - a.count)
  const top = sorted[0]
  if (!top || top.count <= 0) return null
  return top
}

export function topTechnicianFromRecord(record: Record<string, number>): TopTechnicianLeader | null {
  return topTechnicianLeader(
    Object.entries(record).map(([technician, count]) => ({ technician, count })),
  )
}
