import { Form, Modal } from 'react-bootstrap'
import { DEFAULT_ROUTE_TECH_COUNT, useRouteTechCountField } from './RouteTechCountCard'

type Props = {
  show: boolean
  onHide: () => void
  routeId: number
  techCount: number | null | undefined
  onTechCountPatched: (techCount: number | null) => void
}

export default function RouteTechCountModal({
  show,
  onHide,
  routeId,
  techCount,
  onTechCountPatched,
}: Props) {
  const { draft, setDraft, saving, error, save } = useRouteTechCountField({
    routeId,
    techCount,
    onTechCountPatched,
  })

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton>
        <Modal.Title>Edit tech count</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="text-muted small mb-3">
          Used for expense and net profit calculations. Defaults to {DEFAULT_ROUTE_TECH_COUNT} when unset.
        </p>
        <Form.Label htmlFor="route-tech-count-modal-input" className="small fw-semibold">
          Techs required
        </Form.Label>
        <Form.Control
          id="route-tech-count-modal-input"
          type="number"
          min={1}
          max={9}
          step={1}
          value={draft}
          disabled={saving}
          placeholder={String(DEFAULT_ROUTE_TECH_COUNT)}
          className="route-tech-count-modal__input tabular-nums"
          style={{ maxWidth: '8rem' }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void save(draft)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void save(draft)
            }
          }}
        />
        {error ? (
          <p className="text-danger small mb-0 mt-2" role="alert">
            {error}
          </p>
        ) : null}
      </Modal.Body>
    </Modal>
  )
}
