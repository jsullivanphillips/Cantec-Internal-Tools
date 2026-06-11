import { useMemo } from 'react'
import RunDetailsSiteChangeCard from './RunDetailsSiteChangeCard'
import RunReviewFilterBar from './RunReviewFilterBar'
import RunReviewTestedOnlyGroup from './RunReviewTestedOnlyGroup'
import type { NotableChangeItem, NotableStopChangeCard, RunReviewFilter, RunReviewSummary } from './notableStopChanges'
import { filterRunReviewCards, partitionRunReviewCards, runReviewStopDomId } from './notableStopChanges'

export default function RunDetailsSiteChangesList({
  cards,
  monthDate,
  summary,
  filter,
  onFilterChange,
  routeId,
  onCardDetailLoaded,
}: {
  cards: NotableStopChangeCard[]
  monthDate: string
  summary: RunReviewSummary
  filter: RunReviewFilter
  onFilterChange: (filter: RunReviewFilter) => void
  routeId: number
  onCardDetailLoaded: (locationId: number, changes: NotableChangeItem[]) => void
}) {
  const filtered = useMemo(
    () => filterRunReviewCards(cards, filter, monthDate),
    [cards, filter, monthDate],
  )

  const { attentionAndStandard, testedOnly } = useMemo(
    () => partitionRunReviewCards(filtered, monthDate),
    [filtered, monthDate],
  )

  const usePartitionedLayout = filter === 'all'

  const flatList = usePartitionedLayout ? attentionAndStandard : filtered

  return (
    <div className="monthly-run-detail-changes">
      <RunReviewFilterBar filter={filter} onFilterChange={onFilterChange} summary={summary} />
      {filtered.length === 0 && cards.length > 0 ? (
        <p className="monthly-run-detail-empty mb-0">No stops match this filter.</p>
      ) : (
        <>
          <ul className="monthly-run-detail-changes__list list-unstyled mb-0">
            {flatList.map((card) => (
              <li
                key={`${card.locationId}:${card.stop.location_id}`}
                id={runReviewStopDomId(card)}
              >
                <RunDetailsSiteChangeCard
                  card={card}
                  routeId={routeId}
                  monthDate={monthDate}
                  onDetailLoaded={onCardDetailLoaded}
                />
              </li>
            ))}
          </ul>
          {usePartitionedLayout && testedOnly.length > 0 ? (
            <RunReviewTestedOnlyGroup
              cards={testedOnly}
              routeId={routeId}
              monthDate={monthDate}
              onCardDetailLoaded={onCardDetailLoaded}
            />
          ) : null}
        </>
      )}
    </div>
  )
}
