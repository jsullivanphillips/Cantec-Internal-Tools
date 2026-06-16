import { useState } from 'react'
import { Alert, Button, ListGroup } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import {
  deleteAllKeyBridgeRows,
  deleteKeyBridgeRow,
  type KeyDeleteBlockers,
} from './keysAdminShared'

export default function KeyDeleteBlockersPanel({
  keyId,
  blockers,
  onBlockersChange,
  disabled,
}: {
  keyId: number
  blockers: KeyDeleteBlockers
  onBlockersChange: (next: KeyDeleteBlockers) => void
  disabled?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const bridgeRows = blockers.bridge_row_details ?? []
  const hasBridge = blockers.bridge_rows > 0
  const hasLinks = blockers.linked_location_count > 0
  if (!hasBridge && !hasLinks) {
    return null
  }

  const onRemoveBridge = async (bridgeId: number) => {
    if (!window.confirm('Remove this bridge archive row? This only affects the wipe archive, not live monthly locations.')) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      onBlockersChange(await deleteKeyBridgeRow(keyId, bridgeId))
    } catch {
      setError('Could not remove bridge row.')
    } finally {
      setBusy(false)
    }
  }

  const onRemoveAllBridges = async () => {
    if (
      !window.confirm(
        `Remove all ${blockers.bridge_rows} bridge archive row(s) for this key? Live monthly locations are not changed.`,
      )
    ) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      onBlockersChange(await deleteAllKeyBridgeRows(keyId))
    } catch {
      setError('Could not remove bridge rows.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Alert variant="warning" className="py-2 small mb-0">
      {error ? <div className="text-danger mb-2">{error}</div> : null}
      <div className="fw-semibold mb-1">Delete blockers</div>
      {hasLinks ? (
        <div className="mb-2">
          <div>
            {blockers.linked_location_count} monthly location(s) linked via <code>key_id</code>:
          </div>
          <div className="d-flex flex-wrap gap-2 mt-1">
            {blockers.linked_location_ids.map((locationId) => (
              <Link key={locationId} to={`/monthlies/locations/${locationId}`} className="small">
                Location {locationId}
              </Link>
            ))}
          </div>
          <div className="text-muted mt-1">Unlink each location before deleting this key.</div>
        </div>
      ) : null}
      {hasBridge ? (
        <div>
          <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-1">
            <span>{blockers.bridge_rows} bridge archive row(s)</span>
            {blockers.bridge_rows > 1 ? (
              <Button
                type="button"
                variant="outline-warning"
                size="sm"
                disabled={disabled || busy}
                onClick={() => void onRemoveAllBridges()}
              >
                Remove all
              </Button>
            ) : null}
          </div>
          <ListGroup variant="flush" className="border rounded bg-white">
            {bridgeRows.map((row) => (
              <ListGroup.Item
                key={row.id}
                className="d-flex flex-wrap justify-content-between align-items-start gap-2 py-2"
              >
                <div>
                  <div>
                    <span className="text-muted">#{row.id}</span>
                    {row.source ? <span className="ms-2">{row.source}</span> : null}
                  </div>
                  {row.display_address ? <div>{row.display_address}</div> : null}
                  {row.keys_text ? <div className="text-muted">Key #: {row.keys_text}</div> : null}
                  {row.legacy_monthly_route_location_id != null ? (
                    <div className="text-muted">Legacy loc {row.legacy_monthly_route_location_id}</div>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="outline-secondary"
                  size="sm"
                  disabled={disabled || busy}
                  onClick={() => void onRemoveBridge(row.id)}
                >
                  Remove
                </Button>
              </ListGroup.Item>
            ))}
          </ListGroup>
          <div className="text-muted mt-1">
            Bridge rows are archive snapshots from monthly wipes — safe to remove when cleaning up bogus keys.
          </div>
        </div>
      ) : null}
    </Alert>
  )
}
