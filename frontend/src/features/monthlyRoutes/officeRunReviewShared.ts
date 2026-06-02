/** Office run-details review: portal outcomes, billing labels, location grouping. */

import type { TechnicianWorksheetStop } from './monthlyRoutesShared'
import { officeStopStatus, officeStopStatusLabel } from './officeWorksheetTableShared'
import {
  formatSkipReasonDisplayText,
  portalOutcomeDisplay,
  portalSkipReasonDetail,
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

export function stopPortalOutcome(stop: TechnicianWorksheetStop): PortalTestOutcome | null {
  const outcome = norm(stop.test_outcome).toLowerCase() as PortalTestOutcome
  return PORTAL_OUTCOMES.has(outcome) ? outcome : null
}

export type RunReviewOutcomeIconKind = 'all_good' | 'failed' | 'passed_with_problems' | 'annual'

/** Icon shown beside run-review outcome text (null when no icon applies). */
export function runReviewOutcomeIconKind(
  stop: TechnicianWorksheetStop,
  monthDate: string,
): RunReviewOutcomeIconKind | null {
  if (runReviewStopIsAnnualSkip(stop, monthDate)) return 'annual'
  const outcome = stopPortalOutcome(stop)
  if (outcome === 'all_good') return 'all_good'
  if (outcome === 'failed') return 'failed'
  if (outcome === 'passed_with_problems') return 'passed_with_problems'
  const status = officeStopStatus(stop, monthDate)
  if (status === 'annual') return 'annual'
  if (status === 'tested') return 'all_good'
  return null
}

/** Skipped because of annual month / annual skip reason (not a generic field skip). */
export function runReviewStopIsAnnualSkip(
  stop: TechnicianWorksheetStop,
  monthDate: string,
): boolean {
  const outcome = stopPortalOutcome(stop)
  const rs = norm(stop.result_status).toLowerCase()
  const skipped = outcome === 'skipped' || rs === 'skipped'
  if (!skipped) return false
  return officeStopStatus(stop, monthDate) === 'annual'
}

export function runReviewOutcomeHeadline(
  stop: TechnicianWorksheetStop,
  monthDate: string,
): string | null {
  const portalLabel = portalOutcomeDisplay(stop)
  if (portalLabel) {
    if (stopPortalOutcome(stop) === 'skipped') {
      const detail = portalSkipReasonDetail(stop)
      if (detail) return `Skipped · ${detail}`
    }
    return portalLabel
  }
  const status = officeStopStatus(stop, monthDate)
  if (status === 'tested') return 'Tested (legacy)'
  if (status === 'annual') return officeStopStatusLabel('annual')
  if (status === 'skipped') {
    const cat = norm(stop.skip_category)
    if (cat) {
      const catLabel = skipCategoryLabel(cat)
      const note = norm(stop.skip_note)
      const reason = formatSkipReasonDisplayText(stop.skip_reason)
      const parts = [catLabel, note, reason ?? ''].filter(Boolean)
      if (parts.length) return `Skipped · ${parts.join(' · ')}`
      return 'Skipped (legacy)'
    }
    const skipBlock = formatSkipReasonDisplayText(stop.skip_reason)
    if (skipBlock) return `Skipped · ${skipBlock}`
    return 'Skipped (legacy)'
  }
  return null
}

export function runReviewOutcomeBadgeClass(
  stop: TechnicianWorksheetStop,
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
  stops: TechnicianWorksheetStop[]
  billing_status: string | null
}

export function groupStopsByLocation(stops: TechnicianWorksheetStop[]): RunReviewLocationGroup[] {
  const byLocation = new Map<number, TechnicianWorksheetStop[]>()
  for (const stop of stops) {
    const list = byLocation.get(stop.location_id) ?? []
    list.push(stop)
    byLocation.set(stop.location_id, list)
  }
  const groups: RunReviewLocationGroup[] = []
  for (const [locationId, locationStops] of byLocation) {
    const sorted = [...locationStops].sort(
      (a, b) => a.testing_site_id - b.testing_site_id || a.stop_number - b.stop_number,
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
  stop: TechnicianWorksheetStop,
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

export function stopHasOutcomeOnlyReview(stop: TechnicianWorksheetStop, monthDate: string): boolean {
  const outcome = stopPortalOutcome(stop)
  if (outcome === 'all_good' || outcome === 'passed_with_problems' || outcome === 'failed') {
    return true
  }
  if (!outcome && officeStopStatus(stop, monthDate) === 'tested') return true
  return false
}
