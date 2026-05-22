import { useEffect, useState } from 'react'
import { Button, Form, Modal } from 'react-bootstrap'
import type { TechnicianWorksheetStop } from './monthlyRoutesShared'
import type { WorksheetStopChangeSet } from './worksheetOfflineStore'

export type PortalStopFieldsDraft = {
  ring: string
  key_number: string
  door_code: string
  annual_month: string
  panel: string
  panel_location: string
  property_management_company: string
  building_name: string
  monitoring_notes: string
  testing_procedures: string
  inspection_tech_notes: string
  run_comments: string
}

function draftFromStop(stop: TechnicianWorksheetStop): PortalStopFieldsDraft {
  return {
    ring: stop.ring ?? '',
    key_number: stop.key_number ?? '',
    door_code: stop.door_code ?? '',
    annual_month: stop.annual_month ?? '',
    panel: stop.panel ?? '',
    panel_location: stop.panel_location ?? '',
    property_management_company: stop.property_management_company ?? '',
    building_name: stop.building_name ?? '',
    monitoring_notes: stop.monitoring_notes ?? '',
    testing_procedures: stop.testing_procedures ?? '',
    inspection_tech_notes: stop.inspection_tech_notes ?? '',
    run_comments: stop.run_comments ?? '',
  }
}

function draftToPatch(draft: PortalStopFieldsDraft): WorksheetStopChangeSet {
  const trim = (v: string) => v.trim()
  return {
    ring: trim(draft.ring) || null,
    key_number: trim(draft.key_number) || null,
    door_code: trim(draft.door_code) || null,
    annual_month: trim(draft.annual_month) || null,
    panel: trim(draft.panel) || null,
    panel_location: trim(draft.panel_location) || null,
    property_management_company: trim(draft.property_management_company) || null,
    building_name: trim(draft.building_name) || null,
    monitoring_notes: trim(draft.monitoring_notes) || null,
    testing_procedures: trim(draft.testing_procedures) || null,
    inspection_tech_notes: trim(draft.inspection_tech_notes) || null,
    run_comments: trim(draft.run_comments) || null,
  }
}

type PortalStopFieldsEditModalProps = {
  show: boolean
  stop: TechnicianWorksheetStop | null
  onHide: () => void
  onSave: (patch: WorksheetStopChangeSet) => void
}

export default function PortalStopFieldsEditModal({
  show,
  stop,
  onHide,
  onSave,
}: PortalStopFieldsEditModalProps) {
  const [draft, setDraft] = useState<PortalStopFieldsDraft>(() =>
    stop ? draftFromStop(stop) : draftFromStop({} as TechnicianWorksheetStop),
  )

  useEffect(() => {
    if (show && stop) setDraft(draftFromStop(stop))
  }, [show, stop])

  const update = (patch: Partial<PortalStopFieldsDraft>) => {
    setDraft((d) => ({ ...d, ...patch }))
  }

  const handleSave = () => {
    onSave(draftToPatch(draft))
    onHide()
  }

  return (
    <Modal show={show} onHide={onHide} centered scrollable size="lg">
      <Modal.Header closeButton>
        <Modal.Title>
          Edit stop{stop ? ` #${stop.stop_number}` : ''}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="small text-muted">
          Changes apply to this run month only. The library updates when you edit the current month.
        </p>
        <div className="row g-3">
          <div className="col-md-6">
            <Form.Group>
              <Form.Label className="small">Ring</Form.Label>
              <Form.Control
                value={draft.ring}
                onChange={(e) => update({ ring: e.target.value })}
                disabled={!stop}
              />
            </Form.Group>
          </div>
          <div className="col-md-6">
            <Form.Group>
              <Form.Label className="small">Key #</Form.Label>
              <Form.Control
                value={draft.key_number}
                onChange={(e) => update({ key_number: e.target.value })}
                disabled={!stop}
              />
            </Form.Group>
          </div>
          <div className="col-md-6">
            <Form.Group>
              <Form.Label className="small">Door code</Form.Label>
              <Form.Control
                value={draft.door_code}
                onChange={(e) => update({ door_code: e.target.value })}
                disabled={!stop}
              />
            </Form.Group>
          </div>
          <div className="col-md-6">
            <Form.Group>
              <Form.Label className="small">Annual month</Form.Label>
              <Form.Control
                value={draft.annual_month}
                onChange={(e) => update({ annual_month: e.target.value })}
                disabled={!stop}
              />
            </Form.Group>
          </div>
          <div className="col-12">
            <Form.Group>
              <Form.Label className="small">Property management company</Form.Label>
              <Form.Control
                value={draft.property_management_company}
                onChange={(e) => update({ property_management_company: e.target.value })}
                disabled={!stop}
              />
            </Form.Group>
          </div>
          <div className="col-12">
            <Form.Group>
              <Form.Label className="small">Building name</Form.Label>
              <Form.Control
                value={draft.building_name}
                onChange={(e) => update({ building_name: e.target.value })}
                disabled={!stop}
              />
            </Form.Group>
          </div>
          <div className="col-md-6">
            <Form.Group>
              <Form.Label className="small">Panel (make / model)</Form.Label>
              <Form.Control
                value={draft.panel}
                onChange={(e) => update({ panel: e.target.value })}
                disabled={!stop}
              />
            </Form.Group>
          </div>
          <div className="col-md-6">
            <Form.Group>
              <Form.Label className="small">Panel location</Form.Label>
              <Form.Control
                value={draft.panel_location}
                onChange={(e) => update({ panel_location: e.target.value })}
                disabled={!stop}
              />
            </Form.Group>
          </div>
          <div className="col-12">
            <Form.Group>
              <Form.Label className="small">Monitoring notes</Form.Label>
              <Form.Control
                as="textarea"
                rows={2}
                value={draft.monitoring_notes}
                onChange={(e) => update({ monitoring_notes: e.target.value })}
                disabled={!stop}
              />
            </Form.Group>
          </div>
          <div className="col-12">
            <Form.Group>
              <Form.Label className="small">Testing procedures</Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                value={draft.testing_procedures}
                onChange={(e) => update({ testing_procedures: e.target.value })}
                disabled={!stop}
              />
            </Form.Group>
          </div>
          <div className="col-12">
            <Form.Group>
              <Form.Label className="small">Location comments</Form.Label>
              <Form.Control
                as="textarea"
                rows={4}
                value={draft.inspection_tech_notes}
                onChange={(e) => update({ inspection_tech_notes: e.target.value })}
                disabled={!stop}
              />
            </Form.Group>
          </div>
          <div className="col-12">
            <Form.Group>
              <Form.Label className="small">Run comments</Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                value={draft.run_comments}
                onChange={(e) => update({ run_comments: e.target.value })}
                disabled={!stop}
              />
              <Form.Text className="text-muted">This month only; not carried to the next month.</Form.Text>
            </Form.Group>
          </div>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSave} disabled={!stop}>
          Save
        </Button>
      </Modal.Footer>
    </Modal>
  )
}
