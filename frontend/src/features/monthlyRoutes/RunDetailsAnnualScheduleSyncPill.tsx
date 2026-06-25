import { Button, Spinner } from 'react-bootstrap'

import type {
  AnnualScheduleCheckStatus,
  AnnualScheduleSyncProgress,
} from './monthlyRoutesShared'

export default function RunDetailsAnnualScheduleSyncPill({
  status,
  syncProgress,
  error,
  onRetry,
}: {
  status: AnnualScheduleCheckStatus
  syncProgress: AnnualScheduleSyncProgress | null
  error: string | null
  onRetry?: () => void
}) {
  if (status === 'error' && error) {
    return (
      <div className="run-details-annual-sync-status mb-2">
        <span className="badge run-details-annual-sync-status__pill run-details-annual-sync-status__pill--error">
          {error}
        </span>
        {onRetry ? (
          <Button
            variant="link"
            size="sm"
            className="run-details-annual-sync-status__retry p-0 align-baseline"
            onClick={() => void onRetry()}
          >
            Retry
          </Button>
        ) : null}
      </div>
    )
  }

  if (status !== 'loading' && status !== 'syncing') return null

  const progressLabel =
    syncProgress != null && syncProgress.total > 0
      ? ` (${syncProgress.synced}/${syncProgress.total})`
      : ''

  return (
    <div className="run-details-annual-sync-status mb-2">
      <span
        className="badge run-details-annual-sync-status__pill"
        role="status"
        aria-live="polite"
      >
        <Spinner
          animation="border"
          size="sm"
          className="run-details-annual-sync-status__spinner me-1"
          aria-hidden
        />
        Checking ServiceTrade for annuals{progressLabel}
      </span>
    </div>
  )
}
