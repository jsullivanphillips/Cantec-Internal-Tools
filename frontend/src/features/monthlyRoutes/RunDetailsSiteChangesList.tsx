import { useMemo } from 'react'
import type { TechnicianWorksheetStop } from './monthlyRoutesShared'
import { buildNotableStopChangeCards } from './notableStopChanges'
import type { OfficeFieldChange } from './officeWorksheetTableShared'
import RunDetailsSiteChangeCard from './RunDetailsSiteChangeCard'

export default function RunDetailsSiteChangesList({
  stops,
  monthDate,
  fieldChangesByLocation,
}: {
  stops: TechnicianWorksheetStop[]
  monthDate: string
  fieldChangesByLocation?: Map<number, OfficeFieldChange[]>
}) {
  const cards = useMemo(
    () => buildNotableStopChangeCards(stops, monthDate, fieldChangesByLocation),
    [stops, monthDate, fieldChangesByLocation],
  )

  const { changeCount, withUpdatesCount, testedOnlyCount } = useMemo(() => {
    let changes = 0
    let withUpdates = 0
    let testedOnly = 0
    for (const card of cards) {
      changes += card.changes.length
      if (card.reviewKind === 'tested_only') testedOnly += 1
      else if (card.changes.length > 0) withUpdates += 1
    }
    return { changeCount: changes, withUpdatesCount: withUpdates, testedOnlyCount: testedOnly }
  }, [cards])

  const summaryParts: string[] = []
  if (withUpdatesCount > 0) {
    summaryParts.push(
      withUpdatesCount === 1 ? '1 site with updates' : `${withUpdatesCount} sites with updates`,
    )
  }
  if (testedOnlyCount > 0) {
    summaryParts.push(
      testedOnlyCount === 1 ? '1 tested (no edits)' : `${testedOnlyCount} tested (no edits)`,
    )
  }

  return (
    <div className="monthly-run-detail-changes">
      {summaryParts.length > 0 ? (
        <p className="monthly-run-detail-changes__summary text-muted small">
          {summaryParts.join(' · ')}
          {changeCount > 0
            ? ` · ${changeCount === 1 ? '1 change' : `${changeCount} changes`}`
            : null}
        </p>
      ) : null}
      <ul className="monthly-run-detail-changes__list list-unstyled mb-0">
        {cards.map((card) => (
          <li key={`${card.locationId}:${card.stop.testing_site_id}`}>
            <RunDetailsSiteChangeCard card={card} />
          </li>
        ))}
      </ul>
    </div>
  )
}
