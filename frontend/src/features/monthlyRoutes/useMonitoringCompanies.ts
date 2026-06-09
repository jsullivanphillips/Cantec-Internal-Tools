import { useCallback, useEffect, useState } from 'react'
import { isAbortError } from '../../lib/apiClient'
import {
  ensureMonitoringCompaniesCached,
  fetchMonitoringCompanies,
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
  const [loading, setLoading] = useState(() => {
    const cached = loadMonitoringCompaniesCache()
    return !cached?.length && navigator.onLine
  })
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = sortCompanies(await fetchMonitoringCompanies(activeOnly))
      setCompanies(rows)
      return rows
    } catch (err) {
      const cached = loadMonitoringCompaniesCache()
      if (cached?.length) {
        setCompanies(sortCompanies(cached))
      } else if (!isAbortError(err)) {
        setError(err instanceof Error ? err.message : 'Unable to load monitoring companies.')
      }
      return cached ? sortCompanies(cached) : null
    } finally {
      setLoading(false)
    }
  }, [activeOnly])

  useEffect(() => {
    let cancelled = false
    const cached = loadMonitoringCompaniesCache()
    if (cached?.length) {
      setCompanies(sortCompanies(cached))
      setLoading(false)
    }

    void (async () => {
      const rows = await ensureMonitoringCompaniesCached(activeOnly)
      if (cancelled) return
      if (rows.length) {
        setCompanies(sortCompanies(rows))
        setError(null)
      } else if (!cached?.length && navigator.onLine) {
        setError('Unable to load monitoring companies.')
      }
      setLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [activeOnly])

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
