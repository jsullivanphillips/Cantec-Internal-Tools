import { useEffect, useState } from 'react'
import { apiJson, isAbortError } from '../../lib/apiClient'
import {
  getCachedFieldSubmission,
  setCachedFieldSubmission,
} from './paperworkRouteCache'
import type { TechnicianWorksheetLocation } from './monthlyRoutesShared'

export type SiteFieldSubmissionParams = {
  routeId: number | null
  monthIso: string
  locationId: number
  enabled?: boolean
}

export type SiteFieldSubmissionState = {
  loading: boolean
  stops: TechnicianWorksheetLocation[]
  capturedAt: string | null
  fieldWorkReopened: boolean
  emptyMessage: string | null
  noRoute: boolean
}

const INITIAL_STATE: SiteFieldSubmissionState = {
  loading: false,
  stops: [],
  capturedAt: null,
  fieldWorkReopened: false,
  emptyMessage: null,
  noRoute: false,
}

export function useSiteFieldSubmission({
  routeId,
  monthIso,
  locationId,
  enabled = true,
}: SiteFieldSubmissionParams): SiteFieldSubmissionState {
  const [state, setState] = useState<SiteFieldSubmissionState>(INITIAL_STATE)

  useEffect(() => {
    if (!enabled) {
      setState(INITIAL_STATE)
      return
    }

    if (routeId == null) {
      setState({
        ...INITIAL_STATE,
        emptyMessage: 'No test history for this month.',
        noRoute: true,
      })
      return
    }

    const cached = getCachedFieldSubmission(routeId, monthIso)
    if (cached) {
      const filtered = cached.stops.filter((stop) => stop.location_id === locationId)
      setState({
        loading: false,
        stops: filtered,
        capturedAt: cached.capturedAt,
        fieldWorkReopened: cached.fieldWorkReopened,
        emptyMessage:
          filtered.length === 0 ? 'No paperwork row for this site on this run.' : null,
        noRoute: false,
      })
    } else {
      setState({ ...INITIAL_STATE, loading: true })
    }

    const ac = new AbortController()
    const qs = new URLSearchParams({ month: monthIso })

    void (async () => {
      try {
        const data = await apiJson<{
          stops: TechnicianWorksheetLocation[]
          captured_at: string | null
          field_work_reopened: boolean
        }>(
          `/api/monthly_routes/routes/${routeId}/run_details/field_submission?${qs.toString()}`,
          { signal: ac.signal },
        )
        if (ac.signal.aborted) return
        const entry = {
          stops: data.stops ?? [],
          capturedAt: data.captured_at,
          fieldWorkReopened: Boolean(data.field_work_reopened),
        }
        setCachedFieldSubmission(routeId, monthIso, entry)
        const filtered = entry.stops.filter((stop) => stop.location_id === locationId)
        setState({
          loading: false,
          stops: filtered,
          capturedAt: entry.capturedAt,
          fieldWorkReopened: entry.fieldWorkReopened,
          emptyMessage:
            filtered.length === 0 ? 'No paperwork row for this site on this run.' : null,
          noRoute: false,
        })
      } catch (e) {
        if (isAbortError(e)) return
        if (!ac.signal.aborted) {
          setState({
            loading: false,
            stops: [],
            capturedAt: null,
            fieldWorkReopened: false,
            emptyMessage: 'No field submission captured for this run.',
            noRoute: false,
          })
        }
      }
    })()

    return () => ac.abort()
  }, [enabled, routeId, monthIso, locationId])

  return state
}

export function formatFieldSubmissionCapturedAt(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  )
}
