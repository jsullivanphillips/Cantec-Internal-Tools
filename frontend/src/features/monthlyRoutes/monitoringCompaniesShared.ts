import { apiJson } from '../../lib/apiClient'
import type { MonitoringCompanySummary, TechnicianWorksheetLocation } from './monthlyRoutesShared'

export type MonitoringCompanyListResponse = {
  companies: MonitoringCompanySummary[]
}

export type MonitoringCompanyCreateResponse = {
  company: MonitoringCompanySummary
  reused_existing: boolean
}

export type MonitoringCompaniesCacheBundle = {
  fetchedAt: string
  companies: MonitoringCompanySummary[]
}

export const MONITORING_COMPANIES_CACHE_KEY = 'monitoringCompaniesDirectory.v1'

function parseMonitoringCompaniesCache(raw: string | null): MonitoringCompanySummary[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as MonitoringCompanySummary[] | MonitoringCompaniesCacheBundle
    if (Array.isArray(parsed)) return parsed
    if (parsed && Array.isArray(parsed.companies)) return parsed.companies
    return null
  } catch {
    return null
  }
}

export function loadMonitoringCompaniesCache(): MonitoringCompanySummary[] | null {
  try {
    return parseMonitoringCompaniesCache(localStorage.getItem(MONITORING_COMPANIES_CACHE_KEY))
  } catch {
    return null
  }
}

export function saveMonitoringCompaniesCache(companies: MonitoringCompanySummary[]): void {
  try {
    const bundle: MonitoringCompaniesCacheBundle = {
      fetchedAt: new Date().toISOString(),
      companies,
    }
    localStorage.setItem(MONITORING_COMPANIES_CACHE_KEY, JSON.stringify(bundle))
  } catch {
    /* ignore quota */
  }
}

export function invalidateMonitoringCompaniesCache(): void {
  try {
    localStorage.removeItem(MONITORING_COMPANIES_CACHE_KEY)
  } catch {
    /* ignore */
  }
}

export async function fetchMonitoringCompanies(activeOnly = true): Promise<MonitoringCompanySummary[]> {
  const qs = new URLSearchParams()
  if (activeOnly) qs.set('active', '1')
  qs.set('limit', '1000')
  const data = await apiJson<MonitoringCompanyListResponse>(`/api/monitoring_companies?${qs.toString()}`)
  const companies = data.companies ?? []
  saveMonitoringCompaniesCache(companies)
  return companies
}

/** Load cached directory or fetch when online; never clears cache on failure. */
export async function ensureMonitoringCompaniesCached(activeOnly = true): Promise<MonitoringCompanySummary[]> {
  const cached = loadMonitoringCompaniesCache()
  if (!navigator.onLine) {
    return cached ?? []
  }
  try {
    return await fetchMonitoringCompanies(activeOnly)
  } catch {
    return cached ?? []
  }
}

export function monitoringCompanyFromDirectory(
  companyId: number | null | undefined,
  companies: MonitoringCompanySummary[],
): MonitoringCompanySummary | null {
  if (companyId == null) return null
  return companies.find((row) => row.id === companyId) ?? null
}

/** Overlay directory phones/names when worksheet rows only store the company id. */
export function enrichStopMonitoringFromDirectory<T extends TechnicianWorksheetLocation>(
  stop: T,
  companies: MonitoringCompanySummary[],
): T {
  if (stop.monitoring_company_id == null || !companies.length) return stop
  const directory = monitoringCompanyFromDirectory(stop.monitoring_company_id, companies)
  if (!directory) return stop

  const record = stop.monitoring_company_record
  const mergedRecord: MonitoringCompanySummary = {
    ...directory,
    ...(record ?? {}),
    id: stop.monitoring_company_id,
    name: record?.name?.trim() || directory.name,
    primary_phone: record?.primary_phone?.trim() || directory.primary_phone,
    secondary_phone: record?.secondary_phone?.trim() || directory.secondary_phone,
  }

  return {
    ...stop,
    monitoring_company: stop.monitoring_company?.trim() || mergedRecord.name,
    monitoring_company_record: mergedRecord,
  }
}

export function enrichStopsWithMonitoringDirectory<T extends TechnicianWorksheetLocation>(
  stops: T[],
  companies: MonitoringCompanySummary[],
): T[] {
  if (!companies.length) return stops
  return stops.map((stop) => enrichStopMonitoringFromDirectory(stop, companies))
}

export async function createMonitoringCompany(payload: {
  name: string
  primary_phone?: string | null
  secondary_phone?: string | null
}): Promise<MonitoringCompanyCreateResponse> {
  return apiJson<MonitoringCompanyCreateResponse>('/api/monitoring_companies', {
    method: 'POST',
    body: JSON.stringify({
      name: payload.name.trim(),
      primary_phone: payload.primary_phone?.trim() || null,
      secondary_phone: payload.secondary_phone?.trim() || null,
    }),
  })
}

export function monitoringCompanyPhoneLines(company: MonitoringCompanySummary | null | undefined): string[] {
  if (!company) return []
  const lines: string[] = []
  const primary = company.primary_phone?.trim()
  const secondary = company.secondary_phone?.trim()
  if (primary) lines.push(primary)
  if (secondary) lines.push(secondary)
  return lines
}
