import type { TechnicianWorksheetStop } from './monthlyRoutesShared'
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
  const status = officeStopStatus(stop, monthDate)
  if (status === 'tested') return 'Tested'
  if (status === 'annual') return 'Skipped due to Annual'
  if (status === 'skipped') {
    const skipBlock = worksheetSkipReasonDisplayBlock(stop.skip_reason)
    if (skipBlock && skipBlock !== '—') {
      return `Skipped · ${skipBlock}`
    }
    return 'Skipped'
  }
  return null
}

function resultHeadlineClass(status: ReturnType<typeof officeStopStatus>): string {
  if (status === 'tested') return 'run-detail-site-card__result--tested'
  if (status === 'annual') return 'run-detail-site-card__result--annual'
  if (status === 'skipped') return 'run-detail-site-card__result--skipped'
  return 'run-detail-site-card__result--pending'
}

export function runReviewResultHeadlineClass(
  stop: TechnicianWorksheetStop,
  monthDate: string,
): string {
  return resultHeadlineClass(officeStopStatus(stop, monthDate))
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
  const status = officeStopStatus(stop, monthDate)
  const reviewKind: RunReviewCardKind =
    changes.length === 0 && status === 'tested' ? 'tested_only' : 'with_changes'
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
