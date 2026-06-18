import { useCallback, useEffect, useState } from 'react'
import { Alert, Badge, Button, Col, Form, Modal, Row, Spinner, Table } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import { apiPostFormData } from '../../lib/apiClient'
import { parseYearMonth, routeDisplayLabel } from './monthlyRoutesShared'

function formatMonthHeading(monthFirstIso: string): string {
  const ym = parseYearMonth(monthFirstIso)
  if (!ym) return monthFirstIso
  return new Intl.DateTimeFormat('en-CA', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(ym.year, ym.month - 1, 1)))
}

/** Issue surfaced by the route-inspection CSV importer for a single CSV row. */
export type UploadRunIssue = {
  kind: string
  csv_row: number
  detail: string
}

/** ``POST /api/monthly_routes/routes/:id/runs/import_csv`` success payload. */
export type UploadRunResponse = {
  ok: true
  route: {
    id: number
    route_number: number
    label: string
    display_name?: string | null
    display_label?: string | null
  }
  month_date: string
  run: {
    id: number
    monthly_route_id: number
    month_date: string
    status: string
    started_at: string | null
    completed_at: string | null
    source: string
  } | null
  sheet_label: string | null
  locations_updated: number
  history_upserts: number
  rows_without_history_signal: number
  existing_status_preserved?: number
  sync_stop_order?: boolean
  stop_order_applied?: number
  stop_order_skipped_not_on_sheet_route?: number
  session_stop_order_applied?: number
  issues: UploadRunIssue[]
}

type Props = {
  show: boolean
  onClose: () => void
  routeId: number
  routeNumber: number
  routeLabel: string
  targetMonthIso?: string | null
  onUploaded?: (result: UploadRunResponse) => void
}

export default function UploadRunFromCsvModal({
  show,
  onClose,
  routeId,
  routeNumber,
  routeLabel,
  targetMonthIso = null,
  onUploaded,
}: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [syncStopOrder, setSyncStopOrder] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [blockedMonthIso, setBlockedMonthIso] = useState<string | null>(null)
  const [result, setResult] = useState<UploadRunResponse | null>(null)
  const [issuesExpanded, setIssuesExpanded] = useState(false)

  useEffect(() => {
    if (!show) {
      setFile(null)
      setSyncStopOrder(false)
      setSubmitting(false)
      setError(null)
      setBlockedMonthIso(null)
      setResult(null)
      setIssuesExpanded(false)
    }
  }, [show])

  const onSubmit = useCallback(async () => {
    if (!file) {
      setError('Choose a CSV file first.')
      return
    }
    setSubmitting(true)
    setError(null)
    setBlockedMonthIso(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      if (syncStopOrder) {
        fd.append('sync_stop_order', '1')
      }
      const res = await apiPostFormData<UploadRunResponse>(
        `/api/monthly_routes/routes/${routeId}/runs/import_csv`,
        fd,
      )
      if (targetMonthIso && res.month_date !== targetMonthIso) {
        setError(
          `This CSV is dated ${formatMonthHeading(res.month_date)} but you opened upload for ${formatMonthHeading(targetMonthIso)}. Choose a CSV for the correct month.`,
        )
        return
      }
      setResult(res)
      onUploaded?.(res)
    } catch (e) {
      const body = typeof e === 'object' && e != null ? (e as Record<string, unknown>) : null
      const message =
        body && 'error' in body
          ? String(body.error)
          : typeof e === 'string'
            ? e
            : 'Upload failed.'
      setError(message)
      const code = body && typeof body.code === 'string' ? body.code : ''
      const monthDate = body && typeof body.month_date === 'string' ? body.month_date.trim() : ''
      if (code === 'run_completed_csv_blocked' && monthDate) {
        setBlockedMonthIso(monthDate)
      }
    } finally {
      setSubmitting(false)
    }
  }, [file, routeId, syncStopOrder, targetMonthIso, onUploaded])

  const formattedMonth = result?.month_date ? formatMonthHeading(result.month_date) : null
  const monthIso = result?.month_date ?? null
  const targetMonthLabel = targetMonthIso ? formatMonthHeading(targetMonthIso) : null

  return (
    <Modal show={show} onHide={onClose} size="lg" backdrop={submitting ? 'static' : true}>
      <Modal.Header closeButton={!submitting}>
        <Modal.Title>Upload run from CSV</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {targetMonthLabel ? (
          <Alert variant="info" className="mb-3">
            CSV must be dated <strong>{targetMonthLabel}</strong> (check the sheet DATE row).
          </Alert>
        ) : null}
        {result ? (
          <>
            <Alert variant="success" className="mb-3">
              Run materialized for <strong>{routeDisplayLabel(result.route)}</strong> ·{' '}
              <strong>{formattedMonth}</strong>.
            </Alert>
            <Row className="g-3 mb-3">
              <Col xs={6} md={3}>
                <div className="text-muted small text-uppercase fw-semibold">Stops updated</div>
                <div className="h4 mb-0 tabular-nums">{result.locations_updated}</div>
              </Col>
              <Col xs={6} md={3}>
                <div className="text-muted small text-uppercase fw-semibold">History upserts</div>
                <div className="h4 mb-0 tabular-nums">{result.history_upserts}</div>
              </Col>
              <Col xs={6} md={3}>
                <div className="text-muted small text-uppercase fw-semibold">Untimed rows</div>
                <div className="h4 mb-0 tabular-nums">{result.rows_without_history_signal}</div>
              </Col>
              <Col xs={6} md={3}>
                <div className="text-muted small text-uppercase fw-semibold">Issues</div>
                <div className="h4 mb-0 tabular-nums">{result.issues.length}</div>
              </Col>
            </Row>
            {result.sync_stop_order ? (
              <p className="small text-muted mb-3">
                Stop order updated for{' '}
                <strong className="tabular-nums">{result.stop_order_applied ?? 0}</strong> location
                {(result.stop_order_applied ?? 0) === 1 ? '' : 's'} on this route
                {(result.session_stop_order_applied ?? 0) > 0 ? (
                  <>
                    {' '}
                    (<strong className="tabular-nums">{result.session_stop_order_applied}</strong>{' '}
                    worksheet location
                    {(result.session_stop_order_applied ?? 0) === 1 ? '' : 's'} reordered for this
                    month)
                  </>
                ) : null}
                .
                {(result.stop_order_skipped_not_on_sheet_route ?? 0) > 0 ? (
                  <>
                    {' '}
                    {result.stop_order_skipped_not_on_sheet_route} CSV row
                    {(result.stop_order_skipped_not_on_sheet_route ?? 0) === 1 ? ' was' : 's were'}{' '}
                    skipped because the site is not assigned to this route.
                  </>
                ) : null}
              </p>
            ) : null}
            {result.issues.length > 0 ? (
              <div className="mb-3">
                <Button
                  variant="link"
                  size="sm"
                  className="px-0"
                  onClick={() => setIssuesExpanded((v) => !v)}
                >
                  {issuesExpanded ? 'Hide' : 'Show'} {result.issues.length} issue
                  {result.issues.length === 1 ? '' : 's'}
                </Button>
                {issuesExpanded ? (
                  <div
                    className="border rounded mt-2 small"
                    style={{ maxHeight: '14rem', overflow: 'auto' }}
                  >
                    <Table size="sm" className="mb-0">
                      <thead>
                        <tr>
                          <th style={{ width: '7rem' }}>Kind</th>
                          <th style={{ width: '5rem' }}>Row</th>
                          <th>Detail</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.issues.map((iss, i) => (
                          <tr key={`${iss.kind}-${iss.csv_row}-${i}`}>
                            <td>
                              <Badge bg={iss.kind === 'route_mismatch' ? 'warning' : 'danger'}>
                                {iss.kind}
                              </Badge>
                            </td>
                            <td className="tabular-nums">{iss.csv_row}</td>
                            <td className="text-break">{iss.detail}</td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        ) : (
          <>
            <p className="text-muted mb-3">
              Upload the technician inspection sheet (the same CSV you use on the route). The page
              detects the route and month from the preamble; you&apos;ll get an error if the CSV is
              for a different route. If that month&apos;s run is marked{' '}
              <span className="fw-semibold text-body">completed</span> on Paperwork, use{' '}
              <span className="fw-semibold text-body">Reopen job</span> there before uploading again.
            </p>
            <Form.Group controlId="upload-run-csv-file" className="mb-3">
              <Form.Label>CSV file</Form.Label>
              <Form.Control
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  const t = e.target as HTMLInputElement
                  setFile(t.files && t.files.length > 0 ? t.files[0] : null)
                  setError(null)
                }}
                disabled={submitting}
              />
              <Form.Text className="text-muted">
                Page route: <strong>R{routeNumber}</strong> — {routeLabel}
              </Form.Text>
            </Form.Group>
            <Form.Check
              type="checkbox"
              id="upload-run-csv-sync-stop-order"
              className="mb-3"
              label="Reorder stops to match CSV (# column)"
              checked={syncStopOrder}
              disabled={submitting}
              onChange={(e) => setSyncStopOrder(e.target.checked)}
            />
            <Form.Text className="text-muted d-block mb-3" style={{ marginTop: '-0.5rem' }}>
              Also updates library route stop order for sites already on this route. Run review always
              follows the CSV # column; check this only when you want the permanent route roster to
              match the sheet too.
            </Form.Text>
            {error ? (
              <Alert variant="danger">
                <div>{error}</div>
                {blockedMonthIso ? (
                  <div className="mt-2">
                    <Link
                      to={`/monthlies/routes/${routeId}/paperwork?month=${encodeURIComponent(blockedMonthIso)}`}
                      className="alert-link"
                    >
                      Open {formatMonthHeading(blockedMonthIso)} paperwork to reopen
                    </Link>
                  </div>
                ) : null}
              </Alert>
            ) : null}
          </>
        )}
      </Modal.Body>
      <Modal.Footer>
        {result ? (
          <>
            <Button variant="outline-secondary" onClick={onClose}>
              Close
            </Button>
            {monthIso ? (
              <Link
                to={`/monthlies/routes/${routeId}/paperwork?month=${encodeURIComponent(monthIso)}`}
                className="btn btn-primary btn-sm"
              >
                View paperwork
              </Link>
            ) : null}
          </>
        ) : (
          <>
            <Button variant="outline-secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={() => void onSubmit()} disabled={!file || submitting}>
              {submitting ? (
                <>
                  <Spinner size="sm" animation="border" role="status" className="me-2" />
                  Uploading…
                </>
              ) : (
                'Upload'
              )}
            </Button>
          </>
        )}
      </Modal.Footer>
    </Modal>
  )
}
