import { useCallback, useRef, useState } from 'react'
import { apiJson } from '../../lib/apiClient'
import type { TechnicianWorksheetStop } from './monthlyRoutesShared'

const stopsCache = new Map<string, TechnicianWorksheetStop>()

export function stopCacheKey(routeId: number, monthDate: string, testingSiteId: number): string {
  return `${routeId}:${monthDate}:${testingSiteId}`
}

/** Keep modal stop cache aligned with run-details payload merges. */
export function syncRunDetailsStopCache(
  routeId: number,
  monthDate: string,
  stop: TechnicianWorksheetStop,
): void {
  stopsCache.set(stopCacheKey(routeId, monthDate, stop.testing_site_id), stop)
}

type LoadStopOptions = {
  /** When true, show cached data immediately but always refetch from the server. */
  fresh?: boolean
}

export function useRunDetailsWorksheetStops(routeId: number, monthDate: string) {
  const [stopsById, setStopsById] = useState<Map<number, TechnicianWorksheetStop>>(() => new Map())
  const [loadingId, setLoadingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loadPromiseRef = useRef<Map<string, Promise<void>>>(new Map())

  const fetchStopFromServer = useCallback(
    async (testingSiteId: number) => {
      const key = stopCacheKey(routeId, monthDate, testingSiteId)
      setLoadingId((current) => current ?? testingSiteId)
      setError(null)
      try {
        const qs = new URLSearchParams({ month: monthDate })
        const data = await apiJson<{ stop: TechnicianWorksheetStop }>(
          `/api/monthly_routes/routes/${routeId}/run_details/stops/${testingSiteId}?${qs.toString()}`,
        )
        stopsCache.set(key, data.stop)
        setStopsById((prev) => new Map(prev).set(testingSiteId, data.stop))
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load site details.')
        throw e
      } finally {
        setLoadingId((current) => (current === testingSiteId ? null : current))
        loadPromiseRef.current.delete(key)
      }
    },
    [routeId, monthDate],
  )

  const ensureStopLoaded = useCallback(
    async (testingSiteId: number, options?: LoadStopOptions) => {
      const key = stopCacheKey(routeId, monthDate, testingSiteId)
      const cached = stopsCache.get(key)
      if (cached) {
        setStopsById((prev) => new Map(prev).set(testingSiteId, cached))
      }

      const mustFetch = options?.fresh === true || cached == null
      if (!mustFetch) return

      const inFlight = loadPromiseRef.current.get(key)
      if (inFlight) {
        await inFlight
        return
      }

      const promise = fetchStopFromServer(testingSiteId)
      loadPromiseRef.current.set(key, promise)
      await promise
    },
    [routeId, monthDate, fetchStopFromServer],
  )

  const getStop = useCallback(
    (testingSiteId: number): TechnicianWorksheetStop | undefined => stopsById.get(testingSiteId),
    [stopsById],
  )

  const replaceStop = useCallback(
    (stop: TechnicianWorksheetStop) => {
      const key = stopCacheKey(routeId, monthDate, stop.testing_site_id)
      stopsCache.set(key, stop)
      setStopsById((prev) => new Map(prev).set(stop.testing_site_id, stop))
    },
    [routeId, monthDate],
  )

  const invalidateStop = useCallback(
    (testingSiteId: number) => {
      stopsCache.delete(stopCacheKey(routeId, monthDate, testingSiteId))
      setStopsById((prev) => {
        const next = new Map(prev)
        next.delete(testingSiteId)
        return next
      })
    },
    [routeId, monthDate],
  )

  const loading = loadingId != null

  return { ensureStopLoaded, getStop, replaceStop, invalidateStop, loading, loadingId, error }
}
