import type { RunReviewSummary } from './notableStopChanges'
import type { RunLocationReviewFilter } from './runDetailsLocationReview'

const FILTER_OPTIONS: {
  filter: RunLocationReviewFilter
  countKey: keyof RunReviewSummary | 'needsAttention' | 'billingUnset' | 'submittedCount' | null
}[] = [
  { filter: 'all', countKey: null },
  { filter: 'submitted', countKey: 'submittedCount' },
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
  submitted: 'Submitted',
  needs_attention: 'Needs attention',
  billing_unset: 'Billing unset',
  no_test_result: 'No test result',
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
  submittedCount,
  showBillingFilters = true,
  showSubmittedFilter = false,
}: {
  filter: RunLocationReviewFilter
  onFilterChange: (filter: RunLocationReviewFilter) => void
  summary: RunReviewSummary
  needsAttentionCount: number
  billingUnsetCount: number
  submittedCount: number
  /** Hide billing-unset filter while field work is still open. */
  showBillingFilters?: boolean
  /** Show submitted filter while technicians are actively logging. */
  showSubmittedFilter?: boolean
}) {
  const options = FILTER_OPTIONS.filter((opt) => {
    if (opt.filter === 'billing_unset' && !showBillingFilters) return false
    if (opt.filter === 'submitted' && !showSubmittedFilter) return false
    return true
  })
  function countFor(opt: (typeof FILTER_OPTIONS)[number]): number | null {
    if (opt.countKey === 'needsAttention') return needsAttentionCount
    if (opt.countKey === 'billingUnset') return billingUnsetCount
    if (opt.countKey === 'submittedCount') return submittedCount
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
