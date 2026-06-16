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
}

export default function ExcludedDeficienciesModal({ show, onHide, startDate, endDate }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<ExcludedDeficiencyRow[]>([])

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
      const payload = (await response.json()) as { deficiencies: ExcludedDeficiencyRow[] }
      if (signal?.aborted) return
      setRows(payload.deficiencies ?? [])
    } catch (e) {
      if (isAbortError(e)) return
      setError('Could not load excluded deficiencies.')
      setRows([])
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

  return (
    <Modal show={show} onHide={onHide} size="xl" scrollable centered>
      <Modal.Header closeButton>
        <Modal.Title>Excluded deficiencies</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="text-muted small mb-3">
          Record-only deficiencies filtered out of service pipeline KPIs for{' '}
          <strong>{startDate}</strong> through <strong>{endDate}</strong>.
        </p>

        {error ? (
          <Alert variant="warning" className="py-2 small">
            {error}
          </Alert>
        ) : null}

        {loading ? (
          <div className="text-center py-4">
            <Spinner />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-muted mb-0">No excluded deficiencies in this date range.</p>
        ) : (
          <Table responsive striped bordered hover size="sm" className="monday-meeting-excluded-def-table mb-0">
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
                    <span className="monday-meeting-excluded-reason">{reasonLabel(row.reason)}</span>
                    {row.detail ? (
                      <div className="text-muted small">{row.detail}</div>
                    ) : null}
                  </td>
                  <td>{row.description?.trim() || '—'}</td>
                  <td className="text-nowrap">{row.service_line ?? '—'}</td>
                  <td className="text-nowrap">{row.reported_by ?? '—'}</td>
                  <td className="text-nowrap">
                    <a href={row.deficiency_url} target="_blank" rel="noopener noreferrer">
                      Open in ST
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
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
