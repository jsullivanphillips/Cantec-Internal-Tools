import type { RunReviewSummary } from './notableStopChanges'
import type { RunLocationReviewFilter } from './runDetailsLocationReview'

const FILTER_OPTIONS: {
  filter: RunLocationReviewFilter
  countKey: keyof RunReviewSummary | 'needsAttention' | 'billingUnset' | null
}[] = [
  { filter: 'all', countKey: null },
  { filter: 'needs_attention', countKey: 'needsAttention' },
  { filter: 'billing_unset', countKey: 'billingUnset' },
  { filter: 'all_good', countKey: 'allGoodCount' },
  { filter: 'passed_with_problems', countKey: 'passedWithProblemsCount' },
  { filter: 'failed', countKey: 'failedCount' },
  { filter: 'skipped', countKey: 'skippedCount' },
  { filter: 'updated', countKey: 'updatedCount' },
]

const FILTER_LABELS: Record<RunLocationReviewFilter, string> = {
  all: 'All',
  needs_attention: 'Needs attention',
  billing_unset: 'Billing unset',
  all_good: 'All good',
  passed_with_problems: 'Passed w/ problems',
  failed: 'Failed',
  skipped: 'Skipped',
  updated: 'Updated',
}

export default function RunDetailsLocationFilterBar({
  filter,
  onFilterChange,
  summary,
  needsAttentionCount,
  billingUnsetCount,
  showBillingFilters = true,
}: {
  filter: RunLocationReviewFilter
  onFilterChange: (filter: RunLocationReviewFilter) => void
  summary: RunReviewSummary
  needsAttentionCount: number
  billingUnsetCount: number
  /** Hide billing-unset filter while field work is still open. */
  showBillingFilters?: boolean
}) {
  const options = showBillingFilters
    ? FILTER_OPTIONS
    : FILTER_OPTIONS.filter((opt) => opt.filter !== 'billing_unset')
  function countFor(opt: (typeof FILTER_OPTIONS)[number]): number | null {
    if (opt.countKey === 'needsAttention') return needsAttentionCount
    if (opt.countKey === 'billingUnset') return billingUnsetCount
    if (!opt.countKey) return null
    return summary[opt.countKey]
  }

  return (
    <div className="run-review-filter" role="tablist" aria-label="Filter locations on this run">
      {options.map((opt) => {
        const count = countFor(opt)
        const label =
          count != null && count > 0
            ? `${FILTER_LABELS[opt.filter]} (${count})`
            : FILTER_LABELS[opt.filter]
        return (
          <button
            key={opt.filter}
            type="button"
            role="tab"
            aria-selected={filter === opt.filter}
            className={`run-review-filter__btn${filter === opt.filter ? ' run-review-filter__btn--active' : ''}`}
            onClick={() => onFilterChange(opt.filter)}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
