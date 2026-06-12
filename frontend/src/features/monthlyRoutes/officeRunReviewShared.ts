/** Office run-details review: portal outcomes, billing labels, location grouping. */

import type { TechnicianWorksheetLocation } from './monthlyRoutesShared'
import { officeStopStatus, officeStopStatusLabel } from './officeWorksheetTableShared'
import {
  formatSkipReasonDisplayText,
  OFFICE_OUTCOME_SKIPPED_ANNUAL_LABEL,
  portalOutcomeDisplay,
  skipCategoryLabel,
  type PortalTestOutcome,
} from './portalWorkflowShared'

export type OfficeBillingStatus = 'bill' | 'do_not_bill' | 'unset' | 'legacy'

const PORTAL_OUTCOMES = new Set<PortalTestOutcome>([
  'all_good',
  'passed_with_problems',
  'failed',
  'skipped',
])

function norm(value: string | null | undefined): string {
  return (value ?? '').trim()
}

export function stopPortalOutcome(stop: TechnicianWorksheetLocation): PortalTestOutcome | null {
  const outcome = norm(stop.test_outcome).toLowerCase() as PortalTestOutcome
  return PORTAL_OUTCOMES.has(outcome) ? outcome : null
}

export type RunReviewOutcomeIconKind =
  | 'all_good'
  | 'failed'
  | 'passed_with_problems'
  | 'annual'
  | 'skipped'

/** Skipped because of annual month / annual skip reason (not a generic field skip). */
export function runReviewStopIsAnnualSkip(
  stop: TechnicianWorksheetLocation,
  monthDate: string,
): boolean {
  const outcome = stopPortalOutcome(stop)
  const rs = norm(stop.result_status).toLowerCase()
  const skipped = outcome === 'skipped' || rs === 'skipped'
  if (!skipped) return false
  return officeStopStatus(stop, monthDate) === 'annual'
}

function runReviewIsGenericSkipped(
  stop: TechnicianWorksheetLocation,
  monthDate: string,
): boolean {
  if (runReviewStopIsAnnualSkip(stop, monthDate)) return false
  const outcome = stopPortalOutcome(stop)
  if (outcome === 'skipped') return true
  return officeStopStatus(stop, monthDate) === 'skipped'
}

/** Icon shown beside run-review outcome text (null when no icon applies). */
export function runReviewOutcomeIconKind(
  stop: TechnicianWorksheetLocation,
  monthDate: string,
): RunReviewOutcomeIconKind | null {
  if (runReviewStopIsAnnualSkip(stop, monthDate)) return 'annual'
  if (runReviewIsGenericSkipped(stop, monthDate)) return 'skipped'
  const outcome = stopPortalOutcome(stop)
  if (outcome === 'all_good') return 'all_good'
  if (outcome === 'failed') return 'failed'
  if (outcome === 'passed_with_problems') return 'passed_with_problems'
  const status = officeStopStatus(stop, monthDate)
  if (status === 'annual') return 'annual'
  if (status === 'tested') return 'all_good'
  return null
}

/** Category-only label for non-annual skipped stops (no "Skipped" prefix). */
export function runReviewSkippedCategoryHeadline(stop: TechnicianWorksheetLocation): string | null {
  const cat = norm(stop.skip_category)
  if (cat) return skipCategoryLabel(cat) || null

  const reason = formatSkipReasonDisplayText(stop.skip_reason)
  if (!reason) return null

  const sep = reason.indexOf(' · ')
  return sep >= 0 ? reason.slice(0, sep) : reason
}

/** Technician free-text note for skipped stops (tooltip on run review). */
export function runReviewSkippedTechNote(stop: TechnicianWorksheetLocation): string | null {
  const note = norm(stop.skip_note)
  if (note) return note

  const raw = norm(stop.skip_reason)
  if (!raw) return null

  const colon = raw.indexOf(':')
  if (colon > 0) {
    const rest = raw.slice(colon + 1).trim()
    return rest || null
  }

  return null
}

export function runReviewOutcomeHeadline(
  stop: TechnicianWorksheetLocation,
  monthDate: string,
): string | null {
  if (runReviewStopIsAnnualSkip(stop, monthDate)) {
    return OFFICE_OUTCOME_SKIPPED_ANNUAL_LABEL
  }

  if (runReviewIsGenericSkipped(stop, monthDate)) {
    return runReviewSkippedCategoryHeadline(stop)
  }

  const portalLabel = portalOutcomeDisplay(stop)
  if (portalLabel) return portalLabel

  const status = officeStopStatus(stop, monthDate)
  if (status === 'tested') return 'Tested (legacy)'
  if (status === 'annual') return officeStopStatusLabel('annual')
  if (status === 'on_hold') return officeStopStatusLabel('on_hold')
  return null
}

export type RunReviewLocationCellTone =
  | 'all_good'
  | 'passed_with_problems'
  | 'failed'
  | 'skipped'
  | 'annual'
  | 'pending'

const RUN_REVIEW_LOCATION_CELL_CLASS: Record<RunReviewLocationCellTone, string> = {
  all_good: 'run-details-review-location-cell--all-good',
  passed_with_problems: 'run-details-review-location-cell--passed-problems',
  failed: 'run-details-review-location-cell--failed',
  skipped: 'run-details-review-location-cell--skipped',
  annual: 'run-details-review-location-cell--annual',
  pending: 'run-details-review-location-cell--pending',
}

/** Outcome tone for full-cell background in run review Location & Result column. */
export function runReviewLocationCellTone(
  stop: TechnicianWorksheetLocation,
  monthDate: string,
): RunReviewLocationCellTone {
  const outcome = stopPortalOutcome(stop)
  if (outcome === 'all_good') return 'all_good'
  if (outcome === 'passed_with_problems') return 'passed_with_problems'
  if (outcome === 'failed') return 'failed'
  if (outcome === 'skipped') {
    return runReviewStopIsAnnualSkip(stop, monthDate) ? 'annual' : 'skipped'
  }
  const rs = norm(stop.result_status).toLowerCase()
  if (rs === 'tested') return 'all_good'
  if (rs === 'skipped') {
    return runReviewStopIsAnnualSkip(stop, monthDate) ? 'annual' : 'skipped'
  }
  return 'pending'
}

export function runReviewLocationCellClass(tone: RunReviewLocationCellTone): string {
  return RUN_REVIEW_LOCATION_CELL_CLASS[tone]
}

export function runReviewLocationResultCardClass(tone: RunReviewLocationCellTone): string {
  return runReviewLocationCellClass(tone).replace(
    'run-details-review-location-cell',
    'run-details-review-location-result-card',
  )
}

export function runReviewOutcomeBadgeClass(
  stop: TechnicianWorksheetLocation,
  monthDate: string,
): string {
  const outcome = stopPortalOutcome(stop)
  if (outcome === 'all_good') return 'run-detail-site-card__badge--all-good'
  if (outcome === 'passed_with_problems') return 'run-detail-site-card__badge--passed-problems'
  if (outcome === 'failed') return 'run-detail-site-card__badge--failed'
  if (outcome === 'skipped') {
    return runReviewStopIsAnnualSkip(stop, monthDate)
      ? 'run-detail-site-card__badge--annual'
      : 'run-detail-site-card__badge--skipped'
  }
  const status = officeStopStatus(stop, monthDate)
  if (status === 'tested') return 'run-detail-site-card__badge--legacy-tested'
  if (status === 'annual') return 'run-detail-site-card__badge--annual'
  if (status === 'on_hold') return 'run-detail-site-card__badge--on-hold'
  if (status === 'skipped') return 'run-detail-site-card__badge--skipped'
  return 'run-detail-site-card__badge--pending'
}

export function billingStatusLabel(status: string | null | undefined): string {
  const s = norm(status).toLowerCase()
  switch (s) {
    case 'bill':
      return 'Bill'
    case 'do_not_bill':
      return 'Do not bill'
    case 'unset':
      return 'Unset'
    case 'legacy':
      return 'Legacy'
    default:
      return 'Unset'
  }
}

export function billingStatusVariant(status: string | null | undefined): string {
  const s = norm(status).toLowerCase()
  switch (s) {
    case 'bill':
      return 'success'
    case 'do_not_bill':
      return 'danger'
    case 'legacy':
      return 'secondary'
    default:
      return 'warning'
  }
}

export type RunReviewLocationGroup = {
  locationId: number
  label: string
  stops: TechnicianWorksheetLocation[]
  billing_status: string | null
}

export function groupStopsByLocation(stops: TechnicianWorksheetLocation[]): RunReviewLocationGroup[] {
  const byLocation = new Map<number, TechnicianWorksheetLocation[]>()
  for (const stop of stops) {
    const list = byLocation.get(stop.location_id) ?? []
    list.push(stop)
    byLocation.set(stop.location_id, list)
  }
  const groups: RunReviewLocationGroup[] = []
  for (const [locationId, locationStops] of byLocation) {
    const sorted = [...locationStops].sort(
      (a, b) => a.location_id - b.location_id || a.stop_number - b.stop_number,
    )
    const label =
      (sorted[0]?.display_address || sorted[0]?.label || '').trim() || `Location ${locationId}`
    const billing =
      sorted.map((s) => norm(s.billing_status).toLowerCase()).find((s) => s.length > 0) ?? null
    groups.push({
      locationId,
      label,
      stops: sorted,
      billing_status: billing,
    })
  }
  return groups.sort((a, b) => a.label.localeCompare(b.label) || a.locationId - b.locationId)
}

export function stopMatchesOutcomeFilter(
  stop: TechnicianWorksheetLocation,
  monthDate: string,
  filter: PortalTestOutcome,
): boolean {
  const outcome = stopPortalOutcome(stop)
  if (outcome === filter) return true
  // Legacy tested rows without test_outcome only.
  if (filter === 'all_good' && !outcome && officeStopStatus(stop, monthDate) === 'tested') {
    return true
  }
  if (filter === 'skipped') {
    const status = officeStopStatus(stop, monthDate)
    return status === 'skipped' || status === 'annual'
  }
  return false
}

export function stopHasOutcomeOnlyReview(stop: TechnicianWorksheetLocation, monthDate: string): boolean {
  const outcome = stopPortalOutcome(stop)
  if (outcome === 'all_good' || outcome === 'passed_with_problems' || outcome === 'failed') {
    return true
  }
  if (!outcome && officeStopStatus(stop, monthDate) === 'tested') return true
  return false
}
