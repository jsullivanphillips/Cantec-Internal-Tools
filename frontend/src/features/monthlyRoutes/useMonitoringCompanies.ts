import { useCallback, useEffect, useState } from 'react'
import { isAbortError } from '../../lib/apiClient'
import {
  fetchMonitoringCompanies,
  invalidateMonitoringCompaniesCache,
  loadMonitoringCompaniesCache,
  saveMonitoringCompaniesCache,
} from './monitoringCompaniesShared'
import type { MonitoringCompanySummary } from './monthlyRoutesShared'

function sortCompanies(rows: MonitoringCompanySummary[]): MonitoringCompanySummary[] {
  return [...rows].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', undefined, { sensitivity: 'base' }))
}

export function useMonitoringCompanies(activeOnly = true) {
  const [companies, setCompanies] = useState<MonitoringCompanySummary[]>(() => {
    const cached = loadMonitoringCompaniesCache()
    return cached ? sortCompanies(cached) : []
  })
  const [loading, setLoading] = useState(() => !loadMonitoringCompaniesCache())
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    invalidateMonitoringCompaniesCache()
    setLoading(true)
    setError(null)
    try {
      const rows = sortCompanies(await fetchMonitoringCompanies(activeOnly))
      setCompanies(rows)
      return rows
    } catch (err) {
      if (!isAbortError(err)) {
        setError(err instanceof Error ? err.message : 'Unable to load monitoring companies.')
      }
      return null
    } finally {
      setLoading(false)
    }
  }, [activeOnly])

  useEffect(() => {
    if (loadMonitoringCompaniesCache()) return
    void refresh()
  }, [activeOnly, refresh])

  const appendCompany = useCallback((company: MonitoringCompanySummary) => {
    setCompanies((prev) => {
      if (prev.some((row) => row.id === company.id)) return prev
      const next = sortCompanies([...prev, company])
      saveMonitoringCompaniesCache(next)
      return next
    })
  }, [])

  return { companies, loading, error, refresh, appendCompany }
}
