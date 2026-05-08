/** Types and pure helpers shared by Monthly Routes library and map pages. */

export type MonthCell = {
  result_status: string
  skip_reason: string | null
  /** Monthly route when this month cell was saved (CSV / sheet capture); not necessarily ``monthly_route`` today. */
  test_monthly_route?: MonthlyRouteSummary | null
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
  location_count?: number
}

/** Linked row from ``keys`` when ``key_id`` FK is set. */
export type LinkedKeySummary = {
  id: number
  keycode: string
  barcode: number | null
}

export type LibraryLocation = {
  id: number
  address: string
  display_address?: string | null
  property_management_company: string | null
  building: string | null
  notes: string | null
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
  /** 0-based stop index when on a monthly route; from ``MonthlyRouteLocation.route_stop_order``. */
  route_stop_order?: number | null
  months: Record<string, MonthCell>
}

/** Row from ``GET/PUT .../routes/:id`` locations list (no month grid). */
export type RouteLocationListItem = {
  id: number
  address: string
  display_address?: string | null
  building?: string | null
  status_normalized: string
  annual_month?: string | null
  route_stop_order: number | null
  monthly_route_id?: number | null
}

/** Comment row from ``GET /api/monthly_routes/library/:id`` (newest first). */
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

export type MonthlyRouteDetailPayload = {
  route: MonthlyRouteSummary
  /** Stops on this route in driving order (from ``route_stop_order``). */
  locations: RouteLocationListItem[]
  comments: MonthlyLocationComment[]
  testing_by_month: Record<string, RouteTestingMonthCell>
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
  /** Month-specific from ``MonthlyRouteTestHistory`` after CSV import; else ``MonthlyRouteLocation`` fallback. */
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

export type TechnicianWorksheetRow = {
  location_id: number
  history_row_id: number
  month_date: string
  display_address: string
  building: string | null
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
  /** ISO timestamp set the first time the worksheet is opened for this run. */
  started_at: string | null
  completed_at: string | null
  /** Where the run was created: ``technician_app``, ``csv_import``, ``office_manual``. */
  source: string
  /**
   * Server-computed flag: ``true`` when ``status === 'completed'`` or when the
   * run's month is strictly before the current Pacific month. Worksheet uses
   * this to switch the Action column from active buttons (Time In / Time Out /
   * Skip / Clear / Add Deficiency) to a static Tested / Skipped:reason label.
   */
  is_historical: boolean
}

export type TechnicianWorksheetPayload = {
  route: MonthlyRouteSummary
  month_date: string
  /** ``null`` for routes with no locations; otherwise the run header for ``month_date``. */
  run: TechnicianWorksheetRun | null
  rows: TechnicianWorksheetRow[]
}

export type TechnicianWorksheetAuditEvent = {
  id: number
  field_name: string
  old_value: unknown
  new_value: unknown
  source: string
  changed_by_username: string | null
  changed_by_name: string | null
  changed_at: string | null
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
  property_management_company: string
  status_raw: string
  keys: string
  /** Monthly route (test_day); omit or empty for unassigned */
  test_day?: string
}

export const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'waiting_keys', label: 'Waiting Keys' },
]

/** Sidebar filter key for locations with no assigned route (not a real test_day value). */
export const MAP_ROUTE_UNASSIGNED = '__monthly_map_unassigned__'

export type MapViewportBounds = {
  west: number
  south: number
  east: number
  north: number
}

export type YearMonth = { year: number; month: number }

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

const PACIFIC_TZ = 'America/Los_Angeles'

/**
 * First-of-month ``YYYY-MM-01`` for the calendar month containing ``reference`` in Pacific time
 * (aligned with worksheet ``is_historical`` / route testing month semantics).
 */
export function monthFirstIsoPacificToday(reference: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PACIFIC_TZ,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(reference)
  const y = parts.find((p) => p.type === 'year')?.value
  const mo = parts.find((p) => p.type === 'month')?.value
  if (!y || !mo) return monthFirstIsoLocalToday(reference)
  return `${y}-${mo}-01`
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
