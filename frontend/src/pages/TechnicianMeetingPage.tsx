import { useCallback, useEffect, useState } from 'react'
import { apiFetch, isAbortError } from '../lib/apiClient'
import { Alert, Button, Card, Col, Form, Row } from 'react-bootstrap'
import TechnicianMetricsPanel from '../features/technicianMeeting/TechnicianMetricsPanel'

function params(start: string, end: string) {
  const q = new URLSearchParams()
  if (start) q.set('start_date', start)
  if (end) q.set('end_date', end)
  const s = q.toString()
  return s ? `?${s}` : ''
}

export default function TechnicianMeetingPage() {
  const today = new Date()
  const defaultEnd = today.toISOString().slice(0, 10)
  const defaultStart = new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString().slice(0, 10)

  const [start, setStart] = useState(defaultStart)
  const [end, setEnd] = useState(defaultEnd)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<string>('—')
  const [techData, setTechData] = useState<Record<string, unknown> | null>(null)

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    const p = params(start, end)
    try {
      const [lu, t] = await Promise.all([
        apiFetch(`/api/last_updated${p}`, { signal }).then((r) => r.json()),
        apiFetch(`/api/performance/technicians${p}`, { signal }).then((r) => r.json()),
      ])
      if (signal?.aborted) return
      setLastUpdated(lu.last_updated || lu.latest || JSON.stringify(lu))
      setTechData(t)
    } catch (e) {
      if (isAbortError(e)) return
      console.error(e)
      setError('Failed to load technician metrics.')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [start, end])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  return (
    <div className="technician-meeting-page performance-summary-page d-flex flex-column gap-3">
      <Card className="app-surface-card">
        <Card.Body className="p-3 p-md-4">
          <h1 className="processing-page-title mb-1">Technician Meeting</h1>
          <p className="processing-page-subtitle mb-0">
            Technician performance metrics for the date range you choose.
          </p>
        </Card.Body>
      </Card>

      <Card className="app-surface-card performance-filters-card">
        <Card.Body className="p-3 p-md-4">
          <Row className="g-3 align-items-end">
            <Col xs={12} sm={6} md={4} lg={3}>
              <Form.Group>
                <Form.Label className="small text-muted mb-1">Start date</Form.Label>
                <Form.Control type="date" value={start} onChange={(e) => setStart(e.target.value)} />
              </Form.Group>
            </Col>
            <Col xs={12} sm={6} md={4} lg={3}>
              <Form.Group>
                <Form.Label className="small text-muted mb-1">End date</Form.Label>
                <Form.Control type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
              </Form.Group>
            </Col>
            <Col xs={12} sm="auto">
              <Button
                type="button"
                variant="outline-secondary"
                className="performance-apply-btn"
                onClick={() => void load()}
                disabled={loading}
              >
                Apply
              </Button>
            </Col>
          </Row>
          <p className="text-muted small mt-3 mb-0">Data last updated: {String(lastUpdated)}</p>
          {error ? (
            <Alert variant="warning" className="mt-3 mb-0 py-2 small">
              Something went wrong loading this data. Try again, or pick a different range.
            </Alert>
          ) : null}
        </Card.Body>
      </Card>

      <Card className="app-surface-card">
        <Card.Body className="p-3 p-md-4">
          <TechnicianMetricsPanel techData={techData} loading={loading} />
        </Card.Body>
      </Card>
    </div>
  )
}
