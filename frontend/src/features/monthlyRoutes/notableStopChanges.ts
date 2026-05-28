import type { TechnicianWorksheetStop } from './monthlyRoutesShared'
import {
  runReviewOutcomeBadgeClass,
  runReviewOutcomeHeadline,
  stopHasOutcomeOnlyReview,
  stopMatchesOutcomeFilter,
  stopPortalOutcome,
} from './officeRunReviewShared'
import type { PortalTestOutcome } from './portalWorkflowShared'
import {
  auditFieldDisplayLabel,
  fieldChangesForLocation,
  formatOfficeAuditValue,
  officeStopStatus,
  officeStopStatusLabel,
  stopHasRunComments,
  worksheetReadOnlyDisplay,
  worksheetSkipReasonDisplayBlock,
  type OfficeFieldChange,
} from './officeWorksheetTableShared'

export type NotableChangeDisplayKind =
  | 'field'
  | 'field_added'
  | 'field_removed'
  | 'status'
  | 'comment_added'

/** Display value treated as empty (cleared field). */
export function isEmptyDisplayValue(value: string): boolean {
  return value === '—' || value.trim() === ''
}

export type NotableChangeItem = {
  id: string
  kind: NotableChangeDisplayKind
  label: string
  before: string | null
  after: string
}

export type RunReviewCardKind = 'with_changes' | 'tested_only'

export type NotableStopChangeCard = {
  stop: TechnicianWorksheetStop
  stopNumber: number
  displayAddress: string
  locationId: number
  siteLabel: string
  siteIndex: number
  siteCount: number
  reviewKind: RunReviewCardKind
  /** Shown inline with stop # and address (not duplicated in the change list). */
  resultHeadline: string | null
  changes: NotableChangeItem[]
}

/** Inline result text for run-review card headers. */
export function runReviewResultHeadline(
  stop: TechnicianWorksheetStop,
  monthDate: string,
): string | null {
  return runReviewOutcomeHeadline(stop, monthDate)
}

export function runReviewResultHeadlineClass(
  stop: TechnicianWorksheetStop,
  monthDate: string,
): string {
  return runReviewOutcomeBadgeClass(stop, monthDate)
}

/** True when the stop was skipped for a reason other than annual (run-review card highlight). */
export function isNonAnnualSkippedStop(
  stop: TechnicianWorksheetStop,
  monthDate: string,
): boolean {
  return officeStopStatus(stop, monthDate) === 'skipped'
}

const CHANGE_LABEL_ORDER: readonly string[] = [
  'Building',
  'PMC',
  'Ring',
  'Key #',
  'Door code',
  'Annual',
  'Panel',
  'Panel location',
  'Company',
  'Notes',
  'Testing procedures',
  'Location comments',
  'Job comment',
  'Result',
]

function changeSortIndex(label: string): number {
  const i = CHANGE_LABEL_ORDER.indexOf(label)
  return i >= 0 ? i : CHANGE_LABEL_ORDER.length
}

function sortChanges(items: NotableChangeItem[]): NotableChangeItem[] {
  return [...items].sort(
    (a, b) => changeSortIndex(a.label) - changeSortIndex(b.label) || a.label.localeCompare(b.label),
  )
}

function collectAuditedFieldChanges(
  locationId: number,
  fieldChangesByLocation?: Map<number, OfficeFieldChange[]>,
): NotableChangeItem[] {
  const changes = fieldChangesForLocation(locationId, fieldChangesByLocation)
  const seen = new Set<string>()
  const items: NotableChangeItem[] = []
  for (const change of changes) {
    const label = auditFieldDisplayLabel(change.field_name)
    if (seen.has(label)) continue
    seen.add(label)
    const before = formatOfficeAuditValue(change.old_value)
    const after = formatOfficeAuditValue(change.new_value)
    const emptyBefore = isEmptyDisplayValue(before)
    const emptyAfter = isEmptyDisplayValue(after)
    let kind: NotableChangeItem['kind'] = 'field'
    if (!emptyBefore && emptyAfter) kind = 'field_removed'
    else if (emptyBefore && !emptyAfter) kind = 'field_added'
    items.push({
      id: `field:${label}`,
      kind,
      label,
      before,
      after,
    })
  }
  return items
}

function collectStatusChange(
  stop: TechnicianWorksheetStop,
  monthDate: string,
): NotableChangeItem | null {
  const status = officeStopStatus(stop, monthDate)
  if (status !== 'skipped' && status !== 'annual') return null
  const skipBlock = worksheetSkipReasonDisplayBlock(stop.skip_reason)
  let after = officeStopStatusLabel(status)
  if (skipBlock && skipBlock !== '—') {
    after = `${after} · ${skipBlock}`
  }
  return {
    id: 'status',
    kind: 'status',
    label: 'Result',
    before: null,
    after,
  }
}

function collectCommentAdded(
  stop: TechnicianWorksheetStop,
  locationId: number,
  fieldChangesByLocation?: Map<number, OfficeFieldChange[]>,
): NotableChangeItem | null {
  const hasAudit = fieldChangesForLocation(locationId, fieldChangesByLocation).some(
    (c) => c.field_name === 'run_comments',
  )
  if (hasAudit || !stopHasRunComments(stop)) return null
  return {
    id: 'comment-added',
    kind: 'comment_added',
    label: 'Job comment',
    before: null,
    after: worksheetReadOnlyDisplay(stop.run_comments),
  }
}

/** Build per-stop change rows for run-details summary (deltas only). */
export function collectNotableStopChanges(
  stop: TechnicianWorksheetStop,
  monthDate: string,
  fieldChangesByLocation?: Map<number, OfficeFieldChange[]>,
  siteIndex = 1,
  siteCount = 1,
): NotableStopChangeCard {
  const lid = stop.location_id
  const items: NotableChangeItem[] = [
    ...collectAuditedFieldChanges(lid, fieldChangesByLocation),
    ...[collectStatusChange(stop, monthDate)].filter((x): x is NotableChangeItem => x != null),
    ...[collectCommentAdded(stop, lid, fieldChangesByLocation)].filter(
      (x): x is NotableChangeItem => x != null,
    ),
  ]
  const siteLabel = (stop.label || '').trim() || 'Primary testing location'
  const allChanges = sortChanges(items)
  const changes = allChanges.filter((item) => item.id !== 'status')
  const reviewKind: RunReviewCardKind =
    changes.length === 0 && stopHasOutcomeOnlyReview(stop, monthDate)
      ? 'tested_only'
      : 'with_changes'
  return {
    stop,
    stopNumber: stop.stop_number,
    displayAddress: stop.display_address,
    locationId: lid,
    siteLabel,
    siteIndex,
    siteCount,
    reviewKind,
    resultHeadline: runReviewResultHeadline(stop, monthDate),
    changes,
  }
}

function stopsAtLocation(stops: TechnicianWorksheetStop[], locationId: number): TechnicianWorksheetStop[] {
  return stops
    .filter((s) => s.location_id === locationId)
    .sort((a, b) => a.testing_site_id - b.testing_site_id)
}

export const RUN_REVIEW_TESTED_GROUP_DOM_ID = 'run-review-tested-only-group'

export const RUN_REVIEW_EXPAND_CARD_EVENT = 'run-review:expand-card'

export function dispatchRunReviewExpandCard(domId: string): void {
  window.dispatchEvent(new CustomEvent(RUN_REVIEW_EXPAND_CARD_EVENT, { detail: { domId } }))
}

export type RunReviewCardTier = 'tested_only' | 'standard' | 'attention'

export type RunReviewChangeGroupKey = 'site_details' | 'comments'

export type RunReviewChangeGroup = {
  key: RunReviewChangeGroupKey
  title: string
  items: NotableChangeItem[]
}

const COMMENT_CHANGE_LABELS = new Set<string>(['Location comments', 'Job comment'])

export function runReviewCardTier(
  card: NotableStopChangeCard,
  monthDate: string,
): RunReviewCardTier {
  if (cardIsTestedOnly(card)) return 'tested_only'
  const status = officeStopStatus(card.stop, monthDate)
  if (status === 'skipped' || status === 'annual') return 'standard'
  if (cardHasFieldEdits(card)) return 'attention'
  return 'standard'
}

export function partitionRunReviewCards(
  cards: NotableStopChangeCard[],
  monthDate: string,
): { attentionAndStandard: NotableStopChangeCard[]; testedOnly: NotableStopChangeCard[] } {
  const attentionAndStandard: NotableStopChangeCard[] = []
  const testedOnly: NotableStopChangeCard[] = []
  for (const card of cards) {
    if (runReviewCardTier(card, monthDate) === 'tested_only') {
      testedOnly.push(card)
    } else {
      attentionAndStandard.push(card)
    }
  }
  return { attentionAndStandard, testedOnly }
}

export function groupNotableChanges(changes: NotableChangeItem[]): RunReviewChangeGroup[] {
  const siteDetails: NotableChangeItem[] = []
  const comments: NotableChangeItem[] = []
  for (const item of changes) {
    if (COMMENT_CHANGE_LABELS.has(item.label)) {
      comments.push(item)
    } else {
      siteDetails.push(item)
    }
  }
  const groups: RunReviewChangeGroup[] = []
  if (siteDetails.length > 0) {
    groups.push({ key: 'site_details', title: 'Site details', items: siteDetails })
  }
  if (comments.length > 0) {
    groups.push({ key: 'comments', title: 'Comments', items: comments })
  }
  return groups
}

export type RunReviewSummary = {
  stopCount: number
  outcomeOnlyCount: number
  allGoodCount: number
  passedWithProblemsCount: number
  failedCount: number
  skippedCount: number
  updatedCount: number
}

export function runReviewStopDomId(card: NotableStopChangeCard): string {
  return `run-review-stop-${card.locationId}-${card.stop.testing_site_id}`
}

export function cardIsTestedOnly(card: NotableStopChangeCard): boolean {
  return card.reviewKind === 'tested_only'
}

export function cardHasFieldEdits(card: NotableStopChangeCard): boolean {
  return card.changes.length > 0
}

export function cardNeedsReview(card: NotableStopChangeCard, monthDate: string): boolean {
  if (cardIsTestedOnly(card)) return false
  return cardHasFieldEdits(card) || isNonAnnualSkippedStop(card.stop, monthDate)
}

export type RunReviewFilter =
  | 'all'
  | 'all_good'
  | 'passed_with_problems'
  | 'failed'
  | 'skipped'
  | 'updated'

export function cardMatchesRunReviewFilter(
  card: NotableStopChangeCard,
  filter: RunReviewFilter,
  monthDate: string,
): boolean {
  if (filter === 'all') return true
  if (filter === 'updated') return cardHasFieldEdits(card)
  if (
    filter === 'all_good' ||
    filter === 'passed_with_problems' ||
    filter === 'failed' ||
    filter === 'skipped'
  ) {
    return stopMatchesOutcomeFilter(card.stop, monthDate, filter as PortalTestOutcome)
  }
  return true
}

export function filterRunReviewCards(
  cards: NotableStopChangeCard[],
  filter: RunReviewFilter,
  monthDate: string,
): NotableStopChangeCard[] {
  if (filter === 'all') return cards
  return cards.filter((card) => cardMatchesRunReviewFilter(card, filter, monthDate))
}

export function summarizeRunReviewCards(
  cards: NotableStopChangeCard[],
  monthDate: string,
): RunReviewSummary {
  let outcomeOnlyCount = 0
  let allGoodCount = 0
  let passedWithProblemsCount = 0
  let failedCount = 0
  let skippedCount = 0
  let updatedCount = 0
  for (const card of cards) {
    if (cardIsTestedOnly(card)) outcomeOnlyCount += 1
    if (cardHasFieldEdits(card)) updatedCount += 1
    const outcome = stopPortalOutcome(card.stop)
    if (outcome === 'all_good' || (!outcome && officeStopStatus(card.stop, monthDate) === 'tested')) {
      allGoodCount += 1
    } else if (outcome === 'passed_with_problems') {
      passedWithProblemsCount += 1
    } else if (outcome === 'failed') {
      failedCount += 1
    } else if (
      outcome === 'skipped' ||
      officeStopStatus(card.stop, monthDate) === 'skipped' ||
      officeStopStatus(card.stop, monthDate) === 'annual'
    ) {
      skippedCount += 1
    }
  }
  return {
    stopCount: cards.length,
    outcomeOnlyCount,
    allGoodCount,
    passedWithProblemsCount,
    failedCount,
    skippedCount,
    updatedCount,
  }
}

/** One card per notable stop, ordered by route stop number. */
export function buildNotableStopChangeCards(
  stops: TechnicianWorksheetStop[],
  monthDate: string,
  fieldChangesByLocation?: Map<number, OfficeFieldChange[]>,
): NotableStopChangeCard[] {
  const ordered = [...stops].sort((a, b) => {
    const aNum = Number.isFinite(a.stop_number) ? a.stop_number : Number.MAX_SAFE_INTEGER
    const bNum = Number.isFinite(b.stop_number) ? b.stop_number : Number.MAX_SAFE_INTEGER
    return aNum - bNum || a.location_id - b.location_id || a.testing_site_id - b.testing_site_id
  })
  const locationCounts = new Map<number, number>()
  for (const stop of ordered) {
    locationCounts.set(stop.location_id, (locationCounts.get(stop.location_id) ?? 0) + 1)
  }
  return ordered.map((stop) => {
    const atLocation = stopsAtLocation(ordered, stop.location_id)
    const siteIndex = atLocation.findIndex((s) => s.testing_site_id === stop.testing_site_id) + 1
    const siteCount = locationCounts.get(stop.location_id) ?? 1
    return collectNotableStopChanges(stop, monthDate, fieldChangesByLocation, siteIndex, siteCount)
  })
}
