import { useCallback, useEffect, useMemo, useState } from 'react'

import { apiJson } from '../../lib/apiClient'
import type {
  AnnualScheduleCheckLocation,
  AnnualScheduleCheckResponse,
  AnnualScheduleCheckStatus,
} from './monthlyRoutesShared'

function parseAnnualScheduleError(err: unknown): string {
  if (err && typeof err === 'object') {
    const message = (err as { error?: unknown }).error
    if (typeof message === 'string' && message.trim()) return message
  }
  if (typeof err === 'string' && err.trim()) return err
  return 'Could not check ServiceTrade annual schedules.'
}

export function useAnnualScheduleCheck(
  routeId: number,
  monthDate: string,
  enabled: boolean,
) {
  const [status, setStatus] = useState<AnnualScheduleCheckStatus>('idle')
  const [data, setData] = useState<AnnualScheduleCheckResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchCheck = useCallback(
    async (cacheBust = false) => {
      if (!enabled || !Number.isFinite(routeId) || !monthDate.trim()) return
      setStatus('loading')
      setError(null)
      try {
        const qs = new URLSearchParams({ month_date: monthDate })
        if (cacheBust) qs.set('cache_bust', '1')
        const response = await apiJson<AnnualScheduleCheckResponse>(
          `/api/monthly_routes/routes/${routeId}/runs/annual_schedule_check?${qs.toString()}`,
        )
        setData(response)
        setStatus('ready')
      } catch (err) {
        setStatus('error')
        setError(parseAnnualScheduleError(err))
      }
    },
    [enabled, monthDate, routeId],
  )

  useEffect(() => {
    if (!enabled) {
      setStatus('idle')
      setData(null)
      setError(null)
      return
    }
    void fetchCheck(false)
  }, [enabled, fetchCheck])

  const locationsById = useMemo(() => {
    if (!data?.locations) return null
    const out: Record<number, AnnualScheduleCheckLocation> = {}
    for (const [key, value] of Object.entries(data.locations)) {
      out[Number(key)] = value
    }
    return out
  }, [data])

  return {
    status,
    data,
    error,
    locationsById,
    warningCount: data?.warning_count ?? 0,
    refresh: () => fetchCheck(true),
  }
}
