import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Modal, ProgressBar } from 'react-bootstrap'
import { formatRouteOverviewMonthHeading } from './monthlyRoutesShared'
import {
  fetchStBulkReleaseStatus,
  streamBulkStJobRelease,
  type StBulkReleaseAction,
  type StBulkReleaseProgressEvent,
  type StBulkReleaseStatus,
} from './monthlyDashboardStJobRelease'

type Props = {
  monthFirstIso: string
  onComplete: () => void
}

type ProgressRow = {
  routeNumber: number
  status: 'success' | 'skipped' | 'failed'
  message: string
}

function actionLabel(action: StBulkReleaseAction): string {
  return action === 'release' ? 'Release all ST jobs' : 'Unrelease all ST jobs'
}

function actionVerb(action: StBulkReleaseAction): string {
  return action === 'release' ? 'release' : 'unrelease'
}

export default function BulkStJobReleaseButton({ monthFirstIso, onComplete }: Props) {
  const [status, setStatus] = useState<StBulkReleaseStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [progressOpen, setProgressOpen] = useState(false)
  const [running, setRunning] = useState(false)
  const [pendingAction, setPendingAction] = useState<StBulkReleaseAction | null>(null)
  const [progressTotal, setProgressTotal] = useState(0)
  const [progressIndex, setProgressIndex] = useState(0)
  const [progressRows, setProgressRows] = useState<ProgressRow[]>([])
  const [summary, setSummary] = useState<{
    success_count: number
    skipped_count: number
    failed_count: number
    failures: { route_number: number; message: string }[]
  } | null>(null)
  const [streamError, setStreamError] = useState<string | null>(null)

  const monthHeading = useMemo(() => formatRouteOverviewMonthHeading(monthFirstIso), [monthFirstIso])

  const loadStatus = useCallback(() => {
    setStatusLoading(true)
    fetchStBulkReleaseStatus(monthFirstIso)
      .then((data) => setStatus(data))
      .catch(() => setStatus(null))
      .finally(() => setStatusLoading(false))
  }, [monthFirstIso])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  const visible =
    status != null &&
    status.month_allowed &&
    status.eligible_count > 0 &&
    status.action != null

  const openConfirm = () => {
    if (!status?.action) return
    setPendingAction(status.action)
    setConfirmOpen(true)
  }

  const startBulkAction = async () => {
    if (!pendingAction) return
    setConfirmOpen(false)
    setProgressOpen(true)
    setRunning(true)
    setProgressTotal(0)
    setProgressIndex(0)
    setProgressRows([])
    setSummary(null)
    setStreamError(null)

    try {
      await streamBulkStJobRelease(monthFirstIso, pendingAction, (event: StBulkReleaseProgressEvent) => {
        if (event.type === 'start') {
          setProgressTotal(event.total)
          return
        }
        if (event.type === 'progress') {
          setProgressIndex(event.index)
          setProgressRows((rows) => [
            ...rows,
            {
              routeNumber: event.route_number,
              status: event.status,
              message: event.message,
            },
          ])
          return
        }
        if (event.type === 'done') {
          setSummary({
            success_count: event.success_count,
            skipped_count: event.skipped_count,
            failed_count: event.failed_count,
            failures: event.failures,
          })
          return
        }
        if (event.type === 'error') {
          setStreamError(event.error)
        }
      })
    } catch (err) {
      setStreamError(err instanceof Error ? err.message : 'Bulk release failed.')
    } finally {
      setRunning(false)
      loadStatus()
      onComplete()
    }
  }

  const closeProgress = () => {
    if (running) return
    setProgressOpen(false)
    setPendingAction(null)
  }

  if (!visible) {
    return null
  }

  const action = status.action!
  const progressPct =
    progressTotal > 0 ? Math.min(100, Math.round((progressIndex / progressTotal) * 100)) : running ? 0 : 100

  return (
    <>
      <Button
        type="button"
        variant="primary"
        size="sm"
        className="monthly-dashboard-st-bulk-release-btn"
        disabled={statusLoading || running}
        onClick={openConfirm}
      >
        {actionLabel(action)}
      </Button>

      <Modal show={confirmOpen} onHide={() => setConfirmOpen(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>{actionLabel(action)}?</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="mb-2">
            {action === 'release' ? 'Release' : 'Unrelease'}{' '}
            <strong>{status.eligible_count}</strong> scheduled ServiceTrade testing{' '}
            {status.eligible_count === 1 ? 'job' : 'jobs'} for <strong>{monthHeading}</strong>?
          </p>
          <p className="text-muted small mb-0">
            Only routes with a scheduled (not completed) testing job and a ServiceTrade route link are
            included. Completed jobs are not changed.
          </p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void startBulkAction()}>
            {actionLabel(action)}
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal show={progressOpen} onHide={closeProgress} centered backdrop={running ? 'static' : true}>
        <Modal.Header closeButton={!running}>
          <Modal.Title>
            {pendingAction ? `${actionLabel(pendingAction)} — ${monthHeading}` : 'ServiceTrade jobs'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {running || progressTotal > 0 ? (
            <div className="mb-3">
              <div className="d-flex justify-content-between small text-muted mb-1">
                <span>
                  {running
                    ? `Processing ${progressIndex} of ${progressTotal || '…'}`
                    : `Finished ${progressTotal} route${progressTotal === 1 ? '' : 's'}`}
                </span>
                <span>{progressPct}%</span>
              </div>
              <ProgressBar now={progressPct} animated={running} striped={running} />
            </div>
          ) : null}

          {streamError ? <div className="text-danger mb-3">{streamError}</div> : null}

          {summary ? (
            <div className="small mb-3">
              <div>
                <strong>{summary.success_count}</strong> updated ·{' '}
                <strong>{summary.skipped_count}</strong> skipped ·{' '}
                <strong>{summary.failed_count}</strong> failed
              </div>
              {summary.failures.length > 0 ? (
                <ul className="mb-0 mt-2">
                  {summary.failures.map((failure) => (
                    <li key={failure.route_number}>
                      Route {failure.route_number}: {failure.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {progressRows.length > 0 ? (
            <div className="monthly-dashboard-st-bulk-release-log small">
              {progressRows.map((row, idx) => (
                <div
                  key={`${row.routeNumber}-${idx}`}
                  className={`monthly-dashboard-st-bulk-release-log__row monthly-dashboard-st-bulk-release-log__row--${row.status}`}
                >
                  <span className="fw-semibold">R{row.routeNumber}</span>
                  <span>{row.message}</span>
                </div>
              ))}
            </div>
          ) : running ? (
            <div className="text-muted small">Starting bulk {actionVerb(action)}…</div>
          ) : null}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="primary" disabled={running} onClick={closeProgress}>
            Close
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  )
}
