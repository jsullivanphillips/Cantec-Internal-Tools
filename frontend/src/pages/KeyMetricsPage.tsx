import { useCallback, useEffect, useState } from 'react'
import { apiJson } from '../lib/apiClient'
import { Button, Card, Col, Form, Row, Spinner, Table } from 'react-bootstrap'

type MetricsJson = {
  range?: { start?: string; end?: string }
  kpis?: {
    total_signouts?: number
    double_signouts_total?: number
    returned_by_rate?: number | null
    airtag_rate?: number | null
    avg_out_duration_seconds?: number | null
    total_returns?: number
    returns_with_returned_by?: number
    signouts_with_airtag?: number
  }
  series?: {
    signouts_by_day?: { day: string; count: number }[]
    unique_users_by_week?: { week: string; count: number }[]
    double_signouts_by_day?: { day: string; count: number }[]
  }
}

function fmtPct(v: number | null | undefined) {
  if (v == null) return '—'
  return `${Math.round(v * 100)}%`
}

function fmtDuration(seconds: number | null | undefined) {
  if (seconds == null) return '—'
  const s = Math.max(0, Math.round(seconds))
  const hrs = Math.floor(s / 3600)
  const mins = Math.floor((s % 3600) / 60)
  if (hrs <= 0) return `${mins}m`
  return `${hrs}h ${mins}m`
}

export default function KeyMetricsPage() {
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [data, setData] = useState<MetricsJson | null>(null)
  const [loading, setLoading] = useState(false)

  const defaults = useCallback(() => {
    const e = new Date()
    const s = new Date()
    s.setDate(e.getDate() - 30)
    const iso = (d: Date) => d.toISOString().slice(0, 10)
    setStart(iso(s))
    setEnd(iso(e))
  }, [])

  useEffect(() => {
    defaults()
  }, [defaults])

  const load = async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      if (start) qs.set('start', start)
      if (end) qs.set('end', end)
      const q = qs.toString()
      setData(await apiJson<MetricsJson>(`/api/keys/metrics${q ? `?${q}` : ''}`))
    } catch (e) {
      console.error(e)
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (start && end) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load only after defaults
  }, [])

  const k = data?.kpis || {}

  return (
    <div className="container py-4">
      <h1 className="h3 mb-3">Key metrics</h1>
      <Row className="g-2 mb-3 align-items-end">
        <Col xs="auto">
          <Form.Label className="small">Start</Form.Label>
          <Form.Control type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </Col>
        <Col xs="auto">
          <Form.Label className="small">End</Form.Label>
          <Form.Control type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Col>
        <Col xs="auto">
          <Button onClick={load} disabled={loading}>
            {loading ? 'Loading…' : 'Apply'}
          </Button>
        </Col>
      </Row>
      {data?.range && (
        <p className="text-muted small">
          Range: {data.range.start} → {data.range.end}
        </p>
      )}
      {loading && !data && (
        <div className="text-center py-4">
          <Spinner />
        </div>
      )}
      {data && (
        <>
          <Row className="g-3 mb-4">
            <Col md={6} lg={4}>
              <Card>
                <Card.Body>
                  <div className="small text-muted">Total sign-outs</div>
                  <div className="fs-4">{k.total_signouts ?? '—'}</div>
                </Card.Body>
              </Card>
            </Col>
            <Col md={6} lg={4}>
              <Card>
                <Card.Body>
                  <div className="small text-muted">Double sign-outs</div>
                  <div className="fs-4">{k.double_signouts_total ?? '—'}</div>
                </Card.Body>
              </Card>
            </Col>
            <Col md={6} lg={4}>
              <Card>
                <Card.Body>
                  <div className="small text-muted">Returned-by rate</div>
                  <div className="fs-4">{fmtPct(k.returned_by_rate)}</div>
                  <div className="small text-muted">
                    {k.total_returns != null
                      ? `${k.returns_with_returned_by}/${k.total_returns} returns`
                      : ''}
                  </div>
                </Card.Body>
              </Card>
            </Col>
            <Col md={6} lg={4}>
              <Card>
                <Card.Body>
                  <div className="small text-muted">AirTag rate</div>
                  <div className="fs-4">{fmtPct(k.airtag_rate)}</div>
                  <div className="small text-muted">
                    {k.total_signouts != null
                      ? `${k.signouts_with_airtag}/${k.total_signouts} sign-outs`
                      : ''}
                  </div>
                </Card.Body>
              </Card>
            </Col>
            <Col md={6} lg={4}>
              <Card>
                <Card.Body>
                  <div className="small text-muted">Avg time out</div>
                  <div className="fs-4">{fmtDuration(k.avg_out_duration_seconds)}</div>
                </Card.Body>
              </Card>
            </Col>
          </Row>
          <h2 className="h5">Sign-outs by day</h2>
          <Table size="sm" striped className="mb-4">
            <tbody>
              {(data.series?.signouts_by_day || []).map((r, i) => (
                <tr key={i}>
                  <td>{r.day}</td>
                  <td>{r.count}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          <h2 className="h5">Unique users by week</h2>
          <Table size="sm" striped className="mb-4">
            <tbody>
              {(data.series?.unique_users_by_week || []).map((r, i) => (
                <tr key={i}>
                  <td>{r.week}</td>
                  <td>{r.count}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          <h2 className="h5">Double sign-outs by day</h2>
          <Table size="sm" striped>
            <tbody>
              {(data.series?.double_signouts_by_day || []).map((r, i) => (
                <tr key={i}>
                  <td>{r.day}</td>
                  <td>{r.count}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
    </div>
  )
}
