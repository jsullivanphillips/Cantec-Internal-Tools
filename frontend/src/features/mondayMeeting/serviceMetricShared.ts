import type { DeficiencyPipelineMetrics } from './serviceMetricsTypes'

export const ALL_QUOTES_TOOLTIP =
  'All quotes created in the selected quarter, including inspection and standalone quotes (not tied to deficiencies).'

export const DEFICIENCY_COHORT_TOOLTIP =
  'Based on deficiencies reported in the selected quarter. Quote, approval, and job steps count whenever they happened.'

export const PIPELINE_EXCLUSION_TOOLTIP =
  'Deficiency counts exclude record-only items that match keyword phrases (e.g. fire safety plan, monitoring company).'

export const DEFICIENCIES_REPAIRED_TOOLTIP =
  'Tracks deficiency repairs completed for deficiencies reported in the selected quarter.'

export const SERVICE_CHART_COLORS = {
  good: '#16a34a',
  goodMuted: 'rgba(22, 163, 74, 0.65)',
  warn: '#d97706',
  warnMuted: 'rgba(217, 119, 6, 0.65)',
  danger: '#dc2626',
  dangerMuted: 'rgba(220, 38, 38, 0.65)',
  neutral: '#94a3b8',
  neutralMuted: 'rgba(148, 163, 184, 0.55)',
  navy: '#164b7c',
  funnel: ['#164b7c', '#1d5f99', '#2b7ab8', '#4a9ad4', '#16a34a'] as const,
}

export function formatExclusionSubline(pipeline: DeficiencyPipelineMetrics | undefined): string | null {
  const excluded = pipeline?.excluded_non_quoteable ?? 0
  if (excluded <= 0) return null
  return `${excluded} excluded as non-quotable`
}

export function formatPct(value: number): string {
  if (!Number.isFinite(value)) return '0'
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1)
}

/** Avoid fuzzy Chart.js text on fractional Windows display scaling (125%, 150%). */
export function serviceChartDevicePixelRatio(): number {
  if (typeof globalThis.window === 'undefined') return 2
  return Math.min(Math.max(globalThis.window.devicePixelRatio || 1, 2), 3)
}

export const SERVICE_CHART_FONT_FAMILY =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
