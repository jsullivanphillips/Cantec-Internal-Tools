import { OverlayTrigger, Tooltip } from 'react-bootstrap'

import type { MonthlyRunDetailLocation } from './monthlyRoutesShared'
import { priorMonthFieldEditsHint } from './runDetailsLocationReview'

export default function RunDetailsPreparePriorMonthEditsPill({
  location,
}: {
  location: Pick<
    MonthlyRunDetailLocation,
    'location_id' | 'prior_month_field_edits' | 'prior_month_edited_fields'
  >
}) {
  const hint = priorMonthFieldEditsHint(location)
  if (!hint) return null

  const pill = (
    <span className="badge bg-light text-dark border mt-1 d-block run-details-prep-badge run-details-prep-badge--prior-edits">
      <span className="run-details-prep-badge__body">
        <span className="run-details-prep-badge__title">{hint.title}</span>
        <span className="run-details-prep-badge__detail">{hint.detail}</span>
      </span>
    </span>
  )

  return (
    <OverlayTrigger
      placement="top"
      delay={{ show: 300, hide: 100 }}
      overlay={<Tooltip id={`prep-prior-edits-${location.location_id}`}>{hint.tooltip}</Tooltip>}
    >
      <span className="run-details-prep-badge-tooltip-target" tabIndex={0}>
        {pill}
      </span>
    </OverlayTrigger>
  )
}
