/** Types and pure helpers shared by Monthly Routes library and map pages. */

import { bcStatHolidayName, isBcStatHoliday, isoFromUtcDate } from './bcStatHolidays'

export type MonthCell = {
  /** ``null`` when a history row exists but testing has not been recorded yet. */
  result_status: string | null
  skip_reason: string | null
  /** Office processor billing decision when set on history row. */
  billing_status?: string | null
  /** Monthly route when this month cell was saved (CSV / sheet capture); not necessarily ``monthly_route`` today. */
  test_monthly_route?: MonthlyRouteSummary | null
  /** Staff worksheet route id for this historical month, when it can be resolved. */
  worksheet_route_id?: number | null
  /** Run file id linked to this month cell, when present. */
  run_id?: number | null
}

/** Canonical monthly route entity (``MonthlyRoute``); aligns with ``monthly_route_id``. */
export type MonthlyRouteSummary = {
  id: number
  route_number: number
  /** Optional friendly label from ``MonthlyRoute.display_name`` (not used for logic). */
  display_name?: string | null
  weekday_iso: number
  week_occurrence: number
  label: string
  /** ServiceTrade route-level pseudo-location id when linked. */
  service_trade_route_location_id?: number | null
  /** Deep link to ServiceTrade web UI for that location (when id is set). */
  service_trade_route_location_url?: string | null
  /** Office note shown to technicians on the portal worksheet header. */
  technician_note?: string | null
  location_count?: number
}

/** Linked row from ``keys`` when ``key_id`` FK is set. */
export type LinkedKeySummary = {
  id: number
  keycode: string
  barcode: number | null
}

/** Canonical monitoring company linked to a monthly location. */
export type MonitoringCompanySummary = {
  id: number
  name: string | null
  primary_phone?: string | null
  secondary_phone?: string | null
  active?: boolean
}

/** Flat monthly library location (``MonthlyLocation``); one row per route stop. */
export type LibraryLocation = {
  id: number
  address: string
  display_address?: string | null
  /** Display name separate from navigation address. */
  label: string
  /** Building name from paperwork ``Name:`` lines; separate from label. */
  building_name?: string | null
  property_management_company: string | null
  notes: string | null
  billing_comments?: string | null
  price_per_month: number | null
  area: string | null
  start_up_date: string | null
  status_normalized: string
  status_raw?: string | null
  keys: string | null
  /** FK to ``keys``; nested ``key`` is populated when joined. */
  key_id?: number | null
  key?: LinkedKeySummary | null
  test_day: string | null
  annual_month: string | null
  latitude?: number | null
  longitude?: number | null
  barcode?: string | null
  /** FK to ``MonthlyRoute``; source of truth with ``monthly_route``. */
  monthly_route_id?: number | null
  monthly_route?: MonthlyRouteSummary | null
  /** 0-based stop index when on a monthly route. */
  route_stop_order?: number | null
  months: Record<string, MonthCell>
  ring_detail?: string | null
  facp_detail?: string | null
  panel?: string | null
  panel_location?: string | null
  door_code?: string | null
  testing_procedures?: string | null
  inspection_tech_notes?: string | null
  monitoring_company_id?: number | null
  monitoring_company?: MonitoringCompanySummary | null
  monitoring_account_number?: string | null
  monitoring_password?: string | null
  monitoring_notes?: string | null
  latest_run_comment?: string | null
  latest_run_comment_month?: string | null
  /** ServiceTrade building location id (real site, not route pseudo-location). */
  service_trade_site_location_id?: number | null
  service_trade_site_location_url?: string | null
}

/** Row from ``GET/PUT .../routes/:id`` locations list (no month grid). */
export type RouteLocationListItem = {
  id: number
  address: string
  display_address?: string | null
  label?: string | null
  building_name?: string | null
  status_normalized: string
  annual_month?: string | null
  latitude?: number | null
  longitude?: number | null
  route_stop_order: number | null
  monthly_route_id?: number | null
}

export type MonthlyRouteCalculatedPathStop = {
  id: number
  label: string
  address: string | null
  display_address: string | null
  latitude: number | null
  longitude: number | null
  route_stop_order: number | null
  has_coordinates: boolean
}

export type MonthlyRouteCalculatedPathPayload = {
  route: MonthlyRouteSummary
  profile: string
  provider: string
  status:
    | 'ok'
    | 'not_enough_coordinates'
    | 'mapbox_token_missing'
    | 'mapbox_error'
  cache_status: 'hit' | 'miss' | 'refreshed' | 'not_applicable'
  stop_signature: string
  stops: MonthlyRouteCalculatedPathStop[]
  missing_coordinate_stops: MonthlyRouteCalculatedPathStop[]
  waypoint_count: number
  geometry: { type: 'LineString'; coordinates: [number, number][] } | null
  distance_meters: number | null
  duration_seconds: number | null
  calculated_at: string | null
  error?: string
}

export type RouteGeocodeMissingRow = {
  id: number
  label: string
  address: string
}

export type RouteGeocodeMissingResult = {
  route_id: number
  attempted: number
  updated_count: number
  updated: RouteGeocodeMissingRow[]
  failed: RouteGeocodeMissingRow[]
}

export type LibraryLocationGeocodeResult = {
  location: LibraryLocation
  geocoded: boolean
  already_had_coordinates?: boolean
  error?: string
}

/** True when a library/route row has usable lat/lng for maps and directions. */
export function libraryLocationHasMapCoordinates(loc: {
  latitude?: number | null
  longitude?: number | null
}): boolean {
  return normalizeMapCoordinates(loc.latitude, loc.longitude) != null
}

/** Comment row from ``GET /api/monthly_routes/library/:id`` (newest first); comments remain on legacy routes. */
export type MonthlyLocationComment = {
  id: number
  body: string
  author_username: string | null
  created_at: string | null
  updated_at?: string | null
}

export type MonthlyLocationDetailPayload = {
  location: LibraryLocation
  comments: MonthlyLocationComment[]
  /** Distinct ``test_day`` values for route assignment dropdowns. */
  route_options?: string[]
}

/** One site listed under route monthly skip breakdown (detail API). */
export type RouteTestingSkippedSite = {
  id: number
  label: string
  /** Set for non-annual skips from ``monthly_route_test_history.skip_reason``. */
  skip_reason?: string | null
}

/** Sheet-derived counts per month from GET ``/api/monthly_routes/routes/:id``. */
export type RouteTestingMonthCell = {
  sites_tested_count: number
  /** Skipped rows whose ``skip_reason`` is not annual (annual skips are excluded). */
  skipped_non_annual_count: number
  skipped_annual_count: number
  skipped_non_annual_sites?: RouteTestingSkippedSite[]
  skipped_annual_sites?: RouteTestingSkippedSite[]
  /** Sum of ``price_per_month`` for locations with ``result_status === 'tested'`` that month (missing prices omitted). */
  tested_revenue_total?: number
  /** Tested rows with no ``price_per_month`` set for that month. */
  tested_sites_missing_price_count?: number
}

/** Matches ``MonthlyRouteSnapshot`` row / ``/api/monthly_specialists`` route entries. */
export type MonthlySpecialistTechRow = { tech_name?: string; jobs?: number; name?: string }

export type MonthlyRouteSpecialistsPayload = {
  location_id: number
  location_name: string
  completed_jobs_count: number
  top_technicians: MonthlySpecialistTechRow[]
  last_updated_at: string | null
}

/** One Pacific calendar month row from ``monthly_route_specialist_month``. Keys are ``YYYY-MM-01``. */
export type MonthlyRouteSpecialistMonthPayload = {
  top_technicians: MonthlySpecialistTechRow[]
  completed_jobs_attributed: number
  /** Pacific calendar date from ServiceTrade (appointment window / completion); ISO ``YYYY-MM-DD``. */
  route_tested_on?: string | null
  last_updated_at: string | null
}

/** ``MonthlyRouteRun`` header for one calendar month (run file exists). Keys ``YYYY-MM-01``. */
export type RouteRunMonthSummary = {
  run_id: number
  source: string
  status: string
  opened_at: string | null
  started_at: string | null
  completed_at: string | null
  workflow_stage?: string
  workflow_stage_label?: string
  /** Worksheet stops on this route for the run month (historical worksheet grain). */
  stops_on_route_count?: number
  /** Stops with a tested outcome; annual skips are excluded. */
  stops_tested_count?: number
}

export type MonthlyRouteDetailPayload = {
  route: MonthlyRouteSummary
  /** Stops on this route in driving order (from ``route_stop_order``). */
  locations: RouteLocationListItem[]
  comments: MonthlyLocationComment[]
  /** Sheet ledger counts from ``monthly_route_test_history`` (includes master sheet upload). */
  testing_by_month: Record<string, RouteTestingMonthCell>
  /** Run files only — CSV import, portal, or worksheet materialization. Keys ``YYYY-MM-01``. */
  runs_by_month: Record<string, RouteRunMonthSummary>
  /** Present when the route has a ServiceTrade route pseudo-location id; otherwise ``null``. */
  specialists: MonthlyRouteSpecialistsPayload | null
  /** Newest months first; month keys ``YYYY-MM-01``. */
  specialists_by_month: Record<string, MonthlyRouteSpecialistMonthPayload>
}

export type MonthlyRouteOverviewRow = {
  route: MonthlyRouteSummary
}

export type MonthlyRouteOverviewPayload = {
  routes: MonthlyRouteOverviewRow[]
}

const ROUTE_CALENDAR_WEEKDAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

export const MONTHLY_ROUTE_CALENDAR_WEEKDAY_HEADERS = ROUTE_CALENDAR_WEEKDAY_HEADERS

/** Mon–Fri columns for the routes overview calendar (no weekend testing). */
export const MONTHLY_ROUTE_OVERVIEW_WORKDAY_HEADERS = ROUTE_CALENDAR_WEEKDAY_HEADERS.slice(0, 5)

export const MONTHLY_ROUTE_OVERVIEW_WORKDAY_COLUMN_COUNT = 5

export const MONTHLY_ROUTE_CALENDAR_WEEK_COUNT = 4

/** Cell key for the generic 4-week overview grid, or ``null`` when out of range. */
export function routeCalendarCellKey(
  weekOccurrence: number | null | undefined,
  weekdayIso: number | null | undefined
): string | null {
  if (typeof weekOccurrence !== 'number' || typeof weekdayIso !== 'number') return null
  if (weekOccurrence < 1 || weekOccurrence > MONTHLY_ROUTE_CALENDAR_WEEK_COUNT) return null
  if (weekdayIso < 0 || weekdayIso > 6) return null
  return `${weekOccurrence}-${weekdayIso}`
}

export function isRoutePlacedOnOverviewCalendar(route: MonthlyRouteSummary): boolean {
  return routeCalendarCellKey(route.week_occurrence, route.weekday_iso) != null
}

/** GET ``/api/monthly_routes/routes/:id/testing_session?month=``. */
export type RouteTestingSessionCounts = {
  sites_tested_count: number
  skipped_non_annual_count: number
  skipped_annual_count: number
}

export type RouteTestingSessionStop = {
  location_id: number
  label_address: string
  building: string | null
  result_status: string
  skip_reason: string | null
  source_value_raw: string | null
  /** Month-specific from ``MonthlyLocationMonth`` after CSV import; else location fallback. */
  testing_procedures?: string | null
  /** Month-specific tech notes from history when captured at import; else location fallback. */
  inspection_tech_notes?: string | null
  time_in?: string | null
  time_out?: string | null
  still_on_route: boolean
  /** 0-based stop index when ``still_on_route``; otherwise ``null``. */
  route_stop_order: number | null
  /** 0-based sheet ``#`` from CSV import; drives ledger order even after the site moves routes. */
  session_route_stop_order: number | null
  /** Row ordinal after server-side sort (1-based). */
  display_order: number
}

export type RouteTestingSessionPayload = {
  route: MonthlyRouteSummary
  month_date: string
  stops: RouteTestingSessionStop[]
  counts: RouteTestingSessionCounts
}

/** GET ``/api/monthly_routes/routes/:id/run_details?month=`` — office run summary. */
/** GET ``/api/monthly_routes/routes/:id/run_details?month=`` outcome KPIs (stop-level). */
export type MonthlyRunDetailCounts = {
  all_good_count: number
  passed_with_problems_count: number
  failed_count: number
  skipped_count: number
}

export type MonthlyRunDetailLocationFieldChange = {
  field_name: string
  old_value: unknown
  new_value: unknown
}

export type MonthlyRunDetailLocationFieldChanges = {
  location_id: number
  location_label: string
  changes: MonthlyRunDetailLocationFieldChange[]
}

export type MonthlyRunDetailReviewMeta = {
  stop_count: number
}

export type MonthlyRunDetailDeficiencySummary = {
  id: number
  monthly_location_id?: number
  created_run_id?: number | null
  title: string | null
  severity: string | null
  status: string | null
  description?: string | null
  verification_notes?: string | null
  reported_by_tech_id?: string | null
  reported_by_tech_name?: string | null
  last_edited_by_tech_id?: string | null
  last_edited_by_tech_name?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export type MonthlyRunDetailLocationAttentionFlags = {
  billing_unset: boolean
  has_field_edits: boolean
  has_active_deficiencies: boolean
  has_job_comment: boolean
  has_office_job_comment?: boolean
  open_tickets?: number
  needs_attention: boolean
}

/** One worksheet location for run details / portal (flat ``MonthlyLocationMonth`` grain). */
export type MonthlyRunDetailLocation = {
  location_id: number
  location_label: string
  stop_number: number
  display_address: string
  label: string | null
  month_date: string
  result_status: string | null
  test_outcome?: string | null
  skip_reason?: string | null
  skip_category?: string | null
  skip_note?: string | null
  annual_month: string | null
  ring?: string | null
  key_number?: string | null
  door_code?: string | null
  monitoring_company?: string | null
  monitoring_company_id?: number | null
  monitoring_account_number?: string | null
  monitoring_password?: string | null
  monitoring_notes?: string | null
  monitoring_company_record?: MonitoringCompanySummary | null
  run_comments: string | null
  office_job_comment?: string | null
  office_attention?: boolean
  prior_month_out_of_order?: boolean
  prior_month_tested_after_address?: string | null
  prior_month_out_of_order_dismissed?: boolean
  prior_month_field_edits?: boolean
  prior_month_new_to_route?: boolean
  testing_procedures: string | null
  inspection_tech_notes: string | null
  confirmed_no_deficiencies?: boolean
  billing_status?: string | null
  has_field_edits: boolean
  review_kind: 'with_changes' | 'tested_only'
  deficiency_summaries: MonthlyRunDetailDeficiencySummary[]
  has_active_deficiencies: boolean
  new_comment_fields?: string[]
  attention_flags: MonthlyRunDetailLocationAttentionFlags
}

export type PrepAnnualScheduleWarning =
  | 'no_annual_scheduled'
  | 'no_servicetrade_link'
  | 'annual_scheduled_wrong_month'

export type AnnualScheduleCheckLocation = {
  location_id: number
  annual_month_matches_run: boolean
  has_service_trade_link: boolean
  service_trade_site_location_url: string | null
  has_scheduled_annual_in_month: boolean
  prep_warning: PrepAnnualScheduleWarning | null
}

export type AnnualScheduleCheckResponse = {
  route_id: number
  month_date: string
  checked_at: string
  warning_count: number
  locations: Record<string, AnnualScheduleCheckLocation>
}

export type AnnualScheduleCheckStatus = 'idle' | 'loading' | 'ready' | 'error'

export type RunReviewStopSummary = {
  location_id: number
  stop_number: number
  display_address: string
  label: string | null
  month_date: string
  result_status: string | null
  test_outcome?: string | null
  skip_reason?: string | null
  skip_category?: string | null
  skip_note?: string | null
  annual_month: string | null
  run_comments: string | null
  confirmed_no_deficiencies?: boolean
  billing_status?: string | null
  has_field_edits: boolean
  review_kind: 'with_changes' | 'tested_only'
}

export type RunReviewSummaryPayload = {
  stop_count: number
  outcome_only_count: number
  all_good_count: number
  passed_with_problems_count: number
  failed_count: number
  skipped_count: number
  updated_count: number
}

export type MonthlyRunDetailReviewPayload = {
  stops: RunReviewStopSummary[]
  summary: RunReviewSummaryPayload
}

export type RunReviewStopDetailChange = {
  id: string
  kind: 'field' | 'field_added' | 'field_removed' | 'status' | 'comment_added'
  label: string
  before: string | null
  after: string
}

export type MonthlyRunDetailReviewStopDetailPayload = {
  location_id: number
  changes: RunReviewStopDetailChange[]
}

export type MonthlyRunDetailFieldSubmissionMeta = {
  available: boolean
  captured_at: string | null
  field_work_reopened: boolean
}

export type MonthlyRunDetailPayload = {
  route: MonthlyRouteSummary
  month_date: string
  run: TechnicianWorksheetRun | null
  field_submission?: MonthlyRunDetailFieldSubmissionMeta
  counts: MonthlyRunDetailCounts
  specialists_month: MonthlyRouteSpecialistMonthPayload | null
  review_meta: MonthlyRunDetailReviewMeta
  locations: MonthlyRunDetailLocation[]
  review_summary?: RunReviewSummaryPayload
}

export type TechnicianWorksheetRow = {
  location_id: number
  history_row_id: number
  month_date: string
  display_address: string
  label?: string | null
  building?: string | null
  building_name?: string | null
  property_management_company: string | null
  annual_month: string | null
  ring: string | null
  key_number: string | null
  facp: string | null
  monitoring: string | null
  /** ``null`` for placeholder rows materialized when a technician opens the worksheet but hasn't tested or skipped yet. */
  result_status: string | null
  skip_reason: string | null
  testing_procedures: string | null
  inspection_tech_notes: string | null
  time_in: string | null
  time_out: string | null
  /** Library template order: ``MonthlyRouteLocation.route_stop_order`` (0-based). */
  route_stop_order: number | null
  /** Per-run sheet ``#`` order when set (e.g. CSV import); worksheet sorts by this first. */
  session_route_stop_order: number | null
  version_updated_at: string | null
}

/**
 * Header for one execution of a monthly route in a given calendar month — the
 * "run file." Aligns with ``MonthlyRouteRun`` rows; one row per
 * ``(monthly_route_id, month_date)``. Returned in ``TechnicianWorksheetPayload.run``.
 */
export type TechnicianWorksheetRun = {
  id: number
  monthly_route_id: number
  /** First-of-month ISO ``YYYY-MM-DD``. */
  month_date: string
  /** ``open`` until the run is completed; future ``completed``. */
  status: string
  /** ISO timestamp when the run file / worksheet rows first existed (browse, import, etc.). */
  opened_at: string | null
  /** ISO timestamp when field techs explicitly started the run (portal ``Start Run``). */
  started_at: string | null
  /** Office released the route-month for field work. */
  prepared_at?: string | null
  prepared_by?: string | null
  /** Field technicians ended active testing (portal End run). */
  field_ended_at?: string | null
  /** Office finished the run-details review checklist. */
  office_review_completed_at?: string | null
  office_review_completed_by?: string | null
  /** ISO timestamp when the run was marked completed (office / workflow). */
  completed_at: string | null
  /** Office prep note for technicians on the route hub (this run only). */
  pre_run_message?: string | null
  /** Where the run was created: ``technician_app``, ``csv_import``, ``office_manual``. */
  source: string
  /** Server-derived workflow stage id (see ``runWorkflowShared``). */
  workflow_stage?: string
  workflow_stage_label?: string
  /**
   * Server-computed flag: ``true`` when the run is explicitly finished (``completed_at`` / terminal ``status``),
   * or when the run's month is strictly before the current Pacific month. Worksheet uses this to switch the
   * Action column from active buttons (Time In / Time Out / Skip / Clear / Add Deficiency) to a static
   * Tested / Skipped:reason label.
   */
  is_historical: boolean
}

/** Run marked finished (CSV import is blocked until staff reopens). */
export function worksheetRunExplicitlyCompleted(run: TechnicianWorksheetRun | null | undefined): boolean {
  if (!run) return false
  const ts = (run.completed_at || '').trim()
  if (ts.length > 0) return true
  const st = (run.status || '').trim().toLowerCase()
  return st === 'completed' || st === 'closed'
}

/** Field technicians are actively logging (started, not field-ended, not office-closed). */
export function worksheetRunFieldActive(run: TechnicianWorksheetRun | null | undefined): boolean {
  if (!run || worksheetRunExplicitlyCompleted(run)) return false
  const started = (run.started_at || '').trim().length > 0
  const fieldEnded = (run.field_ended_at || '').trim().length > 0
  return started && !fieldEnded
}

export type WorksheetOfficeRunActivity = 'completed' | 'active' | 'inactive'

/** Office worksheet header: whether the run is open for field edits or finished. */
export function worksheetOfficeRunActivity(run: TechnicianWorksheetRun | null | undefined): WorksheetOfficeRunActivity {
  if (!run) return 'inactive'
  if (worksheetRunExplicitlyCompleted(run)) return 'completed'
  return 'active'
}

import type { PortalClockEvent, PortalDeficiencySummary } from './portalWorkflowShared'
import { portalStopHasOpenClock } from './portalWorkflowShared'

/** Portal worksheet location (``MonthlyLocationMonth`` grain). */
export type TechnicianWorksheetLocation = {
  location_id: number
  location_month_row_id: number
  month_date: string
  display_address: string
  latitude?: number | null
  longitude?: number | null
  property_management_company: string | null
  label: string | null
  building_name?: string | null
  panel: string | null
  panel_location: string | null
  door_code: string | null
  ring: string | null
  key_number: string | null
  annual_month: string | null
  monitoring_company: string | null
  monitoring_company_id?: number | null
  monitoring_company_record?: MonitoringCompanySummary | null
  monitoring_account_number?: string | null
  monitoring_password?: string | null
  monitoring_notes: string | null
  result_status: string | null
  skip_reason: string | null
  test_outcome?: string | null
  skip_category?: string | null
  skip_note?: string | null
  confirmed_no_deficiencies?: boolean
  clock_events?: PortalClockEvent[]
  deficiencies?: PortalDeficiencySummary[]
  has_run_changes?: boolean
  billing_status?: string | null
  is_legacy_outcome?: boolean
  portal_read_only?: boolean
  is_legacy_run?: boolean
  testing_procedures: string | null
  inspection_tech_notes: string | null
  run_comments: string | null
  new_comment_fields?: string[]
  office_job_comment?: string | null
  office_attention?: boolean
  prior_month_out_of_order_dismissed?: boolean
  time_in: string | null
  time_out: string | null
  route_stop_order: number | null
  session_route_stop_order: number | null
  stop_number: number
  version_updated_at: string | null
}

export type TechnicianWorksheetPayload = {
  route: MonthlyRouteSummary
  month_date: string
  /** ``null`` for routes with no locations; otherwise the run header for ``month_date``. */
  run: TechnicianWorksheetRun | null
  rows: TechnicianWorksheetRow[]
  /** Portal worksheet (``tech_portal=1``): one row per location. */
  locations?: TechnicianWorksheetLocation[]
  /** Legacy API alias; normalized to ``locations`` on load. */
  stops?: TechnicianWorksheetLocation[]
}

/** Normalize worksheet payload from API (``stops`` alias, legacy field names). */
export function normalizeWorksheetPayload(
  payload: TechnicianWorksheetPayload,
): TechnicianWorksheetPayload {
  const rawLocations = payload.locations ?? payload.stops ?? []
  const locations = rawLocations.map((row) => ({
    ...row,
    location_id: row.location_id,
    location_month_row_id:
      row.location_month_row_id ??
      (row as { history_month_row_id?: number }).history_month_row_id ??
      0,
  }))
  return { ...payload, locations, stops: undefined }
}

export function monthlyCommentAuthorsMatch(session: string | null, author: string | null): boolean {
  const s = session?.trim()
  const a = author?.trim()
  if (!s || !a) return false
  return s.toLowerCase() === a.toLowerCase()
}

export function monthlyCommentWasEdited(c: MonthlyLocationComment): boolean {
  return Boolean(c.updated_at && c.created_at && c.updated_at !== c.created_at)
}

export function formatMonthlyCommentTimestamp(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export type LibraryPayload = {
  locations: LibraryLocation[]
  month_columns: string[]
  meta: {
    routes: string[]
    /** All route entities (for filters / tooling); locations still expose ``test_day`` until UI migrates. */
    monthly_routes?: MonthlyRouteSummary[]
    route_counts?: Record<string, number>
    min_month: string | null
    max_month: string | null
    pagination?: {
      page: number
      page_size: number
      total: number
      total_pages: number
    }
  }
}

/**
 * Calendar date (UTC) of the ``week_occurrence``-th weekday identified by ``weekday_iso``
 * in the month containing ``monthFirstIso`` (typically ``YYYY-MM-01``).
 *
 * ``weekday_iso`` matches Python ``datetime.weekday()`` (Monday = 0 … Sunday = 6).
 * ``week_occurrence`` is 1-based (1 = first such weekday in the month).
 */
export function monthlyRouteOccurrenceDateUtc(
  monthFirstIso: string,
  route: MonthlyRouteSummary | null | undefined
): Date | null {
  if (!route || typeof route.weekday_iso !== 'number' || typeof route.week_occurrence !== 'number') {
    return null
  }
  const parts = monthFirstIso.trim().split('-').map(Number)
  const y = parts[0]
  const mo = parts[1]
  if (!y || !mo || mo < 1 || mo > 12) return null

  const weekdayIso = route.weekday_iso
  const occurrence = route.week_occurrence
  if (occurrence < 1 || weekdayIso < 0 || weekdayIso > 6) return null

  const monthIndex0 = mo - 1
  const firstDow = new Date(Date.UTC(y, monthIndex0, 1)).getUTCDay()
  const targetDow = (weekdayIso + 1) % 7
  const delta = (targetDow - firstDow + 7) % 7
  const dom = 1 + delta + (occurrence - 1) * 7

  const out = new Date(Date.UTC(y, monthIndex0, dom))
  if (out.getUTCFullYear() !== y || out.getUTCMonth() !== monthIndex0) {
    return null
  }
  return out
}

/**
 * Whether office edits are allowed for this month row: the scheduled route test day must be
 * strictly **before** today's date (local midnight). If no route is linked, uses calendar month
 * strictly before the current month (local).
 */
/**
 * Whether tested/billing status should appear on the location detail history grid.
 * Past and current calendar months always show; among future months, only the next
 * untested month (``nextUntestedMonthIso``) shows status.
 */
export function shouldShowTestingHistoryStatus(
  monthFirstIso: string,
  nextUntestedMonthIso: string | null,
  reference: Date = new Date(),
): boolean {
  const ym = parseYearMonth(monthFirstIso)
  const currentYm = parseYearMonth(monthFirstIsoPacificToday(reference))
  if (!ym || !currentYm) return false
  if (compareYearMonth(ym, currentYm) <= 0) return true
  return nextUntestedMonthIso === monthFirstIso
}

export function isMonthlyTestingHistoryEditable(
  monthFirstIso: string,
  loc: LibraryLocation,
  reference: Date = new Date()
): boolean {
  const schedUtc = monthlyRouteOccurrenceDateUtc(monthFirstIso, loc.monthly_route)
  const today = new Date(reference)
  today.setHours(0, 0, 0, 0)

  if (schedUtc) {
    const y = schedUtc.getUTCFullYear()
    const m = schedUtc.getUTCMonth()
    const d = schedUtc.getUTCDate()
    const schedLocal = new Date(y, m, d)
    schedLocal.setHours(0, 0, 0, 0)
    return schedLocal.getTime() < today.getTime()
  }

  const ym = parseYearMonth(monthFirstIso)
  if (!ym) return false
  const cy = today.getFullYear()
  const cm = today.getMonth() + 1
  return ym.year < cy || (ym.year === cy && ym.month < cm)
}

/** Prefer API ``monthly_route.label``; fall back to legacy ``test_day`` string. */
export function libraryRouteDisplay(loc: LibraryLocation): string {
  const fromEntity = loc.monthly_route?.label?.trim()
  if (fromEntity) return fromEntity
  return (loc.test_day || '').trim()
}

const ROUTE_WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

function englishOrdinal(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  const mod10 = n % 10
  if (mod10 === 1) return `${n}st`
  if (mod10 === 2) return `${n}nd`
  if (mod10 === 3) return `${n}rd`
  return `${n}th`
}

/** Library route column line 1: ``R7`` when linked; otherwise legacy ``libraryRouteDisplay``. */
export function libraryRouteNumberLine(loc: LibraryLocation): string {
  const n = loc.monthly_route?.route_number
  if (typeof n === 'number' && Number.isFinite(n)) return `R${n}`
  return libraryRouteDisplay(loc) || '—'
}

/** Library route column line 2: ``1st Wed`` when linked; ``null`` for legacy-only rows. */
export function libraryRouteOccurrenceLine(loc: LibraryLocation): string | null {
  const mr = loc.monthly_route
  if (!mr) return null
  const occ = mr.week_occurrence
  const wd = mr.weekday_iso
  if (typeof occ !== 'number' || occ < 1 || typeof wd !== 'number' || wd < 0 || wd > 6) return null
  const wdLabel = ROUTE_WEEKDAY_LABELS[wd] ?? '?'
  return `${englishOrdinal(occ)} ${wdLabel}`
}

/** Canonical keycode from linked asset; otherwise legacy spreadsheet ``keys`` text. */
export function libraryKeycodeDisplay(loc: LibraryLocation): string {
  const fromKey = loc.key?.keycode?.trim()
  if (fromKey) return fromKey
  return (loc.keys || '').trim()
}

export type GeocodeCandidate = {
  display_address: string
  latitude: number
  longitude: number
}

export type CreateLocationForm = {
  address: string
  label: string
  property_management_company: string
  status_raw: string
  keys: string
  /** Monthly route (test_day); omit or empty for unassigned */
  test_day?: string
}

/** Wizard step index for add-location flow. */
export type MonthlyLocationWizardStep = 1 | 2

/** Step 1 fields (monthly library row). */
export type CreateLocationStep1Form = {
  label: string
  property_management_company: string
  status_raw: string
  /** Monthly route (test_day); omit or empty for unassigned */
  test_day?: string
}

/** Edit form for an existing library location (detail page / library modal). */
export type LocationEditForm = {
  label: string
  keys: string
  barcode: string
  price_per_month: string
  ring_detail: string
  facp_detail: string
  panel_location: string
  door_code: string
  property_management_company: string
  annual_month: string
  monitoring_company_id: string
  monitoring_account_number: string
  monitoring_password: string
  monitoring_notes: string
  testing_procedures: string
  inspection_tech_notes: string
}

export function buildLocationEditForm(loc: LibraryLocation): LocationEditForm {
  return {
    label: loc.label ?? '',
    keys: loc.keys ?? '',
    barcode: loc.barcode ?? '',
    price_per_month: loc.price_per_month != null ? String(loc.price_per_month) : '',
    ring_detail: (loc.ring_detail ?? '').trim(),
    facp_detail: (loc.panel ?? loc.facp_detail ?? '').trim(),
    panel_location: loc.panel_location ?? '',
    door_code: loc.door_code ?? '',
    property_management_company: loc.property_management_company ?? '',
    annual_month: normalizeAnnualMonthForSelect(loc.annual_month),
    monitoring_company_id:
      loc.monitoring_company_id != null ? String(loc.monitoring_company_id) : '',
    monitoring_account_number: loc.monitoring_account_number ?? '',
    monitoring_password: loc.monitoring_password ?? '',
    monitoring_notes: loc.monitoring_notes ?? '',
    testing_procedures: loc.testing_procedures ?? '',
    inspection_tech_notes: loc.inspection_tech_notes ?? '',
  }
}

export function locationPayloadFromEditForm(form: LocationEditForm): Record<string, unknown> {
  const mcidRaw = form.monitoring_company_id.trim()
  let monitoring_company_id: number | null = null
  if (mcidRaw) {
    const parsed = parseInt(mcidRaw, 10)
    if (!Number.isNaN(parsed)) monitoring_company_id = parsed
  }
  return {
    label: form.label.trim() || null,
    keys: form.keys.trim() || null,
    barcode: form.barcode.trim() || null,
    price_per_month: form.price_per_month.trim() || null,
    ring_detail: form.ring_detail.trim() || null,
    facp_detail: form.facp_detail.trim() || null,
    panel_location: form.panel_location.trim() || null,
    door_code: form.door_code.trim() || null,
    property_management_company: form.property_management_company.trim() || null,
    annual_month: form.annual_month.trim() || null,
    monitoring_company_id,
    monitoring_account_number: form.monitoring_account_number.trim() || null,
    monitoring_password: form.monitoring_password.trim() || null,
    monitoring_notes: form.monitoring_notes.trim() || null,
    testing_procedures: form.testing_procedures.trim() || null,
    inspection_tech_notes: form.inspection_tech_notes.trim() || null,
  }
}

export function libraryDisplayPricePerMonth(loc: LibraryLocation): number | null {
  return loc.price_per_month
}

/** No annual inspection at this site (not a calendar month). */
export const ANNUAL_MONTH_NOT_AT_SITE = 'TO'

/** Full month names for annual-month ``<select>`` options (``en-US``, UTC). */
export const ANNUAL_MONTH_SELECT_OPTIONS = Array.from({ length: 12 }).map((_, idx) =>
  new Intl.DateTimeFormat('en-US', {
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2000, idx, 1)))
)

/** Calendar months plus ``TO`` for annual dropdowns. */
export const ANNUAL_MONTH_DROPDOWN_VALUES: readonly string[] = [
  ANNUAL_MONTH_NOT_AT_SITE,
  ...ANNUAL_MONTH_SELECT_OPTIONS,
]

export function isAnnualMonthNotAtSite(annualMonth: string | null | undefined): boolean {
  return (annualMonth || '').trim().toUpperCase() === ANNUAL_MONTH_NOT_AT_SITE
}

export function isKnownAnnualMonthDropdownValue(value: string): boolean {
  return (ANNUAL_MONTH_DROPDOWN_VALUES as readonly string[]).includes(value)
}

/** Values for ``<select>`` (blank, legacy unknown, then TO + months). */
export function annualMonthSelectChoiceValues(currentValue?: string | null): string[] {
  const normalized = normalizeAnnualMonthForSelect(currentValue)
  const legacy =
    normalized && !isKnownAnnualMonthDropdownValue(normalized) ? [normalized] : []
  return ['', ...legacy, ...ANNUAL_MONTH_DROPDOWN_VALUES]
}

export function annualMonthDropdownOptions(
  currentValue?: string | null,
): Array<{ value: string; label: string }> {
  return annualMonthSelectChoiceValues(currentValue).map((value) => ({
    value,
    label: value === '' ? '—' : value,
  }))
}

/**
 * Map spreadsheet / legacy values (``Jan``, ``MAY``, ``5``, ``TO``, etc.) to a select option value.
 * Returns ``''`` when unset; returns the original trimmed string when no month matches.
 */
export function normalizeAnnualMonthForSelect(raw: string | null | undefined): string {
  const trimmed = (raw || '').trim()
  if (!trimmed) return ''
  if (trimmed.toUpperCase() === ANNUAL_MONTH_NOT_AT_SITE) {
    return ANNUAL_MONTH_NOT_AT_SITE
  }

  const lower = trimmed.toLowerCase()
  for (let idx = 0; idx < 12; idx += 1) {
    const full = ANNUAL_MONTH_SELECT_OPTIONS[idx]
    const short = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(2000, idx, 1)))
    if (lower === full.toLowerCase() || lower === short.toLowerCase()) {
      return full
    }
  }

  const num = parseInt(trimmed, 10)
  if (!Number.isNaN(num) && num >= 1 && num <= 12) {
    return ANNUAL_MONTH_SELECT_OPTIONS[num - 1]
  }

  return trimmed
}

export const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'waiting_keys', label: 'Waiting Keys' },
]

export function isCancelledMonthlyLocation(
  loc: Pick<RouteLocationListItem, 'status_normalized'>,
): boolean {
  return (loc.status_normalized || '').trim().toLowerCase() === 'cancelled'
}

/** Route detail / map: hide cancelled library locations from active stop lists. */
export function activeRouteLocations(locations: RouteLocationListItem[]): RouteLocationListItem[] {
  return locations.filter((loc) => !isCancelledMonthlyLocation(loc))
}

/** Preserve cancelled rows in place when persisting a drag reorder on visible stops only. */
export function mergeVisibleRouteLocationReorder(
  full: RouteLocationListItem[],
  reorderedVisible: RouteLocationListItem[],
): RouteLocationListItem[] {
  const queue = [...reorderedVisible]
  return full.map((loc) => (isCancelledMonthlyLocation(loc) ? loc : queue.shift()!))
}

/** Sidebar filter key for locations with no assigned route (not a real test_day value). */
export const MAP_ROUTE_UNASSIGNED = '__monthly_map_unassigned__'

export type MapViewportBounds = {
  west: number
  south: number
  east: number
  north: number
}

export type YearMonth = { year: number; month: number }

/** True when ``annualMonth`` (e.g. "May") is the calendar month of ``monthFirstIso`` (``YYYY-MM-01``). */
export function isAnnualForMonth(annualMonth: string | null | undefined, monthFirstIso: string): boolean {
  if (isAnnualMonthNotAtSite(annualMonth)) return false
  const raw = (annualMonth || '').trim().toLowerCase()
  if (!raw) return false
  const ym = parseYearMonth(monthFirstIso)
  if (!ym) return false
  const monthFull = new Intl.DateTimeFormat('en-CA', { month: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(ym.year, ym.month - 1, 1)))
    .toLowerCase()
  const monthShort = monthFull.slice(0, 3)
  return raw === monthFull || raw === monthShort
}

export function parseYearMonth(value: string): YearMonth | null {
  const match = value.match(/^(\d{4})-(\d{2})/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null
  return { year, month }
}

export function compareYearMonth(a: YearMonth, b: YearMonth): number {
  if (a.year !== b.year) return a.year - b.year
  return a.month - b.month
}

export function toMonthKey(year: number, month: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`
}

/** First-of-month key for the calendar month containing ``reference`` in local time. */
export function monthFirstIsoLocalToday(reference: Date = new Date()): string {
  return toMonthKey(reference.getFullYear(), reference.getMonth() + 1)
}

/** Matches backend ``PACIFIC_TZ`` (``America/Vancouver`` in ``app.routes.monthly_routes``). */
const PACIFIC_TZ = 'America/Vancouver'

/**
 * First-of-month ``YYYY-MM-01`` for the calendar month containing ``reference`` in Pacific time
 * (aligned with worksheet ``is_historical`` / route testing month semantics).
 */
export function monthFirstIsoPacificToday(reference: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PACIFIC_TZ,
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(reference)
  const y = parts.find((p) => p.type === 'year')?.value
  const mo = parts.find((p) => p.type === 'month')?.value
  const yi = y ? parseInt(y, 10) : NaN
  const mi = mo ? parseInt(mo, 10) : NaN
  if (!Number.isFinite(yi) || !Number.isFinite(mi) || mi < 1 || mi > 12) {
    return monthFirstIsoLocalToday(reference)
  }
  return toMonthKey(yi, mi)
}

/** Pacific calendar date ``YYYY-MM-DD`` for ``reference`` (``America/Vancouver``). */
export function pacificCalendarDateIso(reference: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PACIFIC_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(reference)
  const y = parts.find((p) => p.type === 'year')?.value
  const mo = parts.find((p) => p.type === 'month')?.value
  const d = parts.find((p) => p.type === 'day')?.value
  if (!y || !mo || !d) return ''
  return `${y}-${mo}-${d}`
}

/** Scheduled route test day for ``monthFirstIso`` from ``week_occurrence`` / ``weekday_iso``. */
export function dateIsoFromUtcOccurrence(occ: Date): string {
  return isoFromUtcDate(occ)
}

/**
 * Effective test day for a route in ``monthFirstIso``'s month: nominal nth-weekday date,
 * bumped to the next same-weekday occurrence when that day is a BC stat holiday.
 */
export function effectiveRouteTestDayIso(
  monthFirstIso: string,
  route: MonthlyRouteSummary | null | undefined,
): string | null {
  if (!route || typeof route.weekday_iso !== 'number' || typeof route.week_occurrence !== 'number') {
    return null
  }
  let occurrence = route.week_occurrence
  while (occurrence >= 1 && occurrence <= 5) {
    const occ = monthlyRouteOccurrenceDateUtc(monthFirstIso, {
      ...route,
      week_occurrence: occurrence,
    })
    if (!occ) return null
    const iso = dateIsoFromUtcOccurrence(occ)
    if (!isBcStatHoliday(iso)) return iso
    occurrence += 1
  }
  return null
}

export function formatRouteTestDayLabel(iso: string): string {
  const parts = iso.split('-').map(Number)
  const y = parts[0]
  const mo = parts[1]
  const d = parts[2]
  if (!y || !mo || !d) return iso
  return new Intl.DateTimeFormat('en-CA', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, mo - 1, d)))
}

export function formatRouteOverviewMonthHeading(monthFirstIso: string): string {
  const ym = parseYearMonth(monthFirstIso)
  if (!ym) return monthFirstIso
  return new Intl.DateTimeFormat('en-CA', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(ym.year, ym.month - 1, 1)))
}

export type PacificMonthCalendarCell = {
  iso: string
  dayOfMonth: number
  isToday: boolean
  isHoliday: boolean
  holidayName: string | null
  isPadding: boolean
}

/** Monday-first Pacific calendar grid cells for the month containing ``monthFirstIso``. */
export function buildPacificMonthCalendarGrid(
  monthFirstIso: string,
  reference: Date = new Date(),
): PacificMonthCalendarCell[] {
  const ym = parseYearMonth(monthFirstIso)
  if (!ym) return []
  const todayIso = pacificCalendarDateIso(reference)
  const { year, month } = ym
  const firstDowJs = new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
  const mondayFirstOffset = (firstDowJs + 6) % 7
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const cells: PacificMonthCalendarCell[] = []

  for (let i = 0; i < mondayFirstOffset; i++) {
    cells.push({
      iso: '',
      dayOfMonth: 0,
      isToday: false,
      isHoliday: false,
      holidayName: null,
      isPadding: true,
    })
  }

  for (let dom = 1; dom <= daysInMonth; dom++) {
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(dom).padStart(2, '0')}`
    cells.push({
      iso,
      dayOfMonth: dom,
      isToday: iso === todayIso,
      isHoliday: isBcStatHoliday(iso),
      holidayName: isBcStatHoliday(iso) ? bcStatHolidayName(iso, year) : null,
      isPadding: false,
    })
  }

  while (cells.length % 7 !== 0) {
    cells.push({
      iso: '',
      dayOfMonth: 0,
      isToday: false,
      isHoliday: false,
      holidayName: null,
      isPadding: true,
    })
  }

  return cells
}

function emptyPacificCalendarPaddingCell(): PacificMonthCalendarCell {
  return {
    iso: '',
    dayOfMonth: 0,
    isToday: false,
    isHoliday: false,
    holidayName: null,
    isPadding: true,
  }
}

function pacificMonthDayCell(
  year: number,
  month: number,
  dom: number,
  todayIso: string,
): PacificMonthCalendarCell {
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(dom).padStart(2, '0')}`
  return {
    iso,
    dayOfMonth: dom,
    isToday: iso === todayIso,
    isHoliday: isBcStatHoliday(iso),
    holidayName: isBcStatHoliday(iso) ? bcStatHolidayName(iso, year) : null,
    isPadding: false,
  }
}

/** Monday–Friday grid for the routes overview (weekends omitted). */
export function buildPacificWorkweekCalendarGrid(
  monthFirstIso: string,
  reference: Date = new Date(),
): PacificMonthCalendarCell[] {
  const ym = parseYearMonth(monthFirstIso)
  if (!ym) return []
  const todayIso = pacificCalendarDateIso(reference)
  const { year, month } = ym
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const cols = MONTHLY_ROUTE_OVERVIEW_WORKDAY_COLUMN_COUNT
  const cells: PacificMonthCalendarCell[] = []
  let row: PacificMonthCalendarCell[] = []

  const flushRow = () => {
    if (row.length === 0) return
    while (row.length < cols) {
      row.push(emptyPacificCalendarPaddingCell())
    }
    cells.push(...row)
    row = []
  }

  for (let dom = 1; dom <= daysInMonth; dom++) {
    const jsDow = new Date(Date.UTC(year, month - 1, dom)).getUTCDay()
    const weekdayIso = jsDow === 0 ? 6 : jsDow - 1
    if (weekdayIso > 4) continue

    if (row.length === 0) {
      for (let i = 0; i < weekdayIso; i++) {
        row.push(emptyPacificCalendarPaddingCell())
      }
    } else if (weekdayIso === 0) {
      flushRow()
    }

    row.push(pacificMonthDayCell(year, month, dom, todayIso))
    if (row.length === cols) {
      flushRow()
    }
  }

  flushRow()
  return cells
}

export function scheduledRouteTestDayIso(
  monthFirstIso: string,
  route: MonthlyRouteSummary | null | undefined,
): string | null {
  return effectiveRouteTestDayIso(monthFirstIso, route)
}

export function isPacificTodayRouteScheduledTestDay(
  monthFirstIso: string,
  route: MonthlyRouteSummary | null | undefined,
  reference: Date = new Date(),
): boolean {
  const sched = scheduledRouteTestDayIso(monthFirstIso, route)
  if (!sched) return false
  return sched === pacificCalendarDateIso(reference)
}

/** Office run-details / worksheet status pill (workflow-aware when run header present). */
export function runOfficeStatusPillLabel(
  activity: WorksheetOfficeRunActivity,
  monthFirstIso: string,
  route: MonthlyRouteSummary | null | undefined,
  reference: Date = new Date(),
  run?: TechnicianWorksheetRun | null,
): string {
  if (run?.workflow_stage_label) {
    return run.workflow_stage_label
  }
  switch (activity) {
    case 'completed':
      return 'Completed'
    case 'active':
      return isPacificTodayRouteScheduledTestDay(monthFirstIso, route, reference)
        ? 'In progress'
        : 'Open'
    default:
      return 'Not started'
  }
}

export function addCalendarMonths(monthFirstIso: string, delta: number): string | null {
  const ym = parseYearMonth(monthFirstIso)
  if (!ym) return null
  const d = new Date(Date.UTC(ym.year, ym.month - 1 + delta, 1))
  return toMonthKey(d.getUTCFullYear(), d.getUTCMonth() + 1)
}

/**
 * First ``YYYY-MM-01`` on or after ``reference``’s local calendar month that is not in ``monthKeys``.
 * Used to show “next month to be tested” given recorded history keys.
 */
export function nextUntestedMonthIso(
  monthKeys: Iterable<string>,
  reference: Date = new Date()
): string | null {
  const set = new Set(monthKeys)
  let cursor = monthFirstIsoLocalToday(reference)
  for (let i = 0; i < 240; i++) {
    if (!set.has(cursor)) return cursor
    cursor = addCalendarMonths(cursor, 1) ?? ''
    if (!cursor) return null
  }
  return null
}

export function isLngLatInViewport(lng: number, lat: number, bounds: MapViewportBounds): boolean {
  return lng >= bounds.west && lng <= bounds.east && lat >= bounds.south && lat <= bounds.north
}

/** Sort route labels like `M1-R2`, `F1-R10` by route day number (R1, R2, …), then alphabetically. */
export function compareMonthlyRouteFilterNames(a: string, b: string): number {
  const rSuffix = /-R(\d+)$/i
  const ma = a.trim().match(rSuffix)
  const mb = b.trim().match(rSuffix)
  const na = ma ? parseInt(ma[1], 10) : null
  const nb = mb ? parseInt(mb[1], 10) : null
  if (na != null && nb != null && na !== nb) return na - nb
  if (na != null && nb == null) return -1
  if (na == null && nb != null) return 1
  return a.trim().localeCompare(b.trim(), undefined, { numeric: true, sensitivity: 'base' })
}

export function normalizeMapCoordinates(
  latitude: number | null | undefined,
  longitude: number | null | undefined
): { lat: number; lng: number } | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  const lat = Number(latitude)
  const lng = Number(longitude)
  if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) return { lat, lng }
  if (lng >= -90 && lng <= 90 && lat >= -180 && lat <= 180) return { lat: lng, lng: lat }
  return null
}

const EXPLICIT_TIME_VALUE_RE = /^\d{1,2}:\d{1,2}(:\d{1,2})?(\s*[ap]\.?m\.?)?$/i

export function looksLikeExplicitTimeValue(raw: string | null | undefined): boolean {
  const s = (raw ?? '').trim()
  if (!s) return false
  return EXPLICIT_TIME_VALUE_RE.test(s)
}

/** Whether a portal location has any recorded outcome (tested, skipped, or visit times). */
export function locationsHaveRecordedOutcomes(locations: TechnicianWorksheetLocation[]): boolean {
  return locations.some((loc) => {
    const rs = (loc.result_status || '').trim().toLowerCase()
    if (rs === 'tested' || rs === 'skipped') return true
    if ((loc.time_in || '').trim()) return true
    if ((loc.time_out || '').trim()) return true
    return false
  })
}

/** Skipped for annual / annual_booked (matches office ``sheetSkipReasonIsAnnual``). */
export function worksheetLocationSkipIsAnnual(loc: TechnicianWorksheetLocation): boolean {
  if ((loc.result_status || '').trim().toLowerCase() !== 'skipped') return false
  const reason = (loc.skip_reason || '').trim().toLowerCase()
  if (reason === 'annual' || reason === 'annual_booked') return true
  const tin = (loc.time_in || '').trim().toLowerCase()
  return tin.includes('annual')
}

/** Open visit on a portal location: clock time in, no time out, not tested/skipped. */
export function worksheetLocationIsOpenClockIn(loc: TechnicianWorksheetLocation): boolean {
  if (Array.isArray(loc.clock_events) && loc.clock_events.length > 0) {
    return portalStopHasOpenClock(loc)
  }
  const rs = (loc.result_status || '').trim().toLowerCase()
  if (rs === 'tested' || rs === 'skipped') return false
  const tin = (loc.time_in || '').trim()
  const tout = (loc.time_out || '').trim()
  if (!tin || tout) return false
  return looksLikeExplicitTimeValue(tin)
}

/** Shown when the technician tries to clock in while another stop is still open. */
export const WORKSHEET_CLOCK_IN_BLOCKED_MESSAGE =
  "Can't clock in while already clocked into another site."


export function sortedLibraryLocations(loc: LibraryLocation): LibraryLocation[] {
  return [loc]
}

/** @deprecated Flat library: the location is the only row. */
export function sortedTestingSites(loc: LibraryLocation): LibraryLocation[] {
  return sortedLibraryLocations(loc)
}
