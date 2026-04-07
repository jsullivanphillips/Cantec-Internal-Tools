import { useEffect, useMemo, useState } from 'react'
import { apiJson } from '../lib/apiClient'
import { Badge, Card, Col, Form, Row, Spinner } from 'react-bootstrap'

type Tech = { tech_name?: string; jobs?: number; name?: string }

type RouteRow = {
  location_name: string
  completed_jobs_count: number
  top_technicians: Tech[]
  last_updated_at: string | null
}

function techLabel(t: Tech): string {
  return (t.tech_name || t.name || '').trim() || '—'
}

function techJobs(t: Tech): number {
  return typeof t.jobs === 'number' ? t.jobs : 0
}

function badgeClass(jobs: number) {
  if (jobs >= 15) return 'monthly-tech-badge--diamond'
  if (jobs > 10) return 'monthly-tech-badge--gold'
  if (jobs > 5) return 'monthly-tech-badge--silver'
  return 'monthly-tech-badge--bronze'
}

function badgeTier(jobs: number) {
  if (jobs >= 15) return 'Diamond'
  if (jobs > 10) return 'Gold'
  if (jobs > 5) return 'Silver'
  return 'Bronze'
}

export default function MonthlySpecialistsPage() {
  const [routes, setRoutes] = useState<RouteRow[]>([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiJson<{ routes: RouteRow[] }>('/api/monthly_specialists')
      .then((d) => setRoutes(d.routes || []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return routes
    return routes.filter((r) => r.location_name.toLowerCase().includes(t))
  }, [routes, q])

  const latestUpdatedLabel = useMemo(() => {
    const ts = routes
      .map((r) => (r.last_updated_at ? new Date(r.last_updated_at).getTime() : 0))
      .filter((v) => Number.isFinite(v) && v > 0)
    if (ts.length === 0) return '—'
    return new Date(Math.max(...ts)).toLocaleDateString()
  }, [routes])

  if (loading) {
    return (
      <div className="d-flex justify-content-center py-5">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="monthly-page d-flex flex-column gap-3">
      <Card className="app-surface-card monthly-filters-card">
        <Card.Body className="p-3 p-md-4">
          <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-1">
            <h1 className="h4 mb-0">Monthly Specialists</h1>
            <span className="text-muted small">
              {filtered.length} route(s) · Updated {latestUpdatedLabel}
            </span>
          </div>
          <p className="text-muted small mb-3">Search for a route to find its specialists.</p>
          <Form.Control
            placeholder="Search by location"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ maxWidth: 360 }}
          />
        </Card.Body>
      </Card>

      <Card className="app-surface-card monthly-results-card">
        <Card.Body className="p-3">
          {filtered.length === 0 ? (
            <div className="text-muted py-3">No routes match your search.</div>
          ) : (
            <Row className="g-3">
              {filtered.map((route) => (
                <Col key={route.location_name} xl={3} lg={4} md={6}>
                  <Card className="app-kpi-nested h-100 monthly-route-card">
                    <Card.Body className="d-flex flex-column">
                      <Card.Title className="h6 mb-1">{route.location_name}</Card.Title>
                      <div className="text-muted small mb-2">
                        Route completed {route.completed_jobs_count} times
                      </div>
                      <ul className="list-group list-group-flush mb-3">
                        {!route.top_technicians?.length && (
                          <li className="list-group-item text-muted px-0">No technicians</li>
                        )}
                        {route.top_technicians?.slice(0, 5).map((tech, i) => {
                          const j = techJobs(tech)
                          return (
                            <li
                              key={i}
                              className="list-group-item d-flex justify-content-between align-items-center px-0"
                            >
                              <span>{techLabel(tech)}</span>
                              <Badge
                                bg="light"
                                text="dark"
                                className={`monthly-tech-badge ${badgeClass(j)}`}
                                title={`${badgeTier(j)} tier`}
                                aria-label={`${badgeTier(j)} tier, ${j} completions`}
                              >
                                {j}
                              </Badge>
                            </li>
                          )
                        })}
                      </ul>
                      <div className="mt-auto" />
                    </Card.Body>
                  </Card>
                </Col>
              ))}
            </Row>
          )}
        </Card.Body>
      </Card>
    </div>
  )
}
