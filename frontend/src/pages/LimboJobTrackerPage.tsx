import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../lib/apiClient'
import {
  Button,
  Form,
  Pagination,
  Spinner,
  Table,
} from 'react-bootstrap'

type Job = {
  job_id?: number
  job_link?: string
  address?: string
  most_recent_appt?: string
  type?: string
}

function normalize(payload: unknown): Job[] {
  const raw =
    payload && typeof payload === 'object' && 'data' in payload
      ? (payload as { data: unknown }).data
      : payload
  if (Array.isArray(raw)) return raw as Job[]
  if (raw && typeof raw === 'object') {
    return Object.entries(raw as Record<string, Job>).map(([jobId, v]) => ({
      job_id: Number(jobId) || v?.job_id,
      ...v,
    }))
  }
  return []
}

function isUnscheduled(job: Job) {
  return !job.most_recent_appt || job.most_recent_appt === 'Not Scheduled'
}

function apptTime(job: Job) {
  if (isUnscheduled(job)) return 0
  const t = new Date(job.most_recent_appt!).getTime()
  return Number.isNaN(t) ? 0 : t
}

export default function LimboJobTrackerPage() {
  const [allJobs, setAllJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<'oldest' | 'newest'>('oldest')
  const [unscheduledFirst, setUnscheduledFirst] = useState(true)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  const load = () => {
    setLoading(true)
    apiFetch('/limbo_job_tracker/job_list', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then((r) => r.json())
      .then((j) => setAllJobs(normalize(j)))
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    let f = allJobs.filter((j) => {
      const addr = String(j.address || '').toLowerCase()
      const typ = String(j.type || '').toLowerCase()
      return !term || addr.includes(term) || typ.includes(term)
    })
    f.sort((a, b) => {
      const au = isUnscheduled(a)
      const bu = isUnscheduled(b)
      if (unscheduledFirst && au !== bu) return au ? -1 : 1
      const ta = apptTime(a)
      const tb = apptTime(b)
      return sort === 'newest' ? tb - ta : ta - tb
    })
    return f
  }, [allJobs, q, sort, unscheduledFirst])

  useEffect(() => {
    setPage(1)
  }, [q, sort, unscheduledFirst, pageSize])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const slice = filtered.slice((page - 1) * pageSize, page * pageSize)

  if (loading) {
    return (
      <div className="text-center py-5">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="container py-4">
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
        <h1 className="h3 mb-0">Limbo Job Tracker</h1>
        <Button size="sm" variant="outline-primary" onClick={load}>
          Refresh
        </Button>
      </div>
      <p className="text-muted small">{filtered.length} jobs</p>
      <div className="d-flex flex-wrap gap-2 mb-3">
        <Form.Control placeholder="Search address / type" style={{ maxWidth: 280 }} value={q} onChange={(e) => setQ(e.target.value)} />
        <Form.Select style={{ maxWidth: 160 }} value={sort} onChange={(e) => setSort(e.target.value as 'oldest' | 'newest')}>
          <option value="oldest">Oldest appt first</option>
          <option value="newest">Newest appt first</option>
        </Form.Select>
        <Form.Select style={{ maxWidth: 120 }} value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
          {[10, 25, 50, 100].map((n) => (
            <option key={n} value={n}>
              {n}/page
            </option>
          ))}
        </Form.Select>
        <Form.Check
          type="checkbox"
          label="Unscheduled first"
          checked={unscheduledFirst}
          onChange={(e) => setUnscheduledFirst(e.target.checked)}
          className="d-flex align-items-center"
        />
      </div>
      <Table responsive hover size="sm">
        <thead className="table-light">
          <tr>
            <th>Address</th>
            <th>Type</th>
            <th>Next appt</th>
            <th>Job</th>
          </tr>
        </thead>
        <tbody>
          {slice.map((j, i) => (
            <tr key={j.job_id ?? i}>
              <td>{j.address ?? '—'}</td>
              <td>{j.type ?? '—'}</td>
              <td>
                {isUnscheduled(j)
                  ? 'Not scheduled'
                  : new Date(j.most_recent_appt!).toLocaleDateString()}
              </td>
              <td>
                {j.job_link ? (
                  <a href={j.job_link} target="_blank" rel="noreferrer">
                    Open
                  </a>
                ) : (
                  '—'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      {totalPages > 1 && (
        <Pagination className="justify-content-center">
          <Pagination.Prev disabled={page <= 1} onClick={() => setPage((p) => p - 1)} />
          <Pagination.Item active>{page}</Pagination.Item>
          <Pagination.Next disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} />
        </Pagination>
      )}
    </div>
  )
}
