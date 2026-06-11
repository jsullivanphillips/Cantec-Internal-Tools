import { useEffect, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { Spinner } from 'react-bootstrap'
import { apiJson } from '../lib/apiClient'
import { monthFirstIsoPacificToday } from '../features/monthlyRoutes/monthlyRoutesShared'
import type { TechnicianDemoRouteInfo } from '../features/monthlyRoutes/technicianDemoRoute'

/** Legacy mock URLs → live training route worksheet when seeded. */
export default function RedirectPortalTrainingWorksheet() {
  const { monthIso } = useParams<{ monthIso?: string }>()
  const [target, setTarget] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const fallbackMonth = monthIso?.trim() || monthFirstIsoPacificToday()
      try {
        const info = await apiJson<TechnicianDemoRouteInfo>('/api/technician_portal/demo')
        if (cancelled) return
        if (info.seeded && info.route?.id != null) {
          const month = monthIso?.trim() || info.current_month_first || fallbackMonth
          setTarget(`/tech/route/${info.route.id}/worksheet/${month}`)
          return
        }
      } catch {
        /* fall through to start page */
      }
      if (!cancelled) setTarget('/tech/start')
    })()
    return () => {
      cancelled = true
    }
  }, [monthIso])

  if (!target) {
    return (
      <div className="d-flex justify-content-center align-items-center py-5">
        <Spinner animation="border" role="status" aria-label="Loading training route" />
      </div>
    )
  }

  return <Navigate to={target} replace />
}
