import type {
  MonthlyRunDetailLocation,
  MonthlyRunDetailLocationStop,
  MonthlyRunDetailPayload,
  MonthlyRouteDetailPayload,
  RunReviewSummaryPayload,
  TechnicianWorksheetRun,
  TechnicianWorksheetStop,
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
  stopMatchesOutcomeFilter,
  stopPortalOutcome,
} from './officeRunReviewShared'
import { officeStopStatus } from './officeWorksheetTableShared'
import { portalStopHasTestOutcome, type PortalTestOutcome } from './portalWorkflowShared'
import { openDeficiencySummaries } from './runDetailsDeficiencyDisplay'

export type RunLocationReviewFilter =
  | RunReviewFilter
  | 'needs_attention'
  | 'billing_unset'
  | 'submitted'

/** Stop has a portal test_outcome or legacy tested/skipped result_status. */
export function stopHasSubmittedTestResult(stop: TechnicianWorksheetStop): boolean {
  if (portalStopHasTestOutcome(stop)) return true
  const rs = (stop.result_status || '').trim().toLowerCase()
  return rs === 'tested' || rs === 'skipped'
}

/** Location appears in the submitted filter when every stop has submitted results. */
export function locationHasAllStopsSubmitted(location: MonthlyRunDetailLocation): boolean {
  if (location.stops.length === 0) return false
  return location.stops.every((stop) =>
    stopHasSubmittedTestResult(locationStopAsWorksheetStop(stop, location.location_label)),
  )
}

export function countSubmittedLocations(locations: MonthlyRunDetailLocation[]): number {
  return locations.filter(locationHasAllStopsSubmitted).length
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

export function locationStopAsWorksheetStop(
  stop: MonthlyRunDetailLocationStop,
  locationLabel: string,
): TechnicianWorksheetStop {
  return {
    testing_site_id: stop.testing_site_id,
    location_id: stop.location_id,
    history_month_row_id: 0,
    month_date: stop.month_date,
    display_address: stop.display_address || locationLabel,
    building_name: null,
    property_management_company: null,
    label: stop.label,
    panel: null,
    panel_location: null,
    door_code: stop.door_code ?? null,
    ring: stop.ring ?? null,
    key_number: stop.key_number ?? null,
    annual_month: stop.annual_month,
    monitoring_company: stop.monitoring_company ?? null,
    monitoring_company_id: stop.monitoring_company_id ?? null,
    monitoring_company_record: stop.monitoring_company_record ?? null,
    monitoring_account_number: stop.monitoring_account_number ?? null,
    monitoring_notes: stop.monitoring_notes ?? null,
    result_status: stop.result_status,
    skip_reason: stop.skip_reason ?? null,
    test_outcome: stop.test_outcome,
    skip_category: stop.skip_category,
    skip_note: stop.skip_note,
    confirmed_no_deficiencies: stop.confirmed_no_deficiencies,
    billing_status: stop.billing_status,
    testing_procedures: stop.testing_procedures,
    inspection_tech_notes: stop.inspection_tech_notes,
    run_comments: stop.run_comments,
    time_in: null,
    time_out: null,
    route_stop_order: null,
    session_route_stop_order: null,
    stop_number: stop.stop_number,
    version_updated_at: null,
  }
}

export function buildStopCardFromLocation(
  location: MonthlyRunDetailLocation,
  stop: MonthlyRunDetailLocationStop,
  monthDate: string,
): NotableStopChangeCard {
  const ws = locationStopAsWorksheetStop(stop, location.location_label)
  const siteIndex =
    location.stops.findIndex((s) => s.testing_site_id === stop.testing_site_id) + 1
  const siteCount = location.stops.length
  const siteLabel = (stop.label || '').trim() || 'Primary testing location'
  return {
    stop: ws,
    stopNumber: stop.stop_number,
    displayAddress: ws.display_address,
    locationId: location.location_id,
    siteLabel,
    siteIndex,
    siteCount,
    reviewKind: stop.review_kind,
    resultHeadline: runReviewOutcomeHeadline(ws, monthDate),
    changes: [],
    hasFieldEdits: stop.has_field_edits,
  }
}

export const RUN_LOCATION_EXPAND_EVENT = 'run-review:expand-location'

export function runLocationReviewDomId(locationId: number): string {
  return `run-location-review-${locationId}`
}

export function dispatchRunLocationExpand(domId: string): void {
  window.dispatchEvent(new CustomEvent(RUN_LOCATION_EXPAND_EVENT, { detail: { domId } }))
}

export type RunDetailPrepRow = {
  stop: MonthlyRunDetailLocationStop
  locationLabel: string
  siteCount: number
}

export type RunDetailReviewRow = RunDetailPrepRow & {
  locationId: number
  billingStatus: string | null
  openTickets: number
}

export type RunDetailNewCommentField = 'run_comments' | 'inspection_tech_notes' | 'testing_procedures'

type StopWithNewCommentFields = {
  new_comment_fields?: string[]
}

export function stopHasNewCommentField(
  stop: StopWithNewCommentFields,
  field: RunDetailNewCommentField,
): boolean {
  return (stop.new_comment_fields ?? []).includes(field)
}

export type RunDetailsPrepSummary = {
  stopCount: number
  locationCount: number
  multiSiteLocationCount: number
  openDeficiencyCount: number
}

export function computeRunDetailsPrepSummary(
  locations: MonthlyRunDetailLocation[],
): RunDetailsPrepSummary {
  let stopCount = 0
  let multiSiteLocationCount = 0
  let openDeficiencyCount = 0
  for (const loc of locations) {
    stopCount += loc.stops.length
    if (loc.stops.length > 1) multiSiteLocationCount += 1
    for (const stop of loc.stops) {
      openDeficiencyCount += openDeficiencySummaries(stop.deficiency_summaries).length
    }
  }
  return {
    stopCount,
    locationCount: locations.length,
    multiSiteLocationCount,
    openDeficiencyCount,
  }
}

export function filterRunDetailPrepRows<T extends RunDetailPrepRow>(
  rows: T[],
  searchQuery: string,
): T[] {
  const q = searchQuery.trim().toLowerCase()
  if (!q) return rows
  return rows.filter(({ stop, locationLabel }) => {
    const stopNum = String(stop.stop_number ?? '')
    const siteLabel = (stop.label || '').trim().toLowerCase()
    return (
      locationLabel.toLowerCase().includes(q) ||
      stopNum.includes(q) ||
      siteLabel.includes(q)
    )
  })
}

export function flattenRunDetailPrepRows(locations: MonthlyRunDetailLocation[]): RunDetailPrepRow[] {
  const rows: RunDetailPrepRow[] = []
  for (const location of locations) {
    const siteCount = location.stops.length
    for (const stop of location.stops) {
      rows.push({
        stop,
        locationLabel: location.location_label,
        siteCount,
      })
    }
  }
  rows.sort((a, b) => {
    const na = a.stop.stop_number || 0
    const nb = b.stop.stop_number || 0
    if (na !== nb) return na - nb
    return a.stop.testing_site_id - b.stop.testing_site_id
  })
  return rows
}

export function orderedLocationIdsFromPrepRows(rows: RunDetailPrepRow[]): number[] {
  const seen = new Set<number>()
  const ids: number[] = []
  for (const row of rows) {
    const locationId = row.stop.location_id
    if (!seen.has(locationId)) {
      seen.add(locationId)
      ids.push(locationId)
    }
  }
  return ids
}

export function reorderPrepRowsByLocationIds(
  rows: RunDetailPrepRow[],
  orderedLocationIds: number[],
): RunDetailPrepRow[] {
  const byLocation = new Map<number, RunDetailPrepRow[]>()
  for (const row of rows) {
    const locationId = row.stop.location_id
    const bucket = byLocation.get(locationId)
    if (bucket) bucket.push(row)
    else byLocation.set(locationId, [row])
  }
  const reordered: RunDetailPrepRow[] = []
  for (const locationId of orderedLocationIds) {
    reordered.push(...(byLocation.get(locationId) ?? []))
  }
  return reordered
}

export function renumberPrepRowStopNumbers(rows: RunDetailPrepRow[]): RunDetailPrepRow[] {
  let stopNumber = 1
  return rows.map((row) => ({
    ...row,
    stop: {
      ...row.stop,
      stop_number: stopNumber++,
    },
  }))
}

/** Reorder run-details location groups after ``PUT …/location_order`` (library stop order). */
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
    const stops = loc.stops.map((stop) => ({
      ...stop,
      stop_number: stopNumber++,
    }))
    const first = stops[0]?.stop_number ?? 0
    const last = stops[stops.length - 1]?.stop_number ?? first
    out.push({
      ...loc,
      stops,
      first_stop_number: first,
      last_stop_number: last,
    })
  }
  return out
}

export function runDetailLocationOrderMatches(
  locations: MonthlyRunDetailLocation[],
  orderedLocationIds: number[],
): boolean {
  const current: number[] = []
  const seen = new Set<number>()
  for (const loc of locations) {
    if (!seen.has(loc.location_id)) {
      seen.add(loc.location_id)
      current.push(loc.location_id)
    }
  }
  return (
    current.length === orderedLocationIds.length &&
    current.every((id, index) => id === orderedLocationIds[index])
  )
}

function normalizePrepAddressLabel(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Testing site ids whose out-of-order pill is satisfied by the new library order. */
export function testingSiteIdsToDismissOutOfOrderAfterReorder(
  rows: RunDetailPrepRow[],
  orderedLocationIds: number[],
): number[] {
  if (orderedLocationIds.length < 2) return []

  const labelByLocationId = new Map<number, string>()
  for (const row of rows) {
    const locationId = row.stop.location_id
    if (!labelByLocationId.has(locationId)) {
      labelByLocationId.set(locationId, normalizePrepAddressLabel(row.locationLabel))
    }
  }
  const indexByLocationId = new Map(
    orderedLocationIds.map((locationId, index) => [locationId, index]),
  )

  const toDismiss: number[] = []
  for (const row of rows) {
    const stop = row.stop
    if (!stop.prior_month_out_of_order || stop.prior_month_out_of_order_dismissed) continue
    const afterAddr = normalizePrepAddressLabel(stop.prior_month_tested_after_address || '')
    if (!afterAddr) continue

    const myIndex = indexByLocationId.get(stop.location_id)
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
      toDismiss.push(stop.testing_site_id)
    }
  }
  return toDismiss
}

export function applyOutOfOrderDismissalsToPrepRows(
  rows: RunDetailPrepRow[],
  orderedLocationIds: number[],
): RunDetailPrepRow[] {
  const dismissIds = new Set(testingSiteIdsToDismissOutOfOrderAfterReorder(rows, orderedLocationIds))
  if (dismissIds.size === 0) return rows
  return rows.map((row) => {
    if (!dismissIds.has(row.stop.testing_site_id)) return row
    return {
      ...row,
      stop: {
        ...row.stop,
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
  const dismissIds = new Set(testingSiteIdsToDismissOutOfOrderAfterReorder(rows, orderedLocationIds))
  if (dismissIds.size === 0) return locations
  return locations.map((location) => ({
    ...location,
    stops: location.stops.map((stop) =>
      dismissIds.has(stop.testing_site_id)
        ? {
            ...stop,
            prior_month_out_of_order: false,
            prior_month_tested_after_address: null,
            prior_month_out_of_order_dismissed: true,
          }
        : stop,
    ),
  }))
}

export function priorMonthOutOfOrderHint(
  stop: Pick<
    MonthlyRunDetailLocationStop,
    'prior_month_out_of_order' | 'prior_month_tested_after_address'
  >,
): { title: string; detail: string | null } | null {
  if (!stop.prior_month_out_of_order) return null
  const testedAfter = (stop.prior_month_tested_after_address || '').trim()
  return {
    title: 'Out of order last run',
    detail: testedAfter ? `Was tested after ${testedAfter} last month` : null,
  }
}

export function priorMonthNewToRouteHint(
  stop: Pick<MonthlyRunDetailLocationStop, 'prior_month_new_to_route'>,
): { title: string; detail: string | null } | null {
  if (!stop.prior_month_new_to_route) return null
  return {
    title: 'New to route',
    detail: 'Not on last month\'s route',
  }
}

export function flattenRunDetailReviewRows(
  locations: MonthlyRunDetailLocation[],
): RunDetailReviewRow[] {
  const rows: RunDetailReviewRow[] = []
  const sortedLocations = [...locations].sort(
    (a, b) =>
      (a.first_stop_number || 0) - (b.first_stop_number || 0) ||
      a.location_id - b.location_id,
  )
  for (const location of sortedLocations) {
    const siteCount = location.stops.length
    const stops = [...location.stops].sort(
      (a, b) => (a.stop_number || 0) - (b.stop_number || 0) || a.testing_site_id - b.testing_site_id,
    )
    for (const stop of stops) {
      rows.push({
        stop,
        locationLabel: location.location_label,
        siteCount,
        locationId: location.location_id,
        billingStatus: location.billing_status,
        openTickets: location.attention_flags.open_tickets ?? 0,
      })
    }
  }
  return rows
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

function stopOutcomeRank(stop: MonthlyRunDetailLocationStop, locationLabel: string, monthDate: string): number {
  const ws = locationStopAsWorksheetStop(stop, locationLabel)
  const outcome = stopPortalOutcome(ws)
  if (outcome && OUTCOME_RANK[outcome] != null) return OUTCOME_RANK[outcome]
  return OUTCOME_RANK[officeStopStatus(ws, monthDate)] ?? 0
}

export function locationWorstOutcomeRank(location: MonthlyRunDetailLocation, monthDate: string): number {
  let max = 0
  for (const stop of location.stops) {
    max = Math.max(max, stopOutcomeRank(stop, location.location_label, monthDate))
  }
  return max
}

export type LocationIdentityTone =
  | 'all_good'
  | 'skipped'
  | 'annual'
  | 'passed_with_problems'
  | 'failed'
  | 'neutral'

function stopIdentityTone(
  stop: MonthlyRunDetailLocationStop,
  locationLabel: string,
  monthDate: string,
): LocationIdentityTone {
  const ws = locationStopAsWorksheetStop(stop, locationLabel)
  const outcome = stopPortalOutcome(ws)
  if (outcome === 'failed') return 'failed'
  if (outcome === 'passed_with_problems') return 'passed_with_problems'
  if (outcome === 'skipped') {
    return runReviewStopIsAnnualSkip(ws, monthDate) ? 'annual' : 'skipped'
  }
  if (outcome === 'all_good') return 'all_good'
  const status = officeStopStatus(ws, monthDate)
  if (status === 'annual') return 'annual'
  if (status === 'skipped') return 'skipped'
  if (status === 'tested') return 'all_good'
  return 'neutral'
}

/** Background tone for the location identity column (worst stop on the card). */
export function locationIdentityTone(
  location: MonthlyRunDetailLocation,
  monthDate: string,
): LocationIdentityTone {
  let tone: LocationIdentityTone = 'neutral'
  let bestRank = -1
  const toneRank: Record<LocationIdentityTone, number> = {
    neutral: 0,
    all_good: 2,
    skipped: 3,
    annual: 3,
    passed_with_problems: 4,
    failed: 5,
  }
  for (const stop of location.stops) {
    const rank = stopOutcomeRank(stop, location.location_label, monthDate)
    if (rank > bestRank) {
      bestRank = rank
      tone = stopIdentityTone(stop, location.location_label, monthDate)
    } else if (rank === bestRank) {
      const next = stopIdentityTone(stop, location.location_label, monthDate)
      if (toneRank[next] > toneRank[tone]) tone = next
    }
  }
  return tone
}

/** Primary outcome pill for the location identity column (worst stop on the card). */
export function locationPrimaryOutcomeDisplay(
  location: MonthlyRunDetailLocation,
  monthDate: string,
): { headline: string; badgeClass: string } | null {
  let bestStop: MonthlyRunDetailLocationStop | null = null
  let bestRank = -1
  for (const stop of location.stops) {
    const rank = stopOutcomeRank(stop, location.location_label, monthDate)
    if (rank > bestRank) {
      bestRank = rank
      bestStop = stop
    }
  }
  if (bestStop == null) return null
  const card = buildStopCardFromLocation(location, bestStop, monthDate)
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
  return location.stops.every((stop) => {
    const card = buildStopCardFromLocation(location, stop, monthDate)
    return cardIsTestedOnly(card) && !cardHasFieldEdits(card)
  })
}

export function locationMatchesFilter(
  location: MonthlyRunDetailLocation,
  filter: RunLocationReviewFilter,
  monthDate: string,
): boolean {
  if (filter === 'needs_attention') return location.attention_flags.needs_attention
  if (filter === 'billing_unset') return location.attention_flags.billing_unset
  if (filter === 'submitted') return locationHasAllStopsSubmitted(location)
  if (filter === 'all') return true
  if (filter === 'updated') return location.attention_flags.has_field_edits
  return location.stops.some((stop) => {
    const ws = locationStopAsWorksheetStop(stop, location.location_label)
    return stopMatchesOutcomeFilter(ws, monthDate, filter as PortalTestOutcome)
  })
}

export function filterRunDetailLocations(
  locations: MonthlyRunDetailLocation[],
  filter: RunLocationReviewFilter,
  monthDate: string,
): MonthlyRunDetailLocation[] {
  if (filter === 'all') return locations
  return locations.filter((loc) => locationMatchesFilter(loc, filter, monthDate))
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
  for (const stop of location.stops) {
    if (normComment(stop.run_comments)) return true
    const ws = locationStopAsWorksheetStop(stop, location.location_label)
    if (officeStopStatus(ws, monthDate) === 'annual' && !normComment(stop.annual_month)) {
      return true
    }
    if (normComment(stop.testing_procedures) && stop.testing_procedures!.length > 120) {
      return true
    }
    if (normComment(stop.inspection_tech_notes) && stop.inspection_tech_notes!.length > 120) {
      return true
    }
  }
  return false
}

export function stopCardsForLocation(
  location: MonthlyRunDetailLocation,
  monthDate: string,
): NotableStopChangeCard[] {
  return location.stops.map((stop) => buildStopCardFromLocation(location, stop, monthDate))
}

export function locationMatchesOutcomeKpi(
  location: MonthlyRunDetailLocation,
  filter: RunReviewFilter,
  monthDate: string,
): boolean {
  if (filter === 'all' || filter === 'updated') return false
  return location.stops.some((stop) => {
    const card = buildStopCardFromLocation(location, stop, monthDate)
    return cardMatchesRunReviewFilter(card, filter, monthDate)
  })
}

function stopHasActiveDeficiencies(stop: MonthlyRunDetailLocationStop): boolean {
  if (stop.has_active_deficiencies) return true
  return (stop.deficiency_summaries?.length ?? 0) > 0
}

function stopNeedsAttentionExcludingBilling(
  stop: MonthlyRunDetailLocationStop,
  locationLabel: string,
  monthDate: string,
): boolean {
  if (stopHasActiveDeficiencies(stop)) return true
  const ws = locationStopAsWorksheetStop(stop, locationLabel)
  const outcome = stopPortalOutcome(ws)
  if (outcome === 'failed' || outcome === 'passed_with_problems') return true
  if (officeStopStatus(ws, monthDate) === 'skipped') return true
  return false
}

/** Recompute attention flags after a billing status change (mirrors server _location_attention_flags). */
export function recomputeLocationAttentionFlags(
  location: MonthlyRunDetailLocation,
  monthDate: string,
  billingStatus: string | null,
): MonthlyRunDetailLocation['attention_flags'] {
  const billingNorm = (billingStatus || '').trim().toLowerCase()
  const billing_unset = billingNorm === '' || billingNorm === 'unset' || billingStatus == null
  const has_active_deficiencies = location.stops.some(stopHasActiveDeficiencies)
  const has_job_comment = location.stops.some((stop) => normComment(stop.run_comments).length > 0)
  let needs_attention = billing_unset || has_active_deficiencies
  if (!needs_attention) {
    needs_attention = location.stops.some((stop) =>
      stopNeedsAttentionExcludingBilling(stop, location.location_label, monthDate),
    )
  }
  return {
    billing_unset,
    has_field_edits: location.attention_flags.has_field_edits,
    has_active_deficiencies,
    has_job_comment,
    needs_attention,
  }
}

/** Optimistic update for ``MonthlyRouteRun.pre_run_message``. */
export function patchRunDetailPreRunMessage(
  run: TechnicianWorksheetRun,
  preRunMessage: string | null,
): TechnicianWorksheetRun {
  const text = (preRunMessage ?? '').trim()
  return { ...run, pre_run_message: text.length > 0 ? text : null }
}

/** Merge a workflow lifecycle response onto the run-details payload (no refetch). */
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

/** Update ``runs_by_month`` after a workflow action without refetching route detail. */
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

/** Optimistic update for one stop; recomputes location attention flags (e.g. job comment). */
export function patchRunDetailLocationStop(
  locations: MonthlyRunDetailLocation[],
  testingSiteId: number,
  monthDate: string,
  patch: Partial<MonthlyRunDetailLocationStop>,
): MonthlyRunDetailLocation[] {
  return locations.map((loc) => {
    if (!loc.stops.some((stop) => stop.testing_site_id === testingSiteId)) return loc
    const stops = loc.stops.map((stop) =>
      stop.testing_site_id === testingSiteId ? { ...stop, ...patch } : stop,
    )
    const next = { ...loc, stops }
    return {
      ...next,
      attention_flags: recomputeLocationAttentionFlags(next, monthDate, loc.billing_status),
    }
  })
}

/** @deprecated Use ``patchRunDetailLocationStop`` */
export function patchRunDetailStopFields(
  locations: MonthlyRunDetailLocation[],
  testingSiteId: number,
  patch: Partial<MonthlyRunDetailLocationStop>,
): MonthlyRunDetailLocation[] {
  const monthDate = locations[0]?.stops[0]?.month_date ?? ''
  return patchRunDetailLocationStop(locations, testingSiteId, monthDate, patch)
}

/** Apply a billing PATCH result to the run-details locations list without refetching. */
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
