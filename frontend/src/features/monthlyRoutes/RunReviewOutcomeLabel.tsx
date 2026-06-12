import { OverlayTrigger, Tooltip } from 'react-bootstrap'

import type { TechnicianWorksheetLocation } from './monthlyRoutesShared'
import { runReviewOutcomeIconKind, runReviewSkippedTechNote } from './officeRunReviewShared'

const ICON_CLASS: Record<
  NonNullable<ReturnType<typeof runReviewOutcomeIconKind>>,
  string
> = {
  all_good: 'bi bi-check-lg run-review-outcome-icon run-review-outcome-icon--all-good',
  failed: 'bi bi-x-lg run-review-outcome-icon run-review-outcome-icon--failed',
  passed_with_problems:
    'bi bi-exclamation-triangle-fill run-review-outcome-icon run-review-outcome-icon--passed-problems',
  annual: 'bi bi-building run-review-outcome-icon run-review-outcome-icon--annual',
  on_hold: 'bi bi-pause-circle-fill run-review-outcome-icon run-review-outcome-icon--annual',
  skipped: 'bi bi-skip-forward-fill run-review-outcome-icon run-review-outcome-icon--skipped',
}

const ICON_CLASS_SOLID: Record<
  NonNullable<ReturnType<typeof runReviewOutcomeIconKind>>,
  string
> = {
  all_good: 'bi bi-check-lg run-review-outcome-icon run-review-outcome-icon--solid',
  failed: 'bi bi-x-lg run-review-outcome-icon run-review-outcome-icon--solid',
  passed_with_problems:
    'bi bi-exclamation-triangle-fill run-review-outcome-icon run-review-outcome-icon--solid',
  annual: 'bi bi-building run-review-outcome-icon run-review-outcome-icon--solid',
  on_hold: 'bi bi-pause-circle-fill run-review-outcome-icon run-review-outcome-icon--solid',
  skipped: 'bi bi-skip-forward-fill run-review-outcome-icon run-review-outcome-icon--skipped',
}

type Props = {
  stop: TechnicianWorksheetLocation
  monthDate: string
  headline: string
  badgeClass: string
  className?: string
  variant?: 'soft' | 'solid' | 'review-pill'
}

export function RunReviewOutcomeIcon({
  stop,
  monthDate,
  solid = false,
}: {
  stop: TechnicianWorksheetLocation
  monthDate: string
  solid?: boolean
}) {
  const kind = runReviewOutcomeIconKind(stop, monthDate)
  if (!kind) return null
  return <i className={solid ? ICON_CLASS_SOLID[kind] : ICON_CLASS[kind]} aria-hidden />
}

export default function RunReviewOutcomeLabel({
  stop,
  monthDate,
  headline,
  badgeClass,
  className = '',
  variant = 'soft',
}: Props) {
  const iconKind = runReviewOutcomeIconKind(stop, monthDate)
  if (variant === 'review-pill') {
    const skipNote = runReviewSkippedTechNote(stop)
    const pill = (
      <span
        className={`run-review-outcome-label run-details-review-outcome-pill${skipNote ? ' run-details-review-outcome-pill--has-skip-note' : ''}${className ? ` ${className}` : ''}`}
      >
        {iconKind ? <i className={ICON_CLASS[iconKind]} aria-hidden /> : null}
        <span className="run-review-outcome-label__text">{headline}</span>
      </span>
    )
    if (!skipNote) return pill

    const tooltipId = `run-review-skip-note-${stop.location_id}-${stop.stop_number}`
    return (
      <OverlayTrigger
        placement="top"
        delay={{ show: 300, hide: 100 }}
        overlay={<Tooltip id={tooltipId}>{skipNote}</Tooltip>}
      >
        <span className="run-details-review-outcome-pill-tooltip-target" tabIndex={0}>
          {pill}
        </span>
      </OverlayTrigger>
    )
  }
  if (variant === 'solid') {
    return (
      <span
        className={`run-review-outcome-label run-review-outcome-label--solid${className ? ` ${className}` : ''}`}
      >
        {iconKind ? <i className={ICON_CLASS_SOLID[iconKind]} aria-hidden /> : null}
        <span className="run-review-outcome-label__text">{headline}</span>
      </span>
    )
  }
  return (
    <span
      className={`run-review-outcome-label run-detail-site-card__badge ${badgeClass}${className ? ` ${className}` : ''}`}
    >
      {iconKind ? <i className={ICON_CLASS[iconKind]} aria-hidden /> : null}
      <span className="run-review-outcome-label__text">{headline}</span>
    </span>
  )
}
