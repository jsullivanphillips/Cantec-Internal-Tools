export type PortalRunSummaryOutcomes = {
  tested: number
  skipped_annual: number
  skipped_non_annual: number
}

export type PortalRunSummaryComparisonDirection = 'early' | 'late' | 'on_time'

export type PortalRunSummaryComparison = {
  delta_minutes: number
  direction: PortalRunSummaryComparisonDirection
  months_sampled: number
  typical_minutes?: number
  typical_end_time?: string
}

export type PortalRunSummary = {
  outcomes: PortalRunSummaryOutcomes
  field_duration_minutes: number | null
  field_end_time: string | null
  annual_minutes_per_skip: number
  comparisons: {
    field_duration?: PortalRunSummaryComparison
    finish_time?: PortalRunSummaryComparison
  }
  has_sufficient_history: boolean
}

export function formatFieldDuration(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return '—'
  const rounded = Math.max(0, Math.round(minutes))
  const h = Math.floor(rounded / 60)
  const m = rounded % 60
  if (h <= 0) return `${m} min`
  if (m === 0) return `${h} hr`
  return `${h} hr ${m} min`
}

export function comparisonHeadline(
  comparison: PortalRunSummaryComparison,
  kind: 'field_duration' | 'finish_time',
): string {
  if (comparison.direction === 'on_time') {
    return kind === 'field_duration'
      ? 'Right on pace for this route'
      : 'Finished around the usual time for this route'
  }
  const absDelta = Math.abs(comparison.delta_minutes)
  if (kind === 'finish_time') {
    const word = comparison.direction === 'early' ? 'earlier' : 'later'
    return `${absDelta} min ${word} than usual for this route`
  }
  const word = comparison.direction === 'early' ? 'faster' : 'slower'
  return `${absDelta} min ${word} than usual for this route`
}

export function comparisonTone(
  direction: PortalRunSummaryComparisonDirection,
): 'positive' | 'negative' | 'neutral' {
  if (direction === 'early') return 'positive'
  if (direction === 'late') return 'negative'
  return 'neutral'
}
