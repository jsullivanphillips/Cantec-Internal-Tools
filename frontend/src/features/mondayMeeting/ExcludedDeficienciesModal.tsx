import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Modal, Spinner, Table } from 'react-bootstrap'
import { apiFetch, isAbortError } from '../../lib/apiClient'

export type ExcludedDeficiencyRow = {
  deficiency_id: number
  description: string | null
  service_line: string | null
  reported_by: string | null
  deficiency_created_on: string | null
  reason: 'keyword' | 'stale_cluster' | string
  detail: string | null
  included_override?: boolean
  deficiency_url: string
}

function reasonLabel(reason: string): string {
  if (reason === 'keyword') return 'Keyword match'
  if (reason === 'stale_cluster') return 'Similar unquoted cluster'
  return reason
}

type Props = {
  show: boolean
  onHide: () => void
  startDate: string
  endDate: string
  onEligibilityChanged?: () => void
}

export default function ExcludedDeficienciesModal({
  show,
  onHide,
  startDate,
  endDate,
  onEligibilityChanged,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<number | null>(null)
  const [rows, setRows] = useState<ExcludedDeficiencyRow[]>([])
  const [manualIncludes, setManualIncludes] = useState<ExcludedDeficiencyRow[]>([])

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    try {
      const q = new URLSearchParams()
      if (startDate) q.set('start_date', startDate)
      if (endDate) q.set('end_date', endDate)
      const query = q.toString()
      const response = await apiFetch(
        `/api/monday_meeting/service/excluded_deficiencies${query ? `?${query}` : ''}`,
        { signal },
      )
      if (!response.ok) throw new Error('load_failed')
      const payload = (await response.json()) as {
        deficiencies: ExcludedDeficiencyRow[]
        manual_includes?: ExcludedDeficiencyRow[]
      }
      if (signal?.aborted) return
      setRows(payload.deficiencies ?? [])
      setManualIncludes(payload.manual_includes ?? [])
    } catch (e) {
      if (isAbortError(e)) return
      setError('Could not load excluded deficiencies.')
      setRows([])
      setManualIncludes([])
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [startDate, endDate])

  useEffect(() => {
    if (!show) return
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [show, load])

  const includeDeficiency = useCallback(
    async (deficiencyId: number) => {
      setPendingId(deficiencyId)
      setActionError(null)
      try {
        const response = await apiFetch(
          `/api/monday_meeting/service/excluded_deficiencies/${deficiencyId}/include`,
          { method: 'POST' },
        )
        if (!response.ok) throw new Error('include_failed')
        await load()
        onEligibilityChanged?.()
      } catch {
        setActionError('Could not include that deficiency in metrics.')
      } finally {
        setPendingId(null)
      }
    },
    [load, onEligibilityChanged],
  )

  const excludeDeficiencyAgain = useCallback(
    async (deficiencyId: number) => {
      setPendingId(deficiencyId)
      setActionError(null)
      try {
        const response = await apiFetch(
          `/api/monday_meeting/service/excluded_deficiencies/${deficiencyId}/include`,
          { method: 'DELETE' },
        )
        if (!response.ok) throw new Error('exclude_failed')
        await load()
        onEligibilityChanged?.()
      } catch {
        setActionError('Could not remove the include override.')
      } finally {
        setPendingId(null)
      }
    },
    [load, onEligibilityChanged],
  )

  const hasRows = rows.length > 0 || manualIncludes.length > 0

  return (
    <Modal show={show} onHide={onHide} size="xl" scrollable centered>
      <Modal.Header closeButton>
        <Modal.Title>Excluded deficiencies</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="text-muted small mb-3">
          Record-only deficiencies filtered out of service pipeline KPIs for{' '}
          <strong>{startDate}</strong> through <strong>{endDate}</strong>. Use{' '}
          <strong>Include in metrics</strong> to override the filter; overrides persist across
          reclassification.
        </p>

        {error ? (
          <Alert variant="warning" className="py-2 small">
            {error}
          </Alert>
        ) : null}

        {actionError ? (
          <Alert variant="warning" className="py-2 small">
            {actionError}
          </Alert>
        ) : null}

        {loading ? (
          <div className="text-center py-4">
            <Spinner />
          </div>
        ) : !hasRows ? (
          <p className="text-muted mb-0">No excluded deficiencies in this date range.</p>
        ) : (
          <>
            {manualIncludes.length > 0 ? (
              <section className="mb-4">
                <h6 className="mb-2">Manually included in metrics</h6>
                <p className="text-muted small mb-2">
                  These deficiencies were filter-excluded but are counted in pipeline KPIs.
                </p>
                <Table
                  responsive
                  striped
                  bordered
                  hover
                  size="sm"
                  className="monday-meeting-excluded-def-table mb-0"
                >
                  <thead>
                    <tr>
                      <th>Reported</th>
                      <th>Original reason</th>
                      <th>Description</th>
                      <th>Service line</th>
                      <th>Reported by</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {manualIncludes.map((row) => (
                      <tr key={row.deficiency_id}>
                        <td className="text-nowrap">{row.deficiency_created_on ?? '—'}</td>
                        <td className="text-nowrap">
                          <span className="monday-meeting-excluded-reason">
                            {reasonLabel(row.reason)}
                          </span>
                          {row.detail ? (
                            <div className="text-muted small">{row.detail}</div>
                          ) : null}
                        </td>
                        <td>{row.description?.trim() || '—'}</td>
                        <td className="text-nowrap">{row.service_line ?? '—'}</td>
                        <td className="text-nowrap">{row.reported_by ?? '—'}</td>
                        <td className="text-nowrap">
                          <Button
                            variant="outline-secondary"
                            size="sm"
                            className="me-2"
                            disabled={pendingId === row.deficiency_id}
                            onClick={() => void excludeDeficiencyAgain(row.deficiency_id)}
                          >
                            {pendingId === row.deficiency_id ? (
                              <Spinner animation="border" size="sm" />
                            ) : (
                              'Exclude again'
                            )}
                          </Button>
                          <a href={row.deficiency_url} target="_blank" rel="noopener noreferrer">
                            Open in ST
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </section>
            ) : null}

            {rows.length > 0 ? (
              <section>
                {manualIncludes.length > 0 ? (
                  <h6 className="mb-2">Currently excluded</h6>
                ) : null}
                <Table
                  responsive
                  striped
                  bordered
                  hover
                  size="sm"
                  className="monday-meeting-excluded-def-table mb-0"
                >
                  <thead>
                    <tr>
                      <th>Reported</th>
                      <th>Reason</th>
                      <th>Description</th>
                      <th>Service line</th>
                      <th>Reported by</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.deficiency_id}>
                        <td className="text-nowrap">{row.deficiency_created_on ?? '—'}</td>
                        <td className="text-nowrap">
                          <span className="monday-meeting-excluded-reason">
                            {reasonLabel(row.reason)}
                          </span>
                          {row.detail ? (
                            <div className="text-muted small">{row.detail}</div>
                          ) : null}
                        </td>
                        <td>{row.description?.trim() || '—'}</td>
                        <td className="text-nowrap">{row.service_line ?? '—'}</td>
                        <td className="text-nowrap">{row.reported_by ?? '—'}</td>
                        <td className="text-nowrap">
                          <Button
                            variant="outline-primary"
                            size="sm"
                            className="me-2"
                            disabled={pendingId === row.deficiency_id}
                            onClick={() => void includeDeficiency(row.deficiency_id)}
                          >
                            {pendingId === row.deficiency_id ? (
                              <Spinner animation="border" size="sm" />
                            ) : (
                              'Include in metrics'
                            )}
                          </Button>
                          <a href={row.deficiency_url} target="_blank" rel="noopener noreferrer">
                            Open in ST
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </section>
            ) : null}
          </>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>
          Close
        </Button>
      </Modal.Footer>
    </Modal>
  )
}
