/** Portal workflow UI helpers (clock events, test outcomes, dock bands). */

import type { TechnicianWorksheetStop } from './monthlyRoutesShared'

export type PortalTestOutcome = 'all_good' | 'passed_with_problems' | 'failed' | 'skipped'

export type PortalSkipCategory =
  | 'access_issues'
  | 'construction'
  | 'lack_of_time'
  | 'testing_not_required'
  | 'other'

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
  monthly_testing_site_id: number
  created_run_id: number | null
  title: string
  severity: string
  status: string
  description: string | null
  verification_notes: string | null
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

export function stopHasClockEvents(stop: TechnicianWorksheetStop): boolean {
  return Array.isArray(stop.clock_events) && stop.clock_events.length > 0
}

export function portalStopHasOpenClock(stop: TechnicianWorksheetStop): boolean {
  if (stopHasClockEvents(stop)) {
    return (stop.clock_events ?? []).some((ev) => ev.time_in && !norm(ev.time_out))
  }
  const tin = norm(stop.time_in)
  const tout = norm(stop.time_out)
  if (!tin || tout) return false
  return EXPLICIT_TIME_VALUE_RE.test(tin)
}

export function portalStopHasTestOutcome(stop: TechnicianWorksheetStop): boolean {
  return norm(stop.test_outcome).length > 0
}

export function portalStopVisitComplete(stop: TechnicianWorksheetStop): boolean {
  return portalStopHasTestOutcome(stop) && !portalStopHasOpenClock(stop)
}

export function portalStopDockBand(
  stop: TechnicianWorksheetStop,
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
  stop: TechnicianWorksheetStop,
  timeIn: string = portalHhmmNow(),
): Partial<TechnicianWorksheetStop> {
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
  }
}

export function optimisticClockOutPatch(
  stop: TechnicianWorksheetStop,
  timeOut: string = portalHhmmNow(),
): Partial<TechnicianWorksheetStop> {
  if (!portalStopHasOpenClock(stop)) {
    return {}
  }
  const events = (stop.clock_events ?? []).map((ev) =>
    ev.time_in && !norm(ev.time_out) ? { ...ev, time_out: timeOut } : ev,
  )
  return {
    clock_events: events.length ? events : stop.clock_events,
    time_out: timeOut,
  }
}

export function optimisticCancelClockInPatch(
  stop: TechnicianWorksheetStop,
): Partial<TechnicianWorksheetStop> {
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

/** Optimistic worksheet stop patch after the user picks a portal test outcome. */
export function optimisticOutcomePatch(
  stop: TechnicianWorksheetStop,
  outcome: PortalTestOutcome,
  opts?: {
    skipCategory?: PortalSkipCategory
    skipNote?: string
    confirmedNoDeficiencies?: boolean
  },
): Partial<TechnicianWorksheetStop> {
  const patch: Partial<TechnicianWorksheetStop> = {
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

export function portalOutcomeDisplay(stop: TechnicianWorksheetStop): string | null {
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
    const cat = SKIP_CATEGORIES.find((c) => c.value === stop.skip_category)
    return cat ? `Skipped — ${cat.label}` : 'Skipped'
  }
  return null
}

export function skipCategoryLabel(category: string | null | undefined): string {
  const c = norm(category).toLowerCase() as PortalSkipCategory
  return SKIP_CATEGORIES.find((x) => x.value === c)?.label ?? category ?? ''
}

export function portalStopWorkflowReadOnly(stop: TechnicianWorksheetStop, runCompleted: boolean): boolean {
  if (runCompleted) return true
  return Boolean(stop.portal_read_only)
}

const ACTIVE_DEFICIENCY_STATUSES = new Set(['new', 'verified'])

function deficiencyStatus(def: PortalDeficiencySummary): string {
  return norm(def.status).toLowerCase()
}

export function portalStopActiveDeficiencies(stop: TechnicianWorksheetStop): PortalDeficiencySummary[] {
  return (stop.deficiencies ?? []).filter((d) => ACTIVE_DEFICIENCY_STATUSES.has(deficiencyStatus(d)))
}

export function portalStopNewDeficiencies(stop: TechnicianWorksheetStop): PortalDeficiencySummary[] {
  return (stop.deficiencies ?? []).filter((d) => deficiencyStatus(d) === 'new')
}

export function portalStopCanChooseAllGood(stop: TechnicianWorksheetStop): boolean {
  return portalStopActiveDeficiencies(stop).length === 0
}

export function portalStopNeedsDeficiencyVerify(
  outcome: PortalTestOutcome,
  stop: TechnicianWorksheetStop,
): boolean {
  if (outcome !== 'passed_with_problems' && outcome !== 'failed') return false
  return portalStopNewDeficiencies(stop).length > 0
}

export function portalStopNeedsNoDeficiencyConfirm(
  outcome: PortalTestOutcome,
  stop: TechnicianWorksheetStop,
): boolean {
  return outcome === 'passed_with_problems' && portalStopActiveDeficiencies(stop).length === 0
}

export const PORTAL_OUTCOME_VALIDATION_MESSAGES: Record<string, string> = {
  deficiencies_block_all_good:
    'Cannot record All good while deficiencies are New or Verified on this stop.',
  unverified_deficiencies: 'Verify all New deficiencies before recording this result.',
  confirmed_no_deficiencies_required:
    'Confirm that no deficiencies apply before recording Passed with problems.',
}
