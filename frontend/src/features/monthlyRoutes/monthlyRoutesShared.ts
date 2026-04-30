/** Types and pure helpers shared by Monthly Routes library and map pages. */

export type MonthCell = { result_status: string; skip_reason: string | null }

/** Canonical monthly route entity (``MonthlyRoute``); aligns with ``monthly_route_id``. */
export type MonthlyRouteSummary = {
  id: number
  route_number: number
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
  months: Record<string, MonthCell>
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

/** Prefer API ``monthly_route.label``; fall back to legacy ``test_day`` string. */
export function libraryRouteDisplay(loc: LibraryLocation): string {
  const fromEntity = loc.monthly_route?.label?.trim()
  if (fromEntity) return fromEntity
  return (loc.test_day || '').trim()
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
