/** Portal workflow UI helpers (clock events, test outcomes, dock bands). */

import {
  officeStopStatus,
  worksheetSkipReasonDisplayBlock,
  worksheetStopIsAnnualSkip,
} from './officeWorksheetTableShared'
import {
  isAnnualForMonth,
  worksheetLocationIsOpenClockIn,
  worksheetLocationOnHoldPendingOutcome,
  worksheetLocationSkipIsAnnual,
  type TechnicianWorksheetLocation,
} from './monthlyRoutesShared'
import { stopScheduledAnnualAutoSkipActive } from './prepAnnualSchedule'

export type PortalTestOutcome = 'all_good' | 'passed_with_problems' | 'failed' | 'skipped'

export type PortalSkipCategory =
  | 'access_issues'
  | 'construction'
  | 'lack_of_time'
  | 'testing_not_required'
  | 'other'
  | 'annual'

export type PortalDockBand = 'A' | 'B' | 'C'

export type PortalClockEvent = {
  id: number
  sort_order: number
  time_in: string
  time_out: string | null
  created_by_tech_id?: string | null
  created_by_tech_name?: string | null
}

export type PortalDeficiencySummary = {
  id: number
  monthly_location_id: number
  created_run_id: number | null
  title: string
  severity: string
  status: string
  description: string | null
  verification_notes: string | null
  service_line?: string | null
  service_trade_deficiency_id?: number | null
  reported_by_tech_id?: string | null
  reported_by_tech_name?: string | null
  last_edited_by_tech_id?: string | null
  last_edited_by_tech_name?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export const SKIP_CATEGORIES: { value: PortalSkipCategory; label: string }[] = [
  { value: 'access_issues', label: 'Access issues' },
  { value: 'construction', label: 'Construction' },
  { value: 'lack_of_time', label: 'Lack of time' },
  { value: 'testing_not_required', label: 'Testing not required' },
  { value: 'other', label: 'Other' },
]

export const TEST_OUTCOME_OPTIONS: { value: PortalTestOutcome; label: string; variant: string }[] = [
  { value: 'all_good', label: 'All good', variant: 'success' },
  { value: 'passed_with_problems', label: 'Passed with problems', variant: 'warning' },
  { value: 'failed', label: 'Failed', variant: 'danger' },
  { value: 'skipped', label: 'Skip', variant: 'secondary' },
]

export const DEFICIENCY_SEVERITIES = [
  { value: 'inoperable', label: 'Inoperable' },
  { value: 'deficient', label: 'Deficient' },
  { value: 'suggested', label: 'Suggested' },
] as const

export const DEFICIENCY_STATUSES = [
  { value: 'new', label: 'New' },
  { value: 'verified', label: 'Verified' },
  { value: 'invalid', label: 'Invalid' },
  { value: 'fixed', label: 'Fixed' },
] as const

const EXPLICIT_TIME_VALUE_RE = /^\d{1,2}:\d{1,2}(:\d{1,2})?(\s*[ap]\.?m\.?)?$/i

function norm(s: string | null | undefined): string {
  return (s ?? '').trim()
}

export function stopHasClockEvents(stop: TechnicianWorksheetLocation): boolean {
  return Array.isArray(stop.clock_events) && stop.clock_events.length > 0
}

export function portalStopHasOpenClock(stop: TechnicianWorksheetLocation): boolean {
  if (stopHasClockEvents(stop)) {
    return (stop.clock_events ?? []).some((ev) => ev.time_in && !norm(ev.time_out))
  }
  const tin = norm(stop.time_in)
  const tout = norm(stop.time_out)
  if (!tin || tout) return false
  return EXPLICIT_TIME_VALUE_RE.test(tin)
}

export function portalStopHasTestOutcome(stop: TechnicianWorksheetLocation): boolean {
  return norm(stop.test_outcome).length > 0
}

/** Select value for office outcome dropdown; maps legacy result_status when test_outcome is unset. */
export const OFFICE_OUTCOME_PENDING_VALUE = '__pending__'

/** Office review only: skipped with annual classification (orange cell). */
export const OFFICE_OUTCOME_SKIPPED_ANNUAL_VALUE = 'skipped_annual'

export const OFFICE_OUTCOME_SKIPPED_ANNUAL_LABEL = 'Skipped (annual)'

/** Office review only: on-hold library stop with no tech outcome (orange cell). */
export const OFFICE_OUTCOME_ON_HOLD_VALUE = 'on_hold'

export const OFFICE_OUTCOME_ON_HOLD_LABEL = 'On hold'

function officeSkippedOutcomeSelectValue(stop: TechnicianWorksheetLocation): string {
  const month = norm(stop.month_date)
  if (month && worksheetStopIsAnnualSkip(stop, month)) {
    return OFFICE_OUTCOME_SKIPPED_ANNUAL_VALUE
  }
  return 'skipped'
}

export function officeOutcomeSelectValue(stop: TechnicianWorksheetLocation): string {
  if (portalStopHasTestOutcome(stop)) {
    const outcome = norm(stop.test_outcome).toLowerCase()
    if (outcome === 'skipped') return officeSkippedOutcomeSelectValue(stop)
    return outcome
  }
  const rs = norm(stop.result_status).toLowerCase()
  if (rs === 'tested') return 'all_good'
  if (rs === 'skipped') return officeSkippedOutcomeSelectValue(stop)
  const month = norm(stop.month_date)
  if (month) {
    const status = officeStopStatus(stop, month)
    if (status === 'annual') return OFFICE_OUTCOME_SKIPPED_ANNUAL_VALUE
    if (status === 'on_hold') return OFFICE_OUTCOME_ON_HOLD_VALUE
  }
  return OFFICE_OUTCOME_PENDING_VALUE
}

export function portalStopVisitComplete(stop: TechnicianWorksheetLocation): boolean {
  return portalStopHasTestOutcome(stop) && !portalStopHasOpenClock(stop)
}

/** True when the dock may offer Reset (optimistic or server run data on this stop). */
export function portalStopCanReset(stop: TechnicianWorksheetLocation): boolean {
  return Boolean(stop.has_run_changes) || portalStopHasOpenClock(stop)
}

export function optimisticResetStopPatch(): Partial<TechnicianWorksheetLocation> {
  return {
    test_outcome: null,
    skip_category: null,
    skip_note: null,
    clock_events: [],
    deficiencies: [],
    time_in: null,
    time_out: null,
    result_status: null,
    skip_reason: null,
    has_run_changes: false,
    is_legacy_outcome: false,
    confirmed_no_deficiencies: false,
  }
}

export function portalStopDockBand(
  stop: TechnicianWorksheetLocation,
  _clockedInElsewhere: boolean,
): PortalDockBand {
  if (portalStopHasOpenClock(stop)) return 'B'
  if (portalStopVisitComplete(stop)) return 'C'
  return 'A'
}

/** Pacific-style 12h clock string for optimistic portal clock patches. */
export function portalHhmmNow(): string {
  const d = new Date()
  const h = d.getHours() % 12 || 12
  const m = String(d.getMinutes()).padStart(2, '0')
  const ampm = d.getHours() < 12 ? 'AM' : 'PM'
  return `${h}:${m} ${ampm}`
}

export function optimisticClockInPatch(
  stop: TechnicianWorksheetLocation,
  timeIn: string = portalHhmmNow(),
): Partial<TechnicianWorksheetLocation> {
  if (portalStopHasOpenClock(stop)) {
    return {}
  }
  const events = [...(stop.clock_events ?? [])]
  const maxSort = events.reduce((m, ev) => Math.max(m, ev.sort_order), 0)
  return {
    clock_events: [
      ...events,
      { id: -Date.now(), sort_order: maxSort + 1, time_in: timeIn, time_out: null },
    ],
    time_in: timeIn,
    time_out: null,
    has_run_changes: true,
  }
}

export function optimisticClockOutPatch(
  stop: TechnicianWorksheetLocation,
  timeOut: string = portalHhmmNow(),
): Partial<TechnicianWorksheetLocation> {
  if (!portalStopHasOpenClock(stop)) {
    return {}
  }
  const events = (stop.clock_events ?? []).map((ev) =>
    ev.time_in && !norm(ev.time_out) ? { ...ev, time_out: timeOut } : ev,
  )
  return {
    clock_events: events.length ? events : stop.clock_events,
    time_out: timeOut,
    has_run_changes: true,
  }
}

export function optimisticCancelClockInPatch(
  stop: TechnicianWorksheetLocation,
): Partial<TechnicianWorksheetLocation> {
  if (!portalStopHasOpenClock(stop)) {
    return {}
  }
  const events = (stop.clock_events ?? []).filter((ev) => ev.time_out?.trim())
  const closed = events.filter((ev) => ev.time_out?.trim())
  const lastClosed = closed.length > 0 ? closed[closed.length - 1] : null
  return {
    clock_events: events,
    time_in: events.length ? events[0]?.time_in ?? null : null,
    time_out: lastClosed?.time_out ?? null,
  }
}

export function optimisticUpdateClockEventPatch(
  stop: TechnicianWorksheetLocation,
  clockEventId: number,
  patch: { time_in?: string; time_out?: string | null },
): Partial<TechnicianWorksheetLocation> {
  const events = (stop.clock_events ?? []).map((ev) => {
    if (ev.id !== clockEventId) return ev
    return {
      ...ev,
      ...(patch.time_in !== undefined ? { time_in: patch.time_in } : {}),
      ...(patch.time_out !== undefined ? { time_out: patch.time_out } : {}),
    }
  })
  const closed = events.filter((ev) => ev.time_out?.trim())
  const lastClosed = closed.length > 0 ? closed[closed.length - 1] : null
  const hasOpen = events.some((ev) => ev.time_in && !norm(ev.time_out))
  return {
    clock_events: events,
    time_in: events.length ? events[0]?.time_in ?? null : null,
    time_out: hasOpen ? null : lastClosed?.time_out ?? null,
    has_run_changes: true,
  }
}

/** Optimistic worksheet stop patch after the user picks a portal test outcome. */
export function optimisticOutcomePatch(
  stop: TechnicianWorksheetLocation,
  outcome: PortalTestOutcome,
  opts?: {
    skipCategory?: PortalSkipCategory
    skipNote?: string
    confirmedNoDeficiencies?: boolean
  },
): Partial<TechnicianWorksheetLocation> {
  const patch: Partial<TechnicianWorksheetLocation> = {
    test_outcome: outcome,
    is_legacy_outcome: false,
  }
  if (opts?.confirmedNoDeficiencies) {
    patch.confirmed_no_deficiencies = true
  }
  if (outcome === 'skipped') {
    patch.result_status = 'skipped'
    const cat = opts?.skipCategory ?? stop.skip_category
    const note = opts?.skipNote ?? stop.skip_note ?? ''
    patch.skip_category = cat
    patch.skip_note = note
    if (cat && note) patch.skip_reason = `${cat}: ${note}`
    else if (cat) patch.skip_reason = cat
    else patch.skip_reason = note || 'skipped'
  } else {
    patch.result_status = 'tested'
    patch.skip_reason = null
    patch.skip_category = null
    patch.skip_note = null
  }
  return patch
}

export function portalOutcomeDisplay(stop: TechnicianWorksheetLocation): string | null {
  if (stop.is_legacy_outcome && !portalStopHasTestOutcome(stop)) {
    const rs = norm(stop.result_status).toLowerCase()
    if (rs === 'tested') return 'Tested (legacy)'
    if (rs === 'skipped') return 'Skipped (legacy)'
    return null
  }
  const outcome = norm(stop.test_outcome).toLowerCase() as PortalTestOutcome
  const match = TEST_OUTCOME_OPTIONS.find((o) => o.value === outcome)
  if (match) return match.label
  if (outcome === 'skipped' && stop.skip_category) {
    if (stop.skip_category === 'annual' || worksheetLocationSkipIsAnnual(stop)) {
      return OFFICE_OUTCOME_SKIPPED_ANNUAL_LABEL
    }
    const cat = SKIP_CATEGORIES.find((c) => c.value === stop.skip_category)
    return cat ? `Skipped — ${cat.label}` : 'Skipped'
  }
  return null
}

function formatSnakeCaseLabel(key: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(key)) return key
  return key
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export function skipCategoryLabel(category: string | null | undefined): string {
  const raw = norm(category)
  if (!raw) return ''
  const c = raw.toLowerCase() as PortalSkipCategory
  if (c === 'annual') return 'Annual month'
  const known = SKIP_CATEGORIES.find((x) => x.value === c)
  if (known) return known.label
  if (/^[a-z][a-z0-9_]*$/.test(c)) return formatSnakeCaseLabel(c)
  return raw
}

/** Format stored skip_reason text (category key, ``key: note``, or free text). */
export function formatSkipReasonDisplayText(text: string | null | undefined): string | null {
  const raw = worksheetSkipReasonDisplayBlock(text)
  if (!raw || raw === '—') return null
  const colon = raw.indexOf(':')
  if (colon > 0) {
    const key = raw.slice(0, colon).trim()
    const rest = raw.slice(colon + 1).trim()
    const keyLabel = skipCategoryLabel(key)
    if (keyLabel !== key) {
      return rest ? `${keyLabel} · ${rest}` : keyLabel
    }
  }
  if (/^[a-z][a-z0-9_]*$/.test(raw.toLowerCase())) {
    return skipCategoryLabel(raw)
  }
  return raw
}

/** Category, free-text note, and legacy ``skip_reason`` for office / run-details display. */
export function portalSkipReasonDetail(stop: TechnicianWorksheetLocation): string | null {
  const catLabel = skipCategoryLabel(stop.skip_category)
  const note = norm(stop.skip_note)
  const legacyPart = formatSkipReasonDisplayText(stop.skip_reason) ?? ''
  const parts: string[] = []
  if (catLabel) parts.push(catLabel)
  if (note) parts.push(note)
  if (legacyPart) {
    const summary = parts.join(' · ').toLowerCase()
    const legacyLow = legacyPart.toLowerCase()
    const redundant =
      summary.length > 0 &&
      (legacyLow === summary ||
        legacyLow === `${norm(stop.skip_category).toLowerCase()}: ${note.toLowerCase()}` ||
        legacyLow === `${norm(stop.skip_category).toLowerCase()}: ${note}`)
    if (!redundant) parts.push(legacyPart)
  }
  return parts.length ? parts.join(' · ') : null
}

export function portalStopWorkflowReadOnly(stop: TechnicianWorksheetLocation, runCompleted: boolean): boolean {
  if (runCompleted) return true
  return Boolean(stop.portal_read_only)
}

const ACTIVE_DEFICIENCY_STATUSES = new Set(['new', 'verified'])

function deficiencyStatus(def: PortalDeficiencySummary): string {
  return norm(def.status).toLowerCase()
}

export function portalStopActiveDeficiencies(stop: TechnicianWorksheetLocation): PortalDeficiencySummary[] {
  return (stop.deficiencies ?? []).filter((d) => ACTIVE_DEFICIENCY_STATUSES.has(deficiencyStatus(d)))
}

export function portalStopNewDeficiencies(stop: TechnicianWorksheetLocation): PortalDeficiencySummary[] {
  return (stop.deficiencies ?? []).filter((d) => deficiencyStatus(d) === 'new')
}

/** True when the deficiency was logged on the active portal run (not a carry-over from a prior visit). */
export function deficiencyCreatedOnRun(
  def: PortalDeficiencySummary,
  runId: number | null | undefined,
): boolean {
  if (runId == null || def.created_run_id == null) return false
  return def.created_run_id === runId
}

/** New deficiencies from before this run — these must be verified before recording Failed / Passed with problems. */
export function portalStopNewDeficienciesFromPriorRuns(
  stop: TechnicianWorksheetLocation,
  runId: number | null | undefined,
): PortalDeficiencySummary[] {
  return portalStopNewDeficiencies(stop).filter((d) => !deficiencyCreatedOnRun(d, runId))
}

export function portalStopCanChooseAllGood(stop: TechnicianWorksheetLocation): boolean {
  return portalStopActiveDeficiencies(stop).length === 0
}

export function portalStopNeedsDeficiencyVerify(
  outcome: PortalTestOutcome,
  stop: TechnicianWorksheetLocation,
  runId?: number | null,
): boolean {
  if (outcome !== 'passed_with_problems' && outcome !== 'failed') return false
  return portalStopNewDeficienciesFromPriorRuns(stop, runId).length > 0
}

export function portalStopNeedsNoDeficiencyConfirm(
  outcome: PortalTestOutcome,
  stop: TechnicianWorksheetLocation,
): boolean {
  return outcome === 'passed_with_problems' && portalStopActiveDeficiencies(stop).length === 0
}

export function optimisticCreateDeficiencyPatch(
  stop: TechnicianWorksheetLocation,
  body: { title: string; severity: string; status: string; description?: string },
  runId: number | null | undefined,
): Partial<TechnicianWorksheetLocation> {
  const row: PortalDeficiencySummary = {
    id: -Date.now(),
    monthly_location_id: stop.location_id,
    created_run_id: runId ?? null,
    title: body.title,
    severity: body.severity,
    status: body.status,
    description: body.description ?? null,
    verification_notes: null,
  }
  const patch: Partial<TechnicianWorksheetLocation> = {
    deficiencies: [...(stop.deficiencies ?? []), row],
    has_run_changes: true,
    confirmed_no_deficiencies: false,
  }
  if (norm(stop.test_outcome).toLowerCase() === 'all_good') {
    patch.test_outcome = 'passed_with_problems'
  }
  return patch
}

export function optimisticUpdateDeficiencyPatch(
  stop: TechnicianWorksheetLocation,
  deficiencyId: number,
  body: { title?: string; severity?: string; status?: string; description?: string },
): Partial<TechnicianWorksheetLocation> {
  return {
    deficiencies: (stop.deficiencies ?? []).map((d) =>
      d.id === deficiencyId ? { ...d, ...body } : d,
    ),
    has_run_changes: true,
  }
}

export function optimisticVerifyDeficiencyPatch(
  stop: TechnicianWorksheetLocation,
  deficiencyId: number,
): Partial<TechnicianWorksheetLocation> {
  return {
    deficiencies: (stop.deficiencies ?? []).map((d) =>
      d.id === deficiencyId ? { ...d, status: 'verified' } : d,
    ),
    has_run_changes: true,
  }
}

/** Portal / field worksheet stop chrome (nav tile, header band, status pill). */
export type PortalStopVisualTone =
  | 'pending'
  | 'in_progress'
  | 'all_good'
  | 'passed_with_problems'
  | 'failed'
  | 'skipped'
  | 'annual'

export function portalStopVisualTone(
  stop: TechnicianWorksheetLocation,
  runMonthIso: string,
): PortalStopVisualTone {
  if (portalStopHasTestOutcome(stop)) {
    const outcome = norm(stop.test_outcome).toLowerCase()
    if (outcome === 'skipped') return 'skipped'
    if (outcome === 'passed_with_problems') return 'passed_with_problems'
    if (outcome === 'failed') return 'failed'
    return 'all_good'
  }
  if (stop.is_legacy_outcome) {
    const rs = norm(stop.result_status).toLowerCase()
    if (rs === 'tested') return 'all_good'
    if (rs === 'skipped') {
      if (stopScheduledAnnualAutoSkipActive(stop)) return 'annual'
      if (worksheetLocationSkipIsAnnual(stop) || isAnnualForMonth(stop.annual_month, runMonthIso)) {
        return 'pending'
      }
      return 'skipped'
    }
  }
  if (worksheetLocationIsOpenClockIn(stop)) return 'in_progress'
  if (stopScheduledAnnualAutoSkipActive(stop)) return 'annual'
  return 'pending'
}

export function portalStopHasOfficeJobComment(stop: TechnicianWorksheetLocation): boolean {
  return (stop.office_job_comment || '').trim().length > 0
}

export function portalStopOfficeAttentionActive(stop: TechnicianWorksheetLocation): boolean {
  if (portalStopHasTestOutcome(stop)) return false
  return Boolean(stop.office_attention) || portalStopHasOfficeJobComment(stop)
}

/** Yellow pre-color for library stops marked on hold (before a test outcome is recorded). */
export function portalStopOnHoldPrecolor(stop: TechnicianWorksheetLocation): boolean {
  return worksheetLocationOnHoldPendingOutcome(stop)
}

export function portalHeaderBandClass(stop: TechnicianWorksheetLocation, runMonthIso: string): string {
  const tone = portalStopVisualTone(stop, runMonthIso)
  if (tone === 'all_good') return 'pw-mock-header--tested'
  if (tone === 'passed_with_problems') return 'pw-mock-header--passed-problems'
  if (tone === 'failed') return 'pw-mock-header--failed'
  if (tone === 'skipped') return 'pw-mock-header--skipped'
  if (tone === 'annual') return 'pw-mock-header--annual'
  if (tone === 'in_progress') return 'pw-mock-header--progress'
  if (portalStopOnHoldPrecolor(stop)) return 'pw-mock-header--on-hold'
  if (portalStopOfficeAttentionActive(stop)) return 'pw-mock-header--office-attention'
  return ''
}

/** Key view row background — recorded test outcomes only (not pending / annual / clocked-in). */
export function portalKeyViewOutcomeStatusClass(stop: TechnicianWorksheetLocation): string {
  if (portalStopHasTestOutcome(stop)) {
    const outcome = norm(stop.test_outcome).toLowerCase()
    if (outcome === 'passed_with_problems') return 'pw-key-view-item--passed-problems'
    if (outcome === 'failed') return 'pw-key-view-item--failed'
    if (outcome === 'skipped') return 'pw-key-view-item--skipped'
    return 'pw-key-view-item--tested'
  }
  if (stop.is_legacy_outcome) {
    const rs = norm(stop.result_status).toLowerCase()
    if (rs === 'tested') return 'pw-key-view-item--tested'
    if (rs === 'skipped') return 'pw-key-view-item--skipped'
  }
  return ''
}

export function portalNavStopStatusClass(stop: TechnicianWorksheetLocation, runMonthIso: string): string {
  if (worksheetLocationIsOpenClockIn(stop)) return 'pw-mock-nav-stop--clocked-in'
  const tone = portalStopVisualTone(stop, runMonthIso)
  if (tone === 'all_good') return 'pw-mock-nav-stop--tested'
  if (tone === 'passed_with_problems') return 'pw-mock-nav-stop--passed-problems'
  if (tone === 'failed') return 'pw-mock-nav-stop--failed'
  if (tone === 'skipped') return 'pw-mock-nav-stop--skipped'
  if (tone === 'annual') return 'pw-mock-nav-stop--annual'
  if (portalStopOnHoldPrecolor(stop)) return 'pw-mock-nav-stop--on-hold'
  if (portalStopOfficeAttentionActive(stop)) return 'pw-mock-nav-stop--office-attention'
  return ''
}

/** Suffix for ``pw-mock-status-pill--*`` (e.g. ``passed-problems``). */
export function portalStatusPillClass(stop: TechnicianWorksheetLocation, runMonthIso: string): string {
  const tone = portalStopVisualTone(stop, runMonthIso)
  if (tone === 'all_good') return 'tested'
  if (tone === 'passed_with_problems') return 'passed-problems'
  if (tone === 'failed') return 'failed'
  if (tone === 'skipped') return 'skipped'
  if (tone === 'in_progress') return 'in_progress'
  return 'pending'
}

export const PORTAL_OUTCOME_VALIDATION_MESSAGES: Record<string, string> = {
  deficiencies_block_all_good:
    'Cannot record All good while deficiencies are New or Verified on this stop.',
  unverified_deficiencies:
    'Verify all pre-existing New deficiencies before recording this result.',
  confirmed_no_deficiencies_required:
    'Confirm that no deficiencies apply before recording Passed with problems.',
}
