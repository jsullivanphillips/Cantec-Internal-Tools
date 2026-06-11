import { useCallback, useRef, useState } from 'react'
import { apiJson } from '../../lib/apiClient'
import type { TechnicianWorksheetLocation } from './monthlyRoutesShared'

const stopsCache = new Map<string, TechnicianWorksheetLocation>()

export function stopCacheKey(routeId: number, monthDate: string, locationId: number): string {
  return `${routeId}:${monthDate}:${locationId}`
}

/** Keep modal stop cache aligned with run-details payload merges. */
export function syncRunDetailsStopCache(
  routeId: number,
  monthDate: string,
  stop: TechnicianWorksheetLocation,
): void {
  stopsCache.set(stopCacheKey(routeId, monthDate, stop.location_id), stop)
}

type LoadStopOptions = {
  /** When true, show cached data immediately but always refetch from the server. */
  fresh?: boolean
}

export function useRunDetailsWorksheetStops(routeId: number, monthDate: string) {
  const [stopsById, setStopsById] = useState<Map<number, TechnicianWorksheetLocation>>(() => new Map())
  const [loadingId, setLoadingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loadPromiseRef = useRef<Map<string, Promise<void>>>(new Map())

  const fetchStopFromServer = useCallback(
    async (locationId: number) => {
      const key = stopCacheKey(routeId, monthDate, locationId)
      setLoadingId((current) => current ?? locationId)
      setError(null)
      try {
        const qs = new URLSearchParams({ month: monthDate })
        const data = await apiJson<{ stop: TechnicianWorksheetLocation }>(
          `/api/monthly_routes/routes/${routeId}/run_details/locations/${locationId}?${qs.toString()}`,
        )
        stopsCache.set(key, data.stop)
        setStopsById((prev) => new Map(prev).set(locationId, data.stop))
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load site details.')
        throw e
      } finally {
        setLoadingId((current) => (current === locationId ? null : current))
        loadPromiseRef.current.delete(key)
      }
    },
    [routeId, monthDate],
  )

  const ensureStopLoaded = useCallback(
    async (locationId: number, options?: LoadStopOptions) => {
      const key = stopCacheKey(routeId, monthDate, locationId)
      const cached = stopsCache.get(key)
      if (cached) {
        setStopsById((prev) => new Map(prev).set(locationId, cached))
      }

      const mustFetch = options?.fresh === true || cached == null
      if (!mustFetch) return

      const inFlight = loadPromiseRef.current.get(key)
      if (inFlight) {
        await inFlight
        return
      }

      const promise = fetchStopFromServer(locationId)
      loadPromiseRef.current.set(key, promise)
      await promise
    },
    [routeId, monthDate, fetchStopFromServer],
  )

  const getStop = useCallback(
    (locationId: number): TechnicianWorksheetLocation | undefined => stopsById.get(locationId),
    [stopsById],
  )

  const replaceStop = useCallback(
    (stop: TechnicianWorksheetLocation) => {
      const key = stopCacheKey(routeId, monthDate, stop.location_id)
      stopsCache.set(key, stop)
      setStopsById((prev) => new Map(prev).set(stop.location_id, stop))
    },
    [routeId, monthDate],
  )

  const invalidateStop = useCallback(
    (locationId: number) => {
      stopsCache.delete(stopCacheKey(routeId, monthDate, locationId))
      setStopsById((prev) => {
        const next = new Map(prev)
        next.delete(locationId)
        return next
      })
    },
    [routeId, monthDate],
  )

  const loading = loadingId != null

  return { ensureStopLoaded, getStop, replaceStop, invalidateStop, loading, loadingId, error }
}
