import type { RunReviewFilter, RunReviewSummary } from './notableStopChanges'

const FILTER_OPTIONS: {
  filter: RunReviewFilter
  countKey: keyof RunReviewSummary | null
}[] = [
  { filter: 'all', countKey: 'stopCount' },
  { filter: 'all_good', countKey: 'allGoodCount' },
  { filter: 'passed_with_problems', countKey: 'passedWithProblemsCount' },
  { filter: 'failed', countKey: 'failedCount' },
  { filter: 'skipped', countKey: 'skippedCount' },
  { filter: 'updated', countKey: 'updatedCount' },
]

const FILTER_LABELS: Record<RunReviewFilter, string> = {
  all: 'All',
  all_good: 'All good',
  passed_with_problems: 'Passed w/ problems',
  failed: 'Failed',
  skipped: 'Skipped',
  updated: 'Updated',
}

function filterLabel(filter: RunReviewFilter, summary: RunReviewSummary): string {
  const base = FILTER_LABELS[filter]
  const opt = FILTER_OPTIONS.find((o) => o.filter === filter)
  if (!opt?.countKey || opt.countKey === 'stopCount') return base
  const count = summary[opt.countKey]
  if (typeof count === 'number' && count > 0) return `${base} (${count})`
  return base
}

export default function RunReviewFilterBar({
  filter,
  onFilterChange,
  summary,
}: {
  filter: RunReviewFilter
  onFilterChange: (filter: RunReviewFilter) => void
  summary: RunReviewSummary
}) {
  return (
    <div className="run-review-filter" role="tablist" aria-label="Filter run review stops">
      {FILTER_OPTIONS.map((opt) => (
        <button
          key={opt.filter}
          type="button"
          role="tab"
          aria-selected={filter === opt.filter}
          className={`run-review-filter__btn${filter === opt.filter ? ' run-review-filter__btn--active' : ''}`}
          onClick={() => onFilterChange(opt.filter)}
        >
          {filterLabel(opt.filter, summary)}
        </button>
      ))}
    </div>
  )
}
