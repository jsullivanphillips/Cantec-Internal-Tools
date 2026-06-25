import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { apiJson, isAbortError } from '../../lib/apiClient'
import type {
  AnnualScheduleCheckLocation,
  AnnualScheduleCheckResponse,
  AnnualScheduleCheckStatus,
  AnnualScheduleSyncProgress,
} from './monthlyRoutesShared'

function parseAnnualScheduleError(err: unknown): string {
  if (err && typeof err === 'object') {
    const message = (err as { error?: unknown }).error
    if (typeof message === 'string' && message.trim()) return message
  }
  if (typeof err === 'string' && err.trim()) return err
  return 'Could not check ServiceTrade annual schedules.'
}

function locationsMapFromResponse(
  response: AnnualScheduleCheckResponse,
): Record<number, AnnualScheduleCheckLocation> {
  const out: Record<number, AnnualScheduleCheckLocation> = {}
  for (const [key, value] of Object.entries(response.locations ?? {})) {
    out[Number(key)] = value
  }
  return out
}

async function fetchAnnualScheduleDbSnapshot(
  routeId: number,
  monthDate: string,
  signal?: AbortSignal,
): Promise<AnnualScheduleCheckResponse> {
  const qs = new URLSearchParams({ month_date: monthDate })
  return apiJson<AnnualScheduleCheckResponse>(
    `/api/monthly_routes/routes/${routeId}/runs/annual_schedule_check?${qs.toString()}`,
    { signal },
  )
}

async function syncAnnualScheduleLocation(
  routeId: number,
  monthDate: string,
  locationId: number,
  options: { cacheBust?: boolean; signal?: AbortSignal },
): Promise<AnnualScheduleCheckResponse> {
  const qs = new URLSearchParams({
    month_date: monthDate,
    sync: '1',
    location_id: String(locationId),
  })
  if (options.cacheBust) qs.set('cache_bust', '1')
  return apiJson<AnnualScheduleCheckResponse>(
    `/api/monthly_routes/routes/${routeId}/runs/annual_schedule_check?${qs.toString()}`,
    { signal: options.signal },
  )
}

export function useAnnualScheduleCheck(
  routeId: number,
  monthDate: string,
  enabled: boolean,
  /** Worksheet stop ids — used to re-sync every site on manual refresh. */
  worksheetLocationIds: number[] = [],
) {
  const [status, setStatus] = useState<AnnualScheduleCheckStatus>('idle')
  const [data, setData] = useState<AnnualScheduleCheckResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [syncProgress, setSyncProgress] = useState<AnnualScheduleSyncProgress | null>(null)
  const runSeqRef = useRef(0)

  const fetchCheck = useCallback(
    async (cacheBust = false) => {
      if (!enabled || !Number.isFinite(routeId) || !monthDate.trim()) return

      const runSeq = ++runSeqRef.current
      setStatus((prev) => (prev === 'ready' && cacheBust ? 'syncing' : 'loading'))
      setError(null)

      const abortController = new AbortController()

      try {
        const snapshot = await fetchAnnualScheduleDbSnapshot(routeId, monthDate, abortController.signal)
        if (runSeq !== runSeqRef.current) return

        setData(snapshot)
        setSyncProgress(snapshot.sync_progress ?? null)

        let pending = [...(snapshot.sync_progress?.pending_location_ids ?? [])]
        if (cacheBust && worksheetLocationIds.length > 0) {
          pending = [...worksheetLocationIds]
        }

        if (pending.length === 0) {
          setStatus('ready')
          return
        }

        setStatus('syncing')
        for (const locationId of pending) {
          if (runSeq !== runSeqRef.current) return
          try {
            const updated = await syncAnnualScheduleLocation(routeId, monthDate, locationId, {
              cacheBust,
              signal: abortController.signal,
            })
            if (runSeq !== runSeqRef.current) return
            setData(updated)
            setSyncProgress(updated.sync_progress ?? null)
          } catch (err) {
            if (isAbortError(err)) return
            if (runSeq !== runSeqRef.current) return
            setError(parseAnnualScheduleError(err))
            setStatus('error')
            return
          }
        }

        if (runSeq === runSeqRef.current) {
          setStatus('ready')
        }
      } catch (err) {
        if (isAbortError(err)) return
        if (runSeq !== runSeqRef.current) return
        setStatus('error')
        setError(parseAnnualScheduleError(err))
      }
    },
    [enabled, monthDate, routeId, worksheetLocationIds],
  )

  useEffect(() => {
    if (!enabled) {
      runSeqRef.current += 1
      setStatus('idle')
      setData(null)
      setError(null)
      setSyncProgress(null)
      return
    }
    void fetchCheck(false)
    return () => {
      runSeqRef.current += 1
    }
  }, [enabled, fetchCheck])

  const locationsById = useMemo(() => {
    if (!data?.locations) return null
    return locationsMapFromResponse(data)
  }, [data])

  const annualScheduleBusy = status === 'loading' || status === 'syncing'

  return {
    status,
    data,
    error,
    syncProgress,
    annualScheduleBusy,
    locationsById,
    warningCount: data?.warning_count ?? 0,
    refresh: () => fetchCheck(true),
  }
}
