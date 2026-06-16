import { useCallback, useEffect, useState } from 'react'
import { Accordion, Alert, Badge, ListGroup, Spinner } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import {
  fetchRouteKeyAudit,
  type RouteKeyAuditPayload,
  type RouteKeyAuditRow,
} from './keysAdminShared'

function AuditList({
  title,
  rows,
  variant,
}: {
  title: string
  rows: RouteKeyAuditRow[]
  variant: string
}) {
  if (rows.length === 0) return null
  return (
    <Accordion.Item eventKey={title}>
      <Accordion.Header>
        {title}
        <Badge bg={variant} className="ms-2">
          {rows.length}
        </Badge>
      </Accordion.Header>
      <Accordion.Body className="p-0">
        <ListGroup variant="flush">
          {rows.map((row, i) => (
            <ListGroup.Item key={`${row.location_id ?? row.key_id}-${i}`} className="small">
              {row.location_id != null ? (
                <Link to={`/monthlies/locations/${row.location_id}`} className="fw-semibold text-decoration-none">
                  {row.label || row.address || `Location ${row.location_id}`}
                </Link>
              ) : (
                <span className="fw-semibold">{row.keycode || `Key ${row.key_id}`}</span>
              )}
              {row.linked_key?.keycode || row.keycode ? (
                <span className="text-muted ms-2">· {row.linked_key?.keycode ?? row.keycode}</span>
              ) : null}
              {row.detail ? <div className="text-muted mt-1">{row.detail}</div> : null}
            </ListGroup.Item>
          ))}
        </ListGroup>
      </Accordion.Body>
    </Accordion.Item>
  )
}

export default function RouteKeyAuditCard({ routeId }: { routeId: number }) {
  const [audit, setAudit] = useState<RouteKeyAuditPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setAudit(await fetchRouteKeyAudit(routeId))
    } catch {
      setError('Unable to load key audit.')
      setAudit(null)
    } finally {
      setLoading(false)
    }
  }, [routeId])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <div className="d-flex align-items-center gap-2 text-muted small py-2">
        <Spinner animation="border" size="sm" aria-hidden />
        Loading key audit…
      </div>
    )
  }

  if (error) {
    return (
      <Alert variant="warning" className="py-2 small mb-0">
        {error}
      </Alert>
    )
  }

  if (!audit) return null

  const c = audit.counts
  const issueTotal = c.issues

  return (
    <section className="monthly-location-detail-surface p-3 mb-3" aria-label="Route key audit">
      <div className="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-2">
        <div>
          <h2 className="h6 mb-1">Key audit — {audit.bag_code}</h2>
          <p className="small text-muted mb-0">
            {c.linked} of {c.stops_requiring_key} stops linked · {c.available} available in bag
          </p>
        </div>
        {issueTotal > 0 ? (
          <Badge bg="warning" text="dark">
            {issueTotal} issue{issueTotal === 1 ? '' : 's'}
          </Badge>
        ) : (
          <Badge bg="success">Ready</Badge>
        )}
      </div>

      {issueTotal === 0 ? (
        <p className="small text-muted mb-0">All required keys are linked and available for this route bag.</p>
      ) : (
        <Accordion flush>
          <AuditList title="Unlinked stops" rows={audit.unlinked} variant="secondary" />
          <AuditList title="Wrong route on key" rows={audit.wrong_route} variant="danger" />
          <AuditList title="Missing from bag inventory" rows={audit.missing_from_bag} variant="danger" />
          <AuditList title="Unavailable (signed out elsewhere)" rows={audit.unavailable} variant="warning" />
          <AuditList title="Extra keys on route bag" rows={audit.extra_in_bag} variant="info" />
        </Accordion>
      )}

      <div className="mt-2">
        <Link to="/monthlies/keys" className="small">
          Manage keys
        </Link>
      </div>
    </section>
  )
}
