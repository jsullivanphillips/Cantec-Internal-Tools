import { useCallback, useEffect, useState } from 'react'
import { apiJson } from '../../lib/apiClient'

export const DEFAULT_TECHNICIAN_DEMO_ROUTE_NUMBER = 99

export type TechnicianDemoPortalRoute = {
  id: number
  route_number: number
  display_name: string | null
  weekday_iso: number
  week_occurrence: number
  label: string
  location_count: number
}

export type TechnicianDemoRouteInfo = {
  configured: boolean
  route_number: number
  seeded: boolean
  route: TechnicianDemoPortalRoute | null
  current_month_first: string
  office_paperwork_path: string | null
  training_steps: string[]
  seed_hint: string | null
}

export function isTechnicianDemoRoute(routeNumber: number | undefined | null): boolean {
  if (routeNumber == null || !Number.isFinite(routeNumber)) return false
  return routeNumber === DEFAULT_TECHNICIAN_DEMO_ROUTE_NUMBER
}

const DEMO_ROUTE_TEST_DAY_SUFFIX = new RegExp(
  `-\\s*R\\s*${DEFAULT_TECHNICIAN_DEMO_ROUTE_NUMBER}\\s*$`,
  'i',
)

/** True when a library/map row is assigned to the live training route (default R99). */
export function isTechnicianDemoLibraryLocation(loc: {
  test_day?: string | null
  monthly_route?: { route_number?: number } | null
}): boolean {
  if (isTechnicianDemoRoute(loc.monthly_route?.route_number)) return true
  const testDay = (loc.test_day || '').trim()
  return testDay.length > 0 && DEMO_ROUTE_TEST_DAY_SUFFIX.test(testDay)
}

export function useTechnicianDemoRouteInfo(enabled = true) {
  const [info, setInfo] = useState<TechnicianDemoRouteInfo | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    setError(null)
    try {
      const payload = await apiJson<TechnicianDemoRouteInfo>('/api/technician_portal/demo')
      setInfo(payload)
    } catch {
      setError('Unable to load training route info.')
      setInfo(null)
    } finally {
      setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { info, loading, error, refresh }
}

export async function resetTechnicianDemoRoute(): Promise<void> {
  await apiJson('/api/technician_portal/demo/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: true }),
  })
}
