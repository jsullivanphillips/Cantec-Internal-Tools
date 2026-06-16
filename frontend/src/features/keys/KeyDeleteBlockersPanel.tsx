import { Alert } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import type { KeyDeleteBlockers } from './keysAdminShared'

export default function KeyDeleteBlockersPanel({
  blockers,
}: {
  blockers: KeyDeleteBlockers
}) {
  if (blockers.linked_location_count <= 0) {
    return null
  }

  return (
    <Alert variant="warning" className="py-2 small mb-0">
      <div className="fw-semibold mb-1">Delete blockers</div>
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
    </Alert>
  )
}
