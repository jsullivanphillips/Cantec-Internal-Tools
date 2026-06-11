import type { TechnicianWorksheetLocation } from './monthlyRoutesShared'
import { runReviewOutcomeIconKind } from './officeRunReviewShared'

const ICON_CLASS: Record<
  NonNullable<ReturnType<typeof runReviewOutcomeIconKind>>,
  string
> = {
  all_good: 'bi bi-check-lg run-review-outcome-icon run-review-outcome-icon--all-good',
  failed: 'bi bi-x-lg run-review-outcome-icon run-review-outcome-icon--failed',
  passed_with_problems:
    'bi bi-exclamation-triangle-fill run-review-outcome-icon run-review-outcome-icon--passed-problems',
  annual: 'bi bi-building run-review-outcome-icon run-review-outcome-icon--annual',
}

type Props = {
  stop: TechnicianWorksheetLocation
  monthDate: string
  headline: string
  badgeClass: string
  className?: string
}

export function RunReviewOutcomeIcon({
  stop,
  monthDate,
}: {
  stop: TechnicianWorksheetLocation
  monthDate: string
}) {
  const kind = runReviewOutcomeIconKind(stop, monthDate)
  if (!kind) return null
  return <i className={ICON_CLASS[kind]} aria-hidden />
}

export default function RunReviewOutcomeLabel({
  stop,
  monthDate,
  headline,
  badgeClass,
  className = '',
}: Props) {
  const iconKind = runReviewOutcomeIconKind(stop, monthDate)
  return (
    <span
      className={`run-review-outcome-label run-detail-site-card__badge ${badgeClass}${className ? ` ${className}` : ''}`}
    >
      {iconKind ? <i className={ICON_CLASS[iconKind]} aria-hidden /> : null}
      <span className="run-review-outcome-label__text">{headline}</span>
    </span>
  )
}
