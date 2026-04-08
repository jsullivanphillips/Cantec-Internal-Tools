import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { apiFetch, apiJson, isAbortError } from '../lib/apiClient'
import { Badge, Button, Card, Form, Table } from 'react-bootstrap'

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

/** Reported date; Pacific, e.g. Apr-07-2026. */
function formatReportedMmmDdYyyy(iso: string | null | undefined): string {
  if (!iso) return '—'
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

function DefSkeletonBar({
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

const DEF_FILTER_SKELETON_WIDTHS = [260, 170, 140, 160, 140]

function DeficiencyTrackerPageSkeleton() {
  return (
    <div
      className="deficiency-page d-flex flex-column gap-3 home-skeleton"
      aria-busy="true"
      aria-label="Loading deficiencies"
    >
      <Card className="app-surface-card deficiency-filters-card">
        <Card.Body className="p-3 p-md-4">
          <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-1">
            <DefSkeletonBar width={180} height={26} />
            <DefSkeletonBar width={76} height={31} />
          </div>
          <DefSkeletonBar width="min(22rem, 90%)" height={14} className="mb-3" />
          <div className="d-flex flex-wrap align-items-end gap-2">
            {DEF_FILTER_SKELETON_WIDTHS.map((w, i) => (
              <div key={i}>
                <DefSkeletonBar width={52} height={11} className="mb-1" />
                <DefSkeletonBar width={w} height={38} />
              </div>
            ))}
          </div>
        </Card.Body>
      </Card>
      <Card className="app-surface-card deficiency-results-card">
        <Card.Body className="p-2 p-md-3">
          <div className="table-responsive deficiency-results-table-wrap">
            <Table size="sm" className="mb-0 align-middle deficiency-results-table">
              <thead>
                <tr>
                  <th>Reported</th>
                  <th>Address</th>
                  <th>Severity</th>
                  <th>Company</th>
                  <th>Reporter</th>
                  <th>Quote</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 12 }, (_, row) => (
                  <tr key={row}>
                    <td>
                      <DefSkeletonBar width={72} height={13} />
                    </td>
                    <td>
                      <DefSkeletonBar width={`${78 - (row % 4) * 6}%`} height={13} />
                    </td>
                    <td>
                      <DefSkeletonBar width={56} height={13} />
                    </td>
                    <td>
                      <DefSkeletonBar width={`${60 + (row % 3) * 8}%`} height={13} />
                    </td>
                    <td>
                      <DefSkeletonBar width={`${50 + (row % 2) * 12}%`} height={13} />
                    </td>
                    <td>
                      <DefSkeletonBar width={64} height={22} />
                    </td>
                    <td>
                      <DefSkeletonBar width={52} height={28} />
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

export default function DeficiencyTrackerPage() {
  const [rows, setRows] = useState<DefRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [monthlyAccess, setMonthlyAccess] = useState<'all' | 'yes' | 'no'>('all')
  const [quotedStatus, setQuotedStatus] = useState<'all' | 'yes' | 'no'>('no')
  const [jobComplete, setJobComplete] = useState<'all' | 'yes' | 'no'>('no')
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest')

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    try {
      const r = await apiFetch('/deficiency_tracker/deficiency_list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal,
      })
      if (signal?.aborted) return
      const j = (await r.json()) as DefRow[]
      setRows(Array.isArray(j) ? j : [])
    } catch (e) {
      if (isAbortError(e)) return
      console.error(e)
      setRows([])
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
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
    return <DeficiencyTrackerPageSkeleton />
  }

  return (
    <div className="deficiency-page d-flex flex-column gap-3">
      <Card className="app-surface-card deficiency-filters-card">
        <Card.Body className="p-3 p-md-4">
          <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-1">
            <h1 className="processing-page-title mb-0">Deficiencies</h1>
            <Button
              size="sm"
              variant="outline-secondary"
              className="deficiency-refresh-btn"
              onClick={() => void load()}
            >
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
            <Table size="sm" className="mb-0 align-middle deficiency-results-table">
              <thead>
                <tr>
                  <th>Reported</th>
                  <th>Address</th>
                  <th>Severity</th>
                  <th>Company</th>
                  <th>Reporter</th>
                  <th>Quote</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const href = r.job_link?.trim() || ''
                  const interactive = Boolean(href)
                  const label = `Open job${r.address ? `: ${r.address}` : ''} in new tab`
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
                      key={r.deficiency_id}
                      className={`deficiency-data-row${interactive ? ' deficiency-results-row--interactive' : ''}`}
                      tabIndex={interactive ? 0 : undefined}
                      role={interactive ? 'link' : undefined}
                      aria-label={interactive ? label : undefined}
                      onClick={interactive ? () => openJobInNewTab(href) : undefined}
                      onKeyDown={onRowKeyDown}
                    >
                      <td>{formatReportedMmmDdYyyy(r.reported_on)}</td>
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
                        <Button
                          type="button"
                          size="sm"
                          variant="outline-warning"
                          className="deficiency-hide-btn"
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleHide(r.deficiency_id, true)
                          }}
                        >
                          Hide
                        </Button>
                      </td>
                    </tr>
                  )
                })}
                {visible.length === 0 ? (
                  <tr className="deficiency-empty-row">
                    <td colSpan={7} className="text-center text-muted py-4">
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
