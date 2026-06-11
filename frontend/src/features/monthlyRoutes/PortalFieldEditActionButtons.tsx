import { Spinner } from 'react-bootstrap'
import { portalFieldEditActionPointerGuard } from './portalFieldEditRegistry'

type PortalFieldEditActionButtonsProps = {
  saving: boolean
  onCancel: () => void
  onSubmit: () => void
}

export default function PortalFieldEditActionButtons({
  saving,
  onCancel,
  onSubmit,
}: PortalFieldEditActionButtonsProps) {
  return (
    <div className="pw-mock-field-edit-actions">
      <button
        type="button"
        className="pw-mock-field-edit-btn"
        onPointerDown={portalFieldEditActionPointerGuard}
        onMouseDown={portalFieldEditActionPointerGuard}
        onClick={onCancel}
        disabled={saving}
      >
        Cancel
      </button>
      <button
        type="button"
        className="pw-mock-field-edit-btn pw-mock-field-edit-btn--primary"
        onPointerDown={portalFieldEditActionPointerGuard}
        onMouseDown={portalFieldEditActionPointerGuard}
        onClick={onSubmit}
        disabled={saving}
        aria-busy={saving}
      >
        {saving ? (
          <span className="pw-mock-field-edit-btn-content">
            <Spinner animation="border" size="sm" variant="light" role="status" aria-hidden="true" />
            <span>Saving…</span>
          </span>
        ) : (
          'Submit'
        )}
      </button>
    </div>
  )
}
