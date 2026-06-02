import { apiJson } from '../../lib/apiClient'
import type { MonitoringCompanySummary } from './monthlyRoutesShared'

export type MonitoringCompanyListResponse = {
  companies: MonitoringCompanySummary[]
}

export type MonitoringCompanyCreateResponse = {
  company: MonitoringCompanySummary
  reused_existing: boolean
}

export const MONITORING_COMPANIES_CACHE_KEY = 'monitoringCompaniesDirectory.v1'

export function loadMonitoringCompaniesCache(): MonitoringCompanySummary[] | null {
  try {
    const raw = localStorage.getItem(MONITORING_COMPANIES_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as MonitoringCompanySummary[]
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function saveMonitoringCompaniesCache(companies: MonitoringCompanySummary[]): void {
  try {
    localStorage.setItem(MONITORING_COMPANIES_CACHE_KEY, JSON.stringify(companies))
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
