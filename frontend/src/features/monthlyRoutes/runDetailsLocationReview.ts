import type {
  MonthlyRunDetailLocation,
  MonthlyRunDetailPayload,
  MonthlyRouteDetailPayload,
  RunReviewSummaryPayload,
  TechnicianWorksheetLocation,
  TechnicianWorksheetRun,
} from './monthlyRoutesShared'
import type { NotableStopChangeCard, RunReviewFilter, RunReviewSummary } from './notableStopChanges'
import {
  cardHasFieldEdits,
  cardIsTestedOnly,
  cardMatchesRunReviewFilter,
} from './notableStopChanges'
import {
  runReviewOutcomeBadgeClass,
  runReviewOutcomeHeadline,
  runReviewStopIsAnnualSkip,
  stopHasNoTestResult,
  stopMatchesOutcomeFilter,
  stopPortalOutcome,
  type OfficeBillingStatus,
} from './officeRunReviewShared'
import { officeStopStatus } from './officeWorksheetTableShared'
import { portalStopHasTestOutcome, type PortalTestOutcome } from './portalWorkflowShared'
import { openDeficiencySummaries } from './runDetailsDeficiencyDisplay'
import { richTextIsEmpty } from '../richText/richTextSanitize'

export type RunLocationReviewFilter =
  | RunReviewFilter
  | 'needs_attention'
  | 'billing_unset'
  | 'no_test_result'
  | 'submitted'

export function runDetailLocationAsWorksheetLocation(
  loc: MonthlyRunDetailLocation,
): TechnicianWorksheetLocation {
  return {
    location_id: loc.location_id,
    location_month_row_id: 0,
    month_date: loc.month_date,
    display_address: loc.display_address || loc.location_label,
    property_management_company: null,
    label: loc.label,
    panel: null,
    panel_location: null,
    door_code: loc.door_code ?? null,
    ring: loc.ring ?? null,
    key_number: loc.key_number ?? null,
    monitoring_company: loc.monitoring_company ?? null,
    monitoring_company_id: loc.monitoring_company_id ?? null,
    monitoring_company_record: loc.monitoring_company_record ?? null,
    monitoring_account_number: loc.monitoring_account_number ?? null,
    monitoring_password: loc.monitoring_password ?? null,
    monitoring_notes: loc.monitoring_notes ?? null,
    result_status: loc.result_status,
    skip_reason: loc.skip_reason ?? null,
    test_outcome: loc.test_outcome,
    skip_category: loc.skip_category,
    skip_note: loc.skip_note,
    confirmed_no_deficiencies: loc.confirmed_no_deficiencies,
    billing_status: loc.billing_status,
    testing_procedures: loc.testing_procedures,
    inspection_tech_notes: loc.inspection_tech_notes,
    run_comments: loc.run_comments,
    time_in: null,
    time_out: null,
    route_stop_order: null,
    session_route_stop_order: null,
    stop_number: loc.stop_number,
    version_updated_at: null,
    status_normalized: loc.status_normalized ?? null,
    scheduled_annual_auto_skip: loc.scheduled_annual_auto_skip,
  }
}

/** @deprecated Use ``runDetailLocationAsWorksheetLocation``. */
export function locationStopAsWorksheetStop(
  stop: MonthlyRunDetailLocation,
  locationLabel: string,
): TechnicianWorksheetLocation {
  return runDetailLocationAsWorksheetLocation({
    ...stop,
    display_address: stop.display_address || locationLabel,
  })
}

export function stopHasSubmittedTestResult(loc: TechnicianWorksheetLocation): boolean {
  if (portalStopHasTestOutcome(loc)) return true
  const rs = (loc.result_status || '').trim().toLowerCase()
  return rs === 'tested' || rs === 'skipped'
}

export function locationHasSubmittedResult(location: MonthlyRunDetailLocation): boolean {
  return stopHasSubmittedTestResult(runDetailLocationAsWorksheetLocation(location))
}

export function locationHasNoTestResult(
  location: MonthlyRunDetailLocation,
  monthDate: string,
): boolean {
  return stopHasNoTestResult(runDetailLocationAsWorksheetLocation(location), monthDate)
}

export function countNoTestResultLocations(
  locations: MonthlyRunDetailLocation[],
  monthDate: string,
): number {
  return locations.filter((loc) => locationHasNoTestResult(loc, monthDate)).length
}

/** @deprecated Use ``locationHasSubmittedResult``. */
export function locationHasAllStopsSubmitted(location: MonthlyRunDetailLocation): boolean {
  return locationHasSubmittedResult(location)
}

export function countSubmittedLocations(locations: MonthlyRunDetailLocation[]): number {
  return locations.filter(locationHasSubmittedResult).length
}

export function mapReviewSummaryPayload(summary: RunReviewSummaryPayload): RunReviewSummary {
  return {
    stopCount: summary.stop_count,
    outcomeOnlyCount: summary.outcome_only_count,
    allGoodCount: summary.all_good_count,
    passedWithProblemsCount: summary.passed_with_problems_count,
    failedCount: summary.failed_count,
    skippedCount: summary.skipped_count,
    updatedCount: summary.updated_count,
  }
}

export function buildLocationCard(
  location: MonthlyRunDetailLocation,
  monthDate: string,
): NotableStopChangeCard {
  const ws = runDetailLocationAsWorksheetLocation(location)
  const siteLabel = (location.label || '').trim() || 'Primary testing location'
  return {
    stop: ws,
    stopNumber: location.stop_number,
    displayAddress: ws.display_address,
    locationId: location.location_id,
    siteLabel,
    siteIndex: 1,
    siteCount: 1,
    reviewKind: location.review_kind,
    resultHeadline: runReviewOutcomeHeadline(ws, monthDate),
    changes: [],
    hasFieldEdits: location.has_field_edits,
  }
}

/** @deprecated Use ``buildLocationCard``. */
export function buildStopCardFromLocation(
  location: MonthlyRunDetailLocation,
  stop: MonthlyRunDetailLocation,
  monthDate: string,
): NotableStopChangeCard {
  return buildLocationCard({ ...location, ...stop }, monthDate)
}

export const RUN_LOCATION_EXPAND_EVENT = 'run-review:expand-location'

export function runLocationReviewDomId(locationId: number): string {
  return `run-location-review-${locationId}`
}

export function dispatchRunLocationExpand(domId: string): void {
  window.dispatchEvent(new CustomEvent(RUN_LOCATION_EXPAND_EVENT, { detail: { domId } }))
}

export type RunDetailPrepRow = {
  location: MonthlyRunDetailLocation
}

export type RunDetailReviewRow = RunDetailPrepRow & {
  openTickets: number
}

export type RunDetailNewCommentField = 'run_comments' | 'inspection_tech_notes' | 'testing_procedures'

type LocationWithNewCommentFields = {
  new_comment_fields?: string[]
}

export function stopHasNewCommentField(
  loc: LocationWithNewCommentFields,
  field: RunDetailNewCommentField,
): boolean {
  return (loc.new_comment_fields ?? []).includes(field)
}

export type RunDetailsPrepSummary = {
  stopCount: number
  locationCount: number
  openDeficiencyCount: number
}

export function computeRunDetailsPrepSummary(
  locations: MonthlyRunDetailLocation[],
): RunDetailsPrepSummary {
  let openDeficiencyCount = 0
  for (const loc of locations) {
    openDeficiencyCount += openDeficiencySummaries(loc.deficiency_summaries).length
  }
  return {
    stopCount: locations.length,
    locationCount: locations.length,
    openDeficiencyCount,
  }
}

export function filterRunDetailPrepRows(
  rows: RunDetailPrepRow[],
  searchQuery: string,
): RunDetailPrepRow[] {
  const q = searchQuery.trim().toLowerCase()
  if (!q) return rows
  return rows.filter(({ location }) => {
    const stopNum = String(location.stop_number ?? '')
    const siteLabel = (location.label || '').trim().toLowerCase()
    const locationLabel = (location.location_label || '').trim().toLowerCase()
    return locationLabel.includes(q) || stopNum.includes(q) || siteLabel.includes(q)
  })
}

export function flattenRunDetailPrepRows(locations: MonthlyRunDetailLocation[]): RunDetailPrepRow[] {
  return [...locations]
    .sort((a, b) => (a.stop_number || 0) - (b.stop_number || 0) || a.location_id - b.location_id)
    .map((location) => ({ location }))
}

export function orderedLocationIdsFromPrepRows(rows: RunDetailPrepRow[]): number[] {
  return rows.map((row) => row.location.location_id)
}

export function reorderPrepRowsByLocationIds(
  rows: RunDetailPrepRow[],
  orderedLocationIds: number[],
): RunDetailPrepRow[] {
  const byLocation = new Map(rows.map((row) => [row.location.location_id, row]))
  return orderedLocationIds
    .map((locationId) => byLocation.get(locationId))
    .filter((row): row is RunDetailPrepRow => row != null)
}

export function renumberPrepRowStopNumbers(rows: RunDetailPrepRow[]): RunDetailPrepRow[] {
  let stopNumber = 1
  return rows.map((row) => ({
    location: {
      ...row.location,
      stop_number: stopNumber++,
    },
  }))
}

export function reorderRunDetailLocations(
  locations: MonthlyRunDetailLocation[],
  orderedLocationIds: number[],
): MonthlyRunDetailLocation[] {
  const byId = new Map(locations.map((loc) => [loc.location_id, loc]))
  let stopNumber = 1
  const out: MonthlyRunDetailLocation[] = []
  for (const locationId of orderedLocationIds) {
    const loc = byId.get(locationId)
    if (!loc) continue
    out.push({ ...loc, stop_number: stopNumber++ })
  }
  return out
}

export function runDetailLocationOrderMatches(
  locations: MonthlyRunDetailLocation[],
  orderedLocationIds: number[],
): boolean {
  const current = locations.map((loc) => loc.location_id)
  return (
    current.length === orderedLocationIds.length &&
    current.every((id, index) => id === orderedLocationIds[index])
  )
}

function normalizePrepAddressLabel(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function locationIdsToDismissOutOfOrderAfterReorder(
  rows: RunDetailPrepRow[],
  orderedLocationIds: number[],
): number[] {
  if (orderedLocationIds.length < 2) return []

  const labelByLocationId = new Map<number, string>()
  for (const row of rows) {
    const locationId = row.location.location_id
    if (!labelByLocationId.has(locationId)) {
      labelByLocationId.set(locationId, normalizePrepAddressLabel(row.location.location_label))
    }
  }
  const indexByLocationId = new Map(
    orderedLocationIds.map((locationId, index) => [locationId, index]),
  )

  const toDismiss: number[] = []
  for (const row of rows) {
    const location = row.location
    if (!location.prior_month_out_of_order || location.prior_month_out_of_order_dismissed) continue
    const afterAddr = normalizePrepAddressLabel(location.prior_month_tested_after_address || '')
    if (!afterAddr) continue

    const myIndex = indexByLocationId.get(location.location_id)
    if (myIndex === undefined || myIndex < 1) continue

    let prevLocationId: number | null = null
    for (const [locationId, label] of labelByLocationId) {
      if (label === afterAddr) {
        prevLocationId = locationId
        break
      }
    }
    if (prevLocationId === null) continue

    const prevIndex = indexByLocationId.get(prevLocationId)
    if (prevIndex !== undefined && myIndex === prevIndex + 1) {
      toDismiss.push(location.location_id)
    }
  }
  return toDismiss
}

/** @deprecated Use ``locationIdsToDismissOutOfOrderAfterReorder``. */
export function testingSiteIdsToDismissOutOfOrderAfterReorder(
  rows: RunDetailPrepRow[],
  orderedLocationIds: number[],
): number[] {
  return locationIdsToDismissOutOfOrderAfterReorder(rows, orderedLocationIds)
}

export function applyOutOfOrderDismissalsToPrepRows(
  rows: RunDetailPrepRow[],
  orderedLocationIds: number[],
): RunDetailPrepRow[] {
  const dismissIds = new Set(locationIdsToDismissOutOfOrderAfterReorder(rows, orderedLocationIds))
  if (dismissIds.size === 0) return rows
  return rows.map((row) => {
    if (!dismissIds.has(row.location.location_id)) return row
    return {
      location: {
        ...row.location,
        prior_month_out_of_order: false,
        prior_month_tested_after_address: null,
        prior_month_out_of_order_dismissed: true,
      },
    }
  })
}

export function clearResolvedOutOfOrderHintsOnLocations(
  locations: MonthlyRunDetailLocation[],
  orderedLocationIds: number[],
): MonthlyRunDetailLocation[] {
  const rows = flattenRunDetailPrepRows(locations)
  const dismissIds = new Set(locationIdsToDismissOutOfOrderAfterReorder(rows, orderedLocationIds))
  if (dismissIds.size === 0) return locations
  return locations.map((location) =>
    dismissIds.has(location.location_id)
      ? {
          ...location,
          prior_month_out_of_order: false,
          prior_month_tested_after_address: null,
          prior_month_out_of_order_dismissed: true,
        }
      : location,
  )
}

export function priorMonthOutOfOrderHint(
  location: Pick<
    MonthlyRunDetailLocation,
    'prior_month_out_of_order' | 'prior_month_tested_after_address'
  >,
): { title: string; detail: string | null } | null {
  if (!location.prior_month_out_of_order) return null
  const testedAfter = (location.prior_month_tested_after_address || '').trim()
  return {
    title: 'Out of order last run',
    detail: testedAfter ? `Was tested after ${testedAfter} last month` : null,
  }
}

export function priorMonthNewToRouteHint(
  location: Pick<MonthlyRunDetailLocation, 'prior_month_new_to_route'>,
): { title: string; detail: string | null } | null {
  if (!location.prior_month_new_to_route) return null
  return {
    title: 'New to route',
    detail: "Not on last month's route",
  }
}

export function priorMonthFieldEditsHint(
  location: Pick<
    MonthlyRunDetailLocation,
    'prior_month_field_edits' | 'prior_month_edited_fields'
  >,
): { title: string; detail: string; tooltip: string } | null {
  if (!location.prior_month_field_edits) return null
  const fields = (location.prior_month_edited_fields ?? [])
    .map((label) => label.trim())
    .filter((label) => label.length > 0)
  const tooltip =
    'Technician or office updated site paperwork during last month\'s field run. Route stop order is tracked separately.'
  if (fields.length === 0) {
    return {
      title: 'Edited last month',
      detail: 'Site details updated during last run',
      tooltip,
    }
  }
  return {
    title: 'Edited last month',
    detail: fields.join(' · '),
    tooltip: `${tooltip} Fields: ${fields.join(', ')}.`,
  }
}

export function flattenRunDetailReviewRows(
  locations: MonthlyRunDetailLocation[],
): RunDetailReviewRow[] {
  return [...locations]
    .sort((a, b) => (a.stop_number || 0) - (b.stop_number || 0) || a.location_id - b.location_id)
    .map((location) => ({
      location,
      openTickets: location.attention_flags.open_tickets ?? 0,
    }))
}

const OUTCOME_RANK: Record<string, number> = {
  failed: 5,
  passed_with_problems: 4,
  skipped: 3,
  all_good: 2,
  tested: 1,
  annual: 2,
  pending: 0,
}

function locationOutcomeRank(location: MonthlyRunDetailLocation, monthDate: string): number {
  const ws = runDetailLocationAsWorksheetLocation(location)
  const outcome = stopPortalOutcome(ws)
  if (outcome && OUTCOME_RANK[outcome] != null) return OUTCOME_RANK[outcome]
  return OUTCOME_RANK[officeStopStatus(ws, monthDate)] ?? 0
}

export function locationWorstOutcomeRank(location: MonthlyRunDetailLocation, monthDate: string): number {
  return locationOutcomeRank(location, monthDate)
}

export type LocationIdentityTone =
  | 'all_good'
  | 'skipped'
  | 'annual'
  | 'passed_with_problems'
  | 'failed'
  | 'neutral'

function locationIdentityToneForLocation(
  location: MonthlyRunDetailLocation,
  monthDate: string,
): LocationIdentityTone {
  const ws = runDetailLocationAsWorksheetLocation(location)
  const outcome = stopPortalOutcome(ws)
  if (outcome === 'failed') return 'failed'
  if (outcome === 'passed_with_problems') return 'passed_with_problems'
  if (outcome === 'skipped') {
    return runReviewStopIsAnnualSkip(ws, monthDate) ? 'annual' : 'skipped'
  }
  if (outcome === 'all_good') return 'all_good'
  const status = officeStopStatus(ws, monthDate)
  if (status === 'annual' || status === 'on_hold') return 'annual'
  if (status === 'skipped') return 'skipped'
  if (status === 'tested') return 'all_good'
  return 'neutral'
}

export function locationIdentityTone(
  location: MonthlyRunDetailLocation,
  monthDate: string,
): LocationIdentityTone {
  return locationIdentityToneForLocation(location, monthDate)
}

export function locationPrimaryOutcomeDisplay(
  location: MonthlyRunDetailLocation,
  monthDate: string,
): { headline: string; badgeClass: string } | null {
  const card = buildLocationCard(location, monthDate)
  const headline = card.resultHeadline
  if (!headline) return null
  return {
    headline,
    badgeClass: runReviewOutcomeBadgeClass(card.stop, monthDate),
  }
}

function billingIsDecided(status: string | null | undefined): boolean {
  const s = (status || '').trim().toLowerCase()
  return s === 'bill' || s === 'do_not_bill' || s === 'legacy'
}

export function locationIsCompact(location: MonthlyRunDetailLocation, monthDate: string): boolean {
  if (!billingIsDecided(location.billing_status)) return false
  if (location.attention_flags.needs_attention) return false
  if (location.attention_flags.has_field_edits) return false
  if (location.attention_flags.has_active_deficiencies) return false
  if (location.attention_flags.has_job_comment) return false
  const card = buildLocationCard(location, monthDate)
  return cardIsTestedOnly(card) && !cardHasFieldEdits(card)
}

export function locationMatchesFilter(
  location: MonthlyRunDetailLocation,
  filter: RunLocationReviewFilter,
  monthDate: string,
): boolean {
  if (filter === 'needs_attention') return location.attention_flags.needs_attention
  if (filter === 'billing_unset') return location.attention_flags.billing_unset
  if (filter === 'submitted') return locationHasSubmittedResult(location)
  if (filter === 'no_test_result') return locationHasNoTestResult(location, monthDate)
  if (filter === 'all') return true
  if (filter === 'updated') return location.attention_flags.has_field_edits
  const ws = runDetailLocationAsWorksheetLocation(location)
  return stopMatchesOutcomeFilter(ws, monthDate, filter as PortalTestOutcome)
}

export function filterRunDetailLocations(
  locations: MonthlyRunDetailLocation[],
  filter: RunLocationReviewFilter,
  monthDate: string,
): MonthlyRunDetailLocation[] {
  if (filter === 'all') return locations
  return locations.filter((loc) => locationMatchesFilter(loc, filter, monthDate))
}

export type RunDetailReviewPillFilter = PortalTestOutcome | 'billing_unset' | 'no_test_result'

/** When ``filters`` is empty, all locations are returned (OR semantics when non-empty). */
export function filterRunDetailLocationsByOutcomes(
  locations: MonthlyRunDetailLocation[],
  filters: readonly RunDetailReviewPillFilter[],
  monthDate: string,
): MonthlyRunDetailLocation[] {
  if (filters.length === 0) return locations
  return locations.filter((loc) =>
    filters.some((filter) => locationMatchesFilter(loc, filter, monthDate)),
  )
}

export function countBillingUnsetLocations(locations: MonthlyRunDetailLocation[]): number {
  return locations.filter((loc) => loc.attention_flags.billing_unset).length
}

export type RunDetailReviewSectionTab = 'run_history' | 'run_review' | 'field_changes'

export function filterRunDetailFieldEditLocations(
  locations: MonthlyRunDetailLocation[],
): MonthlyRunDetailLocation[] {
  return locations.filter((loc) => loc.attention_flags.has_field_edits)
}

export function countRunDetailFieldEditLocations(locations: MonthlyRunDetailLocation[]): number {
  return filterRunDetailFieldEditLocations(locations).length
}

export type RunDetailsProgressMetrics = {
  locationCount: number
  billingDecidedCount: number
  needsAttentionCount: number
  prepRemainingCount: number
}

export function computeRunDetailsProgress(
  locations: MonthlyRunDetailLocation[],
  monthDate: string,
  runCompleted: boolean,
): RunDetailsProgressMetrics {
  let billingDecidedCount = 0
  let needsAttentionCount = 0
  let prepRemainingCount = 0
  for (const loc of locations) {
    if (billingIsDecided(loc.billing_status)) billingDecidedCount += 1
    if (loc.attention_flags.needs_attention) needsAttentionCount += 1
    if (runCompleted && locationNeedsPrep(loc, monthDate)) prepRemainingCount += 1
  }
  return {
    locationCount: locations.length,
    billingDecidedCount,
    needsAttentionCount,
    prepRemainingCount,
  }
}

function normComment(value: string | null | undefined): string {
  return (value ?? '').trim()
}

export function locationNeedsPrep(location: MonthlyRunDetailLocation, monthDate: string): boolean {
  if (normComment(location.run_comments)) return true
  if (normComment(location.testing_procedures) && location.testing_procedures!.length > 120) {
    return true
  }
  if (normComment(location.inspection_tech_notes) && location.inspection_tech_notes!.length > 120) {
    return true
  }
  return false
}

export function stopCardsForLocation(
  location: MonthlyRunDetailLocation,
  monthDate: string,
): NotableStopChangeCard[] {
  return [buildLocationCard(location, monthDate)]
}

export function locationMatchesOutcomeKpi(
  location: MonthlyRunDetailLocation,
  filter: RunReviewFilter,
  monthDate: string,
): boolean {
  if (filter === 'all' || filter === 'updated') return false
  const card = buildLocationCard(location, monthDate)
  return cardMatchesRunReviewFilter(card, filter, monthDate)
}

function locationHasActiveDeficiencies(location: MonthlyRunDetailLocation): boolean {
  if (location.has_active_deficiencies) return true
  return (location.deficiency_summaries?.length ?? 0) > 0
}

function locationNeedsAttentionExcludingBilling(
  location: MonthlyRunDetailLocation,
  monthDate: string,
): boolean {
  if (locationHasActiveDeficiencies(location)) return true
  const ws = runDetailLocationAsWorksheetLocation(location)
  const outcome = stopPortalOutcome(ws)
  if (outcome === 'failed' || outcome === 'passed_with_problems') return true
  if (officeStopStatus(ws, monthDate) === 'skipped') return true
  return false
}

export function recomputeLocationAttentionFlags(
  location: MonthlyRunDetailLocation,
  monthDate: string,
  billingStatus: string | null,
): MonthlyRunDetailLocation['attention_flags'] {
  const billingNorm = (billingStatus || '').trim().toLowerCase()
  const billing_unset = billingNorm === '' || billingNorm === 'unset' || billingStatus == null
  const has_active_deficiencies = locationHasActiveDeficiencies(location)
  const has_job_comment = normComment(location.run_comments).length > 0
  let needs_attention = billing_unset || has_active_deficiencies
  if (!needs_attention) {
    needs_attention = locationNeedsAttentionExcludingBilling(location, monthDate)
  }
  return {
    billing_unset,
    has_field_edits: location.attention_flags.has_field_edits,
    has_active_deficiencies,
    has_job_comment,
    needs_attention,
  }
}

export function patchRunDetailPreRunMessage(
  run: TechnicianWorksheetRun,
  preRunMessage: string | null,
): TechnicianWorksheetRun {
  const text = (preRunMessage ?? '').trim()
  return { ...run, pre_run_message: text.length > 0 ? text : null }
}

export function patchRunDetailFieldEndSummary(
  run: TechnicianWorksheetRun,
  fieldEndSummary: string | null,
): TechnicianWorksheetRun {
  const text = (fieldEndSummary ?? '').trim()
  return { ...run, field_end_summary: richTextIsEmpty(text) ? null : text }
}

export function patchRunDetailPayloadRun(
  payload: MonthlyRunDetailPayload,
  run: TechnicianWorksheetRun,
): MonthlyRunDetailPayload {
  return {
    ...payload,
    run,
    field_submission: {
      available: payload.field_submission?.available ?? false,
      captured_at: payload.field_submission?.captured_at ?? null,
      field_work_reopened: payload.field_submission?.field_work_reopened ?? false,
    },
  }
}

export function patchRouteMetaRunMonth(
  routeMeta: MonthlyRouteDetailPayload | null,
  monthIso: string,
  run: TechnicianWorksheetRun,
): MonthlyRouteDetailPayload | null {
  if (!routeMeta) return routeMeta
  return {
    ...routeMeta,
    runs_by_month: {
      ...routeMeta.runs_by_month,
      [monthIso]: {
        run_id: run.id,
        source: run.source,
        status: run.status,
        opened_at: run.opened_at,
        started_at: run.started_at,
        completed_at: run.completed_at,
        workflow_stage: run.workflow_stage,
        workflow_stage_label: run.workflow_stage_label,
      },
    },
  }
}

export function patchRunDetailLocationStop(
  locations: MonthlyRunDetailLocation[],
  locationId: number,
  monthDate: string,
  patch: Partial<MonthlyRunDetailLocation>,
): MonthlyRunDetailLocation[] {
  return locations.map((loc) => {
    if (loc.location_id !== locationId) return loc
    const next = { ...loc, ...patch }
    return {
      ...next,
      attention_flags: recomputeLocationAttentionFlags(next, monthDate, loc.billing_status ?? null),
    }
  })
}

/** @deprecated Use ``patchRunDetailLocationStop``. */
export function patchRunDetailStopFields(
  locations: MonthlyRunDetailLocation[],
  locationId: number,
  patch: Partial<MonthlyRunDetailLocation>,
): MonthlyRunDetailLocation[] {
  const monthDate = locations[0]?.month_date ?? ''
  return patchRunDetailLocationStop(locations, locationId, monthDate, patch)
}

export function patchRunDetailLocationBilling(
  locations: MonthlyRunDetailLocation[],
  locationId: number,
  billingStatus: string,
  monthDate: string,
): MonthlyRunDetailLocation[] {
  return locations.map((loc) => {
    if (loc.location_id !== locationId) return loc
    const attention_flags = recomputeLocationAttentionFlags(loc, monthDate, billingStatus)
    return {
      ...loc,
      billing_status: billingStatus,
      attention_flags,
    }
  })
}

function normBillingStatus(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

export function stopQualifiesForAutoBill(
  loc: TechnicianWorksheetLocation,
  monthDate: string,
): boolean {
  const outcome = stopPortalOutcome(loc)
  if (outcome === 'all_good' || outcome === 'passed_with_problems') return true
  if (!outcome && officeStopStatus(loc, monthDate) === 'tested') return true
  return false
}

export function stopQualifiesForAutoDoNotBill(
  loc: TechnicianWorksheetLocation,
  monthDate: string,
): boolean {
  if (officeStopStatus(loc, monthDate) === 'annual') return true
  if (runReviewStopIsAnnualSkip(loc, monthDate)) return true
  const cat = (loc.skip_category || '').trim().toLowerCase()
  return stopPortalOutcome(loc) === 'skipped' && cat === 'annual'
}

export function locationQualifiesForAutoDoNotBill(
  location: MonthlyRunDetailLocation,
  monthDate: string,
): boolean {
  return stopQualifiesForAutoDoNotBill(runDetailLocationAsWorksheetLocation(location), monthDate)
}

export function autoOfficeBillingStatusForLocation(
  location: MonthlyRunDetailLocation,
  monthDate: string,
): Extract<OfficeBillingStatus, 'bill' | 'do_not_bill'> | null {
  if (normBillingStatus(location.billing_status) === 'legacy') return null
  if (
    stopQualifiesForAutoBill(runDetailLocationAsWorksheetLocation(location), monthDate)
  ) {
    return 'bill'
  }
  if (locationQualifiesForAutoDoNotBill(location, monthDate)) return 'do_not_bill'
  return null
}

export type AutoOfficeBillingUpdate = {
  locationId: number
  billingStatus: Extract<OfficeBillingStatus, 'bill' | 'do_not_bill'>
}

export function listAutoOfficeBillingUpdates(
  locations: MonthlyRunDetailLocation[],
  monthDate: string,
): AutoOfficeBillingUpdate[] {
  const updates: AutoOfficeBillingUpdate[] = []
  for (const loc of locations) {
    const next = autoOfficeBillingStatusForLocation(loc, monthDate)
    if (!next) continue
    if (normBillingStatus(loc.billing_status) === next) continue
    updates.push({ locationId: loc.location_id, billingStatus: next })
  }
  return updates
}
