type Props = {
  showBilling: boolean
  /** Last column label when only job comments are shown (run review). */
  commentsOnly?: boolean
}

export default function RunDetailsLocationColumnHeader({ showBilling, commentsOnly }: Props) {
  return (
    <div
      className={`run-location-card__layout run-location-card__column-header${
        showBilling ? '' : ' run-location-card__layout--no-billing'
      }`}
      role="row"
      aria-label="Column labels"
    >
      <div
        className="run-location-card__column-header-cell run-location-card__column-header-cell--stop"
        role="columnheader"
      >
        Stop
      </div>
      <div className="run-location-card__column-header-cell" role="columnheader">
        Location &amp; result
      </div>
      {showBilling ? (
        <div className="run-location-card__column-header-cell" role="columnheader">
          Billing
        </div>
      ) : null}
      <div className="run-location-card__column-header-cell" role="columnheader">
        Deficiencies
      </div>
      <div className="run-location-card__column-header-cell" role="columnheader">
        {commentsOnly ? 'Job comments' : 'Follow-up'}
      </div>
    </div>
  )
}
