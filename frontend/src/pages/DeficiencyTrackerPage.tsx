import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch, apiJson } from '../lib/apiClient'
import { Badge, Button, Card, Form, Spinner, Table } from 'react-bootstrap'

type DefRow = {
  deficiency_id: string
  status?: string
  reported_on?: string | null
  address?: string
  severity?: string
  company?: string
  reported_by?: string
  job_link?: string
  is_quote_sent?: boolean
  is_quote_approved?: boolean
  hidden?: boolean
  service_line?: string
}

export default function DeficiencyTrackerPage() {
  const [rows, setRows] = useState<DefRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [monthlyAccess, setMonthlyAccess] = useState<'all' | 'yes' | 'no'>('all')
  const [quotedStatus, setQuotedStatus] = useState<'all' | 'yes' | 'no'>('no')
  const [jobComplete, setJobComplete] = useState<'all' | 'yes' | 'no'>('no')
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await apiFetch('/deficiency_tracker/deficiency_list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const j = (await r.json()) as DefRow[]
      setRows(Array.isArray(j) ? j : [])
    } catch (e) {
      console.error(e)
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const visible = useMemo(() => {
    const t = filter.trim().toLowerCase()
    const filtered = rows.filter((r) => {
      if (r.hidden) return false

      const monthly = Boolean((r as DefRow & { monthly_access?: boolean }).monthly_access)
      if (monthlyAccess === 'yes' && !monthly) return false
      if (monthlyAccess === 'no' && monthly) return false

      const quoted = Boolean(r.is_quote_sent || r.is_quote_approved)
      if (quotedStatus === 'yes' && !quoted) return false
      if (quotedStatus === 'no' && quoted) return false

      const complete = Boolean((r as DefRow & { is_job_complete?: boolean }).is_job_complete)
      if (jobComplete === 'yes' && !complete) return false
      if (jobComplete === 'no' && complete) return false

      if (!t) return true
      return (
        String(r.address || '').toLowerCase().includes(t) ||
        String(r.company || '').toLowerCase().includes(t) ||
        String(r.deficiency_id || '').toLowerCase().includes(t)
      )
    })

    filtered.sort((a, b) => {
      const ta = a.reported_on ? new Date(a.reported_on).getTime() : 0
      const tb = b.reported_on ? new Date(b.reported_on).getTime() : 0
      return sortOrder === 'newest' ? tb - ta : ta - tb
    })
    return filtered
  }, [rows, filter, monthlyAccess, quotedStatus, jobComplete, sortOrder])

  const toggleHide = async (deficiency_id: string, hidden: boolean) => {
    await apiJson('/deficiency_tracker/hide_toggle', {
      method: 'POST',
      body: JSON.stringify({ deficiency_id, hidden }),
    })
    await load()
  }

  if (loading) {
    return (
      <div className="d-flex justify-content-center py-5">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="deficiency-page d-flex flex-column gap-3">
      <Card className="app-surface-card deficiency-filters-card">
        <Card.Body className="p-3 p-md-4">
          <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-1">
            <h1 className="h4 mb-0">Deficiencies</h1>
            <Button size="sm" variant="outline-secondary" className="deficiency-refresh-btn" onClick={load}>
              Refresh
            </Button>
          </div>
          <p className="text-muted small mb-3">Filter and review outstanding deficiencies.</p>
          <div className="d-flex flex-wrap align-items-end gap-2">
            <Form.Group>
              <Form.Label className="small text-muted mb-1">Search</Form.Label>
              <Form.Control
                placeholder="Address / company / deficiency id"
                style={{ minWidth: 260 }}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </Form.Group>
            <Form.Group>
              <Form.Label className="small text-muted mb-1">Monthly Access</Form.Label>
              <Form.Select
                style={{ minWidth: 170 }}
                value={monthlyAccess}
                onChange={(e) => setMonthlyAccess(e.target.value as 'all' | 'yes' | 'no')}
                aria-label="Monthly access filter"
              >
                <option value="all">All</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </Form.Select>
            </Form.Group>
            <Form.Group>
              <Form.Label className="small text-muted mb-1">Quoted</Form.Label>
              <Form.Select
                style={{ minWidth: 140 }}
                value={quotedStatus}
                onChange={(e) => setQuotedStatus(e.target.value as 'all' | 'yes' | 'no')}
                aria-label="Quoted status filter"
              >
                <option value="all">All</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </Form.Select>
            </Form.Group>
            <Form.Group>
              <Form.Label className="small text-muted mb-1">Job Complete</Form.Label>
              <Form.Select
                style={{ minWidth: 160 }}
                value={jobComplete}
                onChange={(e) => setJobComplete(e.target.value as 'all' | 'yes' | 'no')}
                aria-label="Job complete filter"
              >
                <option value="all">All</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </Form.Select>
            </Form.Group>
            <Form.Group>
              <Form.Label className="small text-muted mb-1">Sort</Form.Label>
              <Form.Select
                style={{ minWidth: 140 }}
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as 'newest' | 'oldest')}
                aria-label="Sort by date"
              >
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
              </Form.Select>
            </Form.Group>
          </div>
        </Card.Body>
      </Card>

      <Card className="app-surface-card deficiency-results-card">
        <Card.Body className="p-2 p-md-3">
          <div className="table-responsive deficiency-results-table-wrap">
            <Table hover size="sm" className="mb-0 align-middle deficiency-results-table">
              <thead>
                <tr>
                  <th>Reported</th>
                  <th>Address</th>
                  <th>Severity</th>
                  <th>Company</th>
                  <th>Reporter</th>
                  <th>Quote</th>
                  <th>Job</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.deficiency_id}>
                    <td>{r.reported_on ? new Date(r.reported_on).toLocaleDateString() : '—'}</td>
                    <td>{r.address ?? '—'}</td>
                    <td>{r.severity ?? '—'}</td>
                    <td>{r.company ?? '—'}</td>
                    <td>{r.reported_by ?? '—'}</td>
                    <td>
                      {r.is_quote_approved ? (
                        <Badge bg="success">Approved</Badge>
                      ) : r.is_quote_sent ? (
                        <Badge bg="info">Sent</Badge>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td>
                      {r.job_link ? (
                        <a href={r.job_link} target="_blank" rel="noreferrer" className="deficiency-job-link">
                          Open
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <Button
                        size="sm"
                        variant="outline-warning"
                        className="deficiency-hide-btn"
                        onClick={() => toggleHide(r.deficiency_id, true)}
                      >
                        Hide
                      </Button>
                    </td>
                  </tr>
                ))}
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center text-muted py-4">
                      No deficiencies match your filters.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </Table>
          </div>
        </Card.Body>
      </Card>
    </div>
  )
}
