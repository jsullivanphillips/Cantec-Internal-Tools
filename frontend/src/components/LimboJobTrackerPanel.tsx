import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { apiFetch } from '../lib/apiClient'
import { Alert, Button, Card, Form, Pagination, Table } from 'react-bootstrap'

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

/** e.g. `service_call` → `Service call` (sentence case). */
function formatJobTypeSentence(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim()
  if (!s) return '—'
  return s
    .replace(/_/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) =>
      i === 0 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase(),
    )
    .join(' ')
}

/** Next appointment; Pacific, e.g. Apr-07-2026. */
function formatApptMmmDdYyyy(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Vancouver',
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  }).formatToParts(d)
  const month = (parts.find((p) => p.type === 'month')?.value ?? '').replace(/\.$/, '')
  const day = parts.find((p) => p.type === 'day')?.value ?? ''
  const year = parts.find((p) => p.type === 'year')?.value ?? ''
  if (!month || !day || !year) return '—'
  return `${month}-${day}-${year}`
}

function openJobInNewTab(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer')
}

function apptTime(job: Job) {
  if (isUnscheduled(job)) return 0
  const t = new Date(job.most_recent_appt!).getTime()
  return Number.isNaN(t) ? 0 : t
}

function LimboSkeletonBar({
  width,
  height = 13,
  className = '',
}: {
  width: number | string
  height?: number
  className?: string
}) {
  return (
    <span
      className={`home-skeleton-bar d-block ${className}`.trim()}
      style={{
        width: typeof width === 'number' ? `${width}px` : width,
        height,
        borderRadius: height > 14 ? 6 : undefined,
        maxWidth: '100%',
      }}
    />
  )
}

function LimboJobTrackerPanelSkeleton() {
  const rowPlaceholders = [0.92, 0.72, 0.85, 0.68, 0.88, 0.55, 0.9, 0.62, 0.78, 0.7, 0.82, 0.65]
  return (
    <div
      className="limbo-job-tracker-panel d-flex flex-column gap-3 home-skeleton"
      aria-busy="true"
      aria-label="Loading limbo jobs"
    >
      <Card className="app-surface-card limbo-filters-card limbo-skeleton-card">
        <Card.Body className="p-3 p-md-4">
          <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-1">
            <LimboSkeletonBar width={200} height={24} />
            <LimboSkeletonBar width={76} height={31} />
          </div>
          <LimboSkeletonBar width="min(22rem, 90%)" height={14} className="mb-3" />
          <div className="d-flex flex-wrap align-items-end gap-3">
            <div>
              <LimboSkeletonBar width={52} height={11} className="mb-1" />
              <LimboSkeletonBar width={260} height={38} />
            </div>
            <div>
              <LimboSkeletonBar width={36} height={11} className="mb-1" />
              <LimboSkeletonBar width={140} height={38} />
            </div>
            <div>
              <LimboSkeletonBar width={72} height={11} className="mb-1" />
              <LimboSkeletonBar width={120} height={38} />
            </div>
            <div>
              <LimboSkeletonBar width={120} height={11} className="mb-1" />
              <LimboSkeletonBar width={148} height={22} />
            </div>
          </div>
        </Card.Body>
      </Card>
      <Card className="app-surface-card limbo-results-card limbo-skeleton-card">
        <Card.Body className="p-2 p-md-3">
          <div className="table-responsive limbo-results-table-wrap">
            <Table size="sm" className="mb-0 align-middle limbo-results-table">
              <thead>
                <tr>
                  <th>Address</th>
                  <th>Type</th>
                  <th>Next appt</th>
                </tr>
              </thead>
              <tbody>
                {rowPlaceholders.map((frac, i) => (
                  <tr key={i}>
                    <td>
                      <LimboSkeletonBar width={`${frac * 100}%`} height={13} />
                    </td>
                    <td>
                      <LimboSkeletonBar width={88} height={13} />
                    </td>
                    <td>
                      <LimboSkeletonBar width={96} height={13} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card.Body>
      </Card>
    </div>
  )
}

/** Limbo jobs table; used inside Jobs Backlog → Limbo jobs tab. */
export default function LimboJobTrackerPanel() {
  const [allJobs, setAllJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<'oldest' | 'newest'>('oldest')
  const [unscheduledFirst, setUnscheduledFirst] = useState(true)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  const load = () => {
    setLoading(true)
    setError(null)
    apiFetch('/limbo_job_tracker/job_list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
      .then((r) => {
        if (!r.ok) throw new Error('request failed')
        return r.json()
      })
      .then((j) => setAllJobs(normalize(j)))
      .catch(() => {
        setAllJobs([])
        setError('Could not load jobs. Check your connection and try Refresh.')
      })
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
    return <LimboJobTrackerPanelSkeleton />
  }

  return (
    <div className="limbo-job-tracker-panel d-flex flex-column gap-3">
      <Card className="app-surface-card limbo-filters-card">
        <Card.Body className="p-3 p-md-4">
          <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-1">
            <h2 className="h4 mb-0">Limbo Jobs</h2>
            <Button
              size="sm"
              variant="outline-secondary"
              type="button"
              className="limbo-refresh-btn"
              onClick={load}
            >
              Refresh
            </Button>
          </div>
          <p className="text-muted small mb-3">
            Jobs waiting on scheduling or next steps. Use filters to narrow the list.
          </p>
          {error ? (
            <Alert variant="warning" className="py-2 small mb-3">
              {error}
            </Alert>
          ) : null}
          <div className="d-flex flex-wrap align-items-end gap-2 gap-md-3">
            <Form.Group>
              <Form.Label className="small text-muted mb-1">Search</Form.Label>
              <Form.Control
                placeholder="Address or job type"
                style={{ minWidth: 260 }}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label="Search by address or type"
              />
            </Form.Group>
            <Form.Group>
              <Form.Label className="small text-muted mb-1">Sort</Form.Label>
              <Form.Select
                style={{ minWidth: 140 }}
                value={sort}
                onChange={(e) => setSort(e.target.value as 'oldest' | 'newest')}
                aria-label="Sort by appointment date"
              >
                <option value="oldest">Oldest</option>
                <option value="newest">Newest</option>
              </Form.Select>
            </Form.Group>
            <Form.Group>
              <Form.Label className="small text-muted mb-1">Rows</Form.Label>
              <Form.Select
                style={{ minWidth: 120 }}
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                aria-label="Rows per page"
              >
                {[10, 25, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n} / page
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
            <Form.Group className="d-flex align-items-center pb-1">
              <Form.Check
                type="checkbox"
                id="limbo-unscheduled-first"
                label="Unscheduled first"
                checked={unscheduledFirst}
                onChange={(e) => setUnscheduledFirst(e.target.checked)}
              />
            </Form.Group>
          </div>
        </Card.Body>
      </Card>

      <Card className="app-surface-card limbo-results-card">
        <Card.Body className="p-2 p-md-3">
          <p className="text-muted small mb-2 px-1">
            {filtered.length} {filtered.length === 1 ? 'job' : 'jobs'}
            {q.trim() ? ' match your filters' : ' total'}
          </p>
          <div className="table-responsive limbo-results-table-wrap">
            <Table size="sm" className="mb-0 align-middle limbo-results-table">
              <thead>
                <tr>
                  <th>Address</th>
                  <th>Type</th>
                  <th>Next appt</th>
                </tr>
              </thead>
              <tbody>
                {slice.map((j, i) => {
                  const href = j.job_link?.trim() || ''
                  const interactive = Boolean(href)
                  const label = `Open job${j.address ? `: ${j.address}` : ''} in new tab`
                  const onRowKeyDown = interactive
                    ? (e: KeyboardEvent<HTMLTableRowElement>) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          openJobInNewTab(href)
                        }
                      }
                    : undefined
                  return (
                    <tr
                      key={j.job_id ?? i}
                      className={interactive ? 'limbo-results-row--interactive' : undefined}
                      tabIndex={interactive ? 0 : undefined}
                      role={interactive ? 'link' : undefined}
                      aria-label={interactive ? label : undefined}
                      onClick={interactive ? () => openJobInNewTab(href) : undefined}
                      onKeyDown={onRowKeyDown}
                    >
                      <td>{j.address ?? '—'}</td>
                      <td>{formatJobTypeSentence(j.type)}</td>
                      <td>
                        {isUnscheduled(j) ? 'Not scheduled' : formatApptMmmDdYyyy(j.most_recent_appt!)}
                      </td>
                    </tr>
                  )
                })}
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="text-center text-muted py-4">
                      {error
                        ? 'No data to show.'
                        : allJobs.length === 0
                          ? 'No limbo jobs right now.'
                          : 'No jobs match your filters.'}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </Table>
          </div>
          {totalPages > 1 && (
            <Pagination className="justify-content-center mt-3 mb-0">
              <Pagination.Prev disabled={page <= 1} onClick={() => setPage((p) => p - 1)} />
              <Pagination.Item active>{page}</Pagination.Item>
              <Pagination.Next disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} />
            </Pagination>
          )}
        </Card.Body>
      </Card>
    </div>
  )
}
