import { useMemo, useState } from 'react'
import { Button, Form } from 'react-bootstrap'
import type { TechnicianWorksheetStop } from './monthlyRoutesShared'
import type { PortalDeficiencySummary } from './portalWorkflowShared'

const VISIBLE_STATUSES = new Set(['new', 'verified'])

type Props = {
  stop: TechnicianWorksheetStop
  readOnly: boolean
  onAdd: () => void
  onEdit: (def: PortalDeficiencySummary) => void
  onVerify: (def: PortalDeficiencySummary) => void
  onToggleHidden: (includeHidden: boolean) => void
}

function severityLabel(severity: string): string {
  const s = severity.toLowerCase()
  if (s === 'inoperable') return 'Inoperable'
  if (s === 'deficient') return 'Deficient'
  if (s === 'suggested') return 'Suggested'
  return severity
}

export default function PortalDeficienciesCard({
  stop,
  readOnly,
  onAdd,
  onEdit,
  onVerify,
  onToggleHidden,
}: Props) {
  const [showHidden, setShowHidden] = useState(false)
  const items = stop.deficiencies ?? []

  const { visible, hiddenCount } = useMemo(() => {
    const vis: PortalDeficiencySummary[] = []
    let hidden = 0
    for (const d of items) {
      const st = (d.status || '').toLowerCase()
      if (VISIBLE_STATUSES.has(st)) vis.push(d)
      else hidden += 1
    }
    return { visible: vis, hiddenCount: hidden }
  }, [items])

  const displayList = showHidden ? items : visible

  return (
    <div className="pw-mock-field-group pw-portal-deficiencies-card">
      <div className="d-flex align-items-center justify-content-between gap-2 mb-2">
        <div className="pw-mock-field-group-title mb-0">Deficiencies</div>
        {!readOnly ? (
          <Button variant="outline-danger" size="sm" onClick={onAdd}>
            Add
          </Button>
        ) : null}
      </div>

      {hiddenCount > 0 ? (
        <Form.Check
          type="switch"
          id={`def-hidden-${stop.testing_site_id}`}
          className="pw-portal-def-ghost-toggle small mb-2"
          label="Show invalid / fixed"
          checked={showHidden}
          onChange={(e) => {
            const next = e.target.checked
            setShowHidden(next)
            onToggleHidden(next)
          }}
        />
      ) : null}

      {displayList.length === 0 ? (
        <p className="text-muted small mb-0">No deficiencies recorded.</p>
      ) : (
        <ul className="list-unstyled mb-0 pw-portal-def-list">
          {displayList.map((def) => {
            const st = (def.status || '').toLowerCase()
            const canVerify = !readOnly && st === 'new'
            return (
              <li key={def.id} className="pw-portal-def-item">
                <div className="pw-portal-def-head">
                  <span className="fw-semibold">{def.title}</span>
                  <span className="text-muted small">
                    {severityLabel(def.severity)} · {def.status}
                  </span>
                </div>
                {def.description ? (
                  <p className="small text-muted mb-1">{def.description}</p>
                ) : null}
                <div className="d-flex flex-wrap gap-2">
                  {!readOnly ? (
                    <Button variant="link" size="sm" className="p-0" onClick={() => onEdit(def)}>
                      Edit
                    </Button>
                  ) : null}
                  {canVerify ? (
                    <Button
                      variant="link"
                      size="sm"
                      className="p-0 text-success"
                      onClick={() => onVerify(def)}
                    >
                      Verify
                    </Button>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
