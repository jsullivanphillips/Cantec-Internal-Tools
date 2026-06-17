import { apiJson } from '../../lib/apiClient'
import type { LinkedKeySummary, LibraryLocation } from '../monthlyRoutes/monthlyRoutesShared'

export type LinkedMonthlyLocationSummary = {
  id: number
  label: string
  address: string
  key_id?: number | null
  key?: Pick<LinkedKeySummary, 'id' | 'keycode'> | null
}

export function addressFromMonthlyLocation(loc: {
  label?: string | null
  address?: string | null
}): string {
  return (loc.label?.trim() || loc.address?.trim() || '').trim()
}

export function linkedMonthlyLocationToLibraryLocation(
  loc: LinkedMonthlyLocationSummary,
): LibraryLocation {
  return {
    id: loc.id,
    label: loc.label,
    address: loc.address,
    key_id: loc.key_id,
    key: loc.key
      ? { id: loc.key.id, keycode: loc.key.keycode, barcode: null }
      : null,
    property_management_company: null,
    notes: null,
    price_per_month: null,
    pricing_updated: false,
    area: null,
    start_up_date: null,
    status_normalized: 'active',
    keys: null,
    test_day: null,
    annual_month: null,
    months: {},
  }
}

export function filterAdditionalKeyAddresses(
  addresses: { address: string }[],
  linkedLocations: LinkedMonthlyLocationSummary[],
): string {
  const derived = new Set(
    linkedLocations.map((loc) => addressFromMonthlyLocation(loc).toLowerCase()),
  )
  return addresses
    .map((a) => a.address.trim())
    .filter((addr) => addr && !derived.has(addr.toLowerCase()))
    .join('\n')
}

export type RouteKeyAuditRow = {
  location_id?: number
  label?: string | null
  address?: string | null
  keys_text?: string | null
  key_id?: number | null
  linked_key?: LinkedKeySummary | null
  keycode?: string
  barcode?: number | null
  route?: string | null
  issue: string
  detail?: string | null
}

export type RouteKeyAuditPayload = {
  route_id: number
  route_number: number
  bag_code: string
  counts: {
    stops_on_route: number
    stops_requiring_key: number
    linked: number
    unlinked: number
    wrong_route: number
    missing_from_bag: number
    unavailable: number
    available: number
    extra_in_bag: number
    issues: number
  }
  unlinked: RouteKeyAuditRow[]
  wrong_route: RouteKeyAuditRow[]
  missing_from_bag: RouteKeyAuditRow[]
  unavailable: RouteKeyAuditRow[]
  available: RouteKeyAuditRow[]
  extra_in_bag: RouteKeyAuditRow[]
}

export async function fetchRouteKeyAudit(routeId: number): Promise<RouteKeyAuditPayload> {
  return apiJson<RouteKeyAuditPayload>(`/api/monthly_routes/routes/${routeId}/key_audit`)
}

export type KeyAdminDetail = {
  id: number
  keycode: string
  barcode?: number | null
  route?: string | null
  home_location?: string | null
  annual_month?: string | null
  area?: string | null
  site_status?: string | null
  is_key_bag: boolean
  addresses: { id: number; address: string }[]
  linked_monthly_locations?: LinkedMonthlyLocationSummary[]
}

export type KeyDeleteBlockers = {
  linked_location_ids: number[]
  linked_location_count: number
}

export type KeySearchHit = {
  id: number
  keycode: string
  barcode?: number | null
  route?: string | null
  addresses: string[]
}

export async function createKey(payload: {
  keycode: string
  barcode?: number | null
  route?: string | null
  home_location?: string | null
  area?: string | null
  annual_month?: string | null
  addresses?: string[]
  monthly_location_ids?: number[]
}): Promise<KeyAdminDetail> {
  const res = await apiJson<{ key: KeyAdminDetail }>('/api/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return res.key
}

export async function updateKey(
  keyId: number,
  payload: Record<string, unknown>,
): Promise<KeyAdminDetail> {
  const res = await apiJson<{ key: KeyAdminDetail }>(`/api/keys/${keyId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return res.key
}

export async function deleteKey(keyId: number): Promise<void> {
  await apiJson(`/api/keys/${keyId}`, { method: 'DELETE' })
}

export async function fetchKeyDeleteBlockers(keyId: number): Promise<KeyDeleteBlockers> {
  const res = await apiJson<{ blockers: KeyDeleteBlockers }>(`/api/keys/${keyId}/delete_blockers`)
  return res.blockers
}

export async function fetchKeyAdminDetail(keyId: number): Promise<KeyAdminDetail> {
  return apiJson<KeyAdminDetail>(`/api/keys/${keyId}/detail`)
}

export async function searchKeys(q: string): Promise<KeySearchHit[]> {
  const res = await apiJson<{ data: KeySearchHit[] }>(
    `/api/keys/search?q=${encodeURIComponent(q)}`,
  )
  return res.data ?? []
}
