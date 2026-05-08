import { useEffect, useMemo, useState } from 'react'
import { Card, ListGroup } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import type { MonthlyRouteOverviewPayload } from '../features/monthlyRoutes/monthlyRoutesShared'
import { apiJson, isAbortError } from '../lib/apiClient'

export default function MonthlyRoutesOverviewPage() {
  const [payload, setPayload] = useState<MonthlyRouteOverviewPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    apiJson<MonthlyRouteOverviewPayload>('/api/monthly_routes/routes', {
      signal: controller.signal,
    })
      .then((data) => {
        if (active) setPayload(data)
      })
      .catch((err) => {
        if (!isAbortError(err) && active) setError('Unable to load route overview.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [])

  const rows = useMemo(() => payload?.routes ?? [], [payload])

  return (
    <div className="d-flex flex-column gap-3">
      <Card className="app-surface-card">
        <Card.Body className="p-3 p-md-4">
          <h2 className="processing-page-title mb-0">Routes</h2>
        </Card.Body>
      </Card>
      <Card className="app-surface-card">
        <Card.Body className="p-3 p-md-4">
          {error ? <div className="text-danger">{error}</div> : null}
          {loading ? <div className="text-muted">Loading routes...</div> : null}
          {!loading && !error ? (
            rows.length === 0 ? (
              <div className="text-muted">No routes found.</div>
            ) : (
              <ListGroup>
                {rows.map((row) => (
                  <ListGroup.Item key={row.route.id}>
                    <Link to={`/monthlies/routes/${row.route.id}`} className="fw-semibold text-decoration-none">
                      {row.route.label}
                    </Link>
                  </ListGroup.Item>
                ))}
              </ListGroup>
            )
          ) : null}
        </Card.Body>
      </Card>
    </div>
  )
}
