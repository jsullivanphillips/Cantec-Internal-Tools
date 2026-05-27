import { Link } from 'react-router-dom'
import FieldChangeBeforeAfter from './FieldChangeBeforeAfter'
import type { NotableStopChangeCard } from './notableStopChanges'
import { runReviewResultHeadlineClass } from './notableStopChanges'

function RunReviewSiteHeader({
  card,
}: {
  card: NotableStopChangeCard
}) {
  const { stopNumber, displayAddress, locationId, siteLabel, siteIndex, siteCount, resultHeadline, stop } =
    card
  const monthDate = stop.month_date
  const resultClass = runReviewResultHeadlineClass(stop, monthDate)

  return (
    <header className="run-detail-site-card__header">
      <div className="run-detail-site-card__header-row">
        <div className="run-detail-site-card__stop tabular-nums" aria-label={`Stop ${stopNumber}`}>
          #{stopNumber}
        </div>
        <div className="run-detail-site-card__identity">
          <Link to={`/monthlies/locations/${locationId}`} className="run-detail-site-card__address">
            {displayAddress}
          </Link>
          {resultHeadline ? (
            <span className={`run-detail-site-card__result ${resultClass}`}>{resultHeadline}</span>
          ) : null}
        </div>
      </div>
      {siteCount > 1 ? (
        <div className="run-detail-site-card__site-meta text-muted small">
          {siteLabel !== 'Primary testing location' ? (
            <>
              <span className="run-detail-site-card__site">{siteLabel}</span>
              <span className="run-detail-site-card__site-sep" aria-hidden>
                {' '}
                ·{' '}
              </span>
            </>
          ) : null}
          Site {siteIndex} of {siteCount} at this address
        </div>
      ) : null}
    </header>
  )
}

export default function RunDetailsSiteChangeCard({ card }: { card: NotableStopChangeCard }) {
  const { changes, reviewKind, stopNumber, displayAddress, resultHeadline } = card
  const compact = reviewKind === 'tested_only' || changes.length === 0

  return (
    <article
      className={`run-detail-site-card monthly-location-detail-surface${compact ? ' run-detail-site-card--compact' : ''}`}
      aria-label={
        resultHeadline
          ? `Stop ${stopNumber}, ${displayAddress}: ${resultHeadline}`
          : `Stop ${stopNumber}, ${displayAddress}`
      }
    >
      <RunReviewSiteHeader card={card} />
      {changes.length > 0 ? (
        <div className="run-detail-site-card__changes">
          {changes.map((item) => (
            <FieldChangeBeforeAfter key={item.id} item={item} />
          ))}
        </div>
      ) : null}
    </article>
  )
}
