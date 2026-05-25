import type { CSSProperties } from 'react'
import { Card, Form } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import {
  ANNUAL_MONTH_SELECT_OPTIONS,
  normalizeAnnualMonthForSelect,
  type TestingSiteEditForm,
  type TestingSiteSummary,
} from './monthlyRoutesShared'

const INPUT_STYLE: CSSProperties = {
  backgroundColor: '#f8fafc',
  borderColor: '#c8d0df',
}

type TestingSiteFieldsSectionProps = {
  mode: 'view' | 'edit'
  site: TestingSiteSummary
  index: number
  total: number
  form?: TestingSiteEditForm
  onFormChange?: (patch: Partial<TestingSiteEditForm>) => void
}

function stopTitle(site: TestingSiteSummary, index: number, total: number): string {
  const label = site.label?.trim()
  if (label) return label
  if (total === 1) return 'Testing location'
  return `Testing location ${index + 1}`
}

export default function TestingSiteFieldsSection({
  mode,
  site,
  index,
  total,
  form,
  onFormChange,
}: TestingSiteFieldsSectionProps) {
  const title = stopTitle(site, index, total)

  if (mode === 'view') {
    const panel = (site.panel ?? site.facp_detail ?? '').trim()
    const price =
      site.price_per_month != null ? `$${site.price_per_month.toFixed(2)}` : '—'
    return (
      <Card className="border-0 shadow-sm mb-3">
        <Card.Header className="py-2 bg-white fw-semibold">{title}</Card.Header>
        <Card.Body className="py-2 small">
          <dl className="row mb-0 gy-2">
            {total > 1 ? (
              <>
                <dt className="col-sm-3 text-muted">Label</dt>
                <dd className="col-sm-9">{site.label?.trim() || '—'}</dd>
              </>
            ) : null}
            <dt className="col-sm-3 text-muted">Price/mo</dt>
            <dd className="col-sm-9">{price}</dd>
            <dt className="col-sm-3 text-muted">Building</dt>
            <dd className="col-sm-9">{site.building_name?.trim() || '—'}</dd>
            <dt className="col-sm-3 text-muted">PMC</dt>
            <dd className="col-sm-9">{site.property_management_company?.trim() || '—'}</dd>
            <dt className="col-sm-3 text-muted">Annual</dt>
            <dd className="col-sm-9">
              {normalizeAnnualMonthForSelect(site.annual_month) ||
                site.annual_month?.trim() ||
                '—'}
            </dd>
            <dt className="col-sm-3 text-muted">Key</dt>
            <dd className="col-sm-9">
              {site.key ? (
                <Link to={`/keys/${site.key.id}`}>{site.key.keycode}</Link>
              ) : (
                site.keys?.trim() || '—'
              )}
            </dd>
            {site.barcode ? (
              <>
                <dt className="col-sm-3 text-muted">Barcode</dt>
                <dd className="col-sm-9">{site.barcode}</dd>
              </>
            ) : null}
            <dt className="col-sm-3 text-muted">Ring</dt>
            <dd className="col-sm-9 text-break" style={{ whiteSpace: 'pre-wrap' }}>
              {(site.ring_detail ?? site.ring ?? '').trim() || '—'}
            </dd>
            <dt className="col-sm-3 text-muted">FACP / panel</dt>
            <dd className="col-sm-9 text-break" style={{ whiteSpace: 'pre-wrap' }}>
              {panel || '—'}
            </dd>
            <dt className="col-sm-3 text-muted">Panel location</dt>
            <dd className="col-sm-9">{site.panel_location?.trim() || '—'}</dd>
            <dt className="col-sm-3 text-muted">Door code</dt>
            <dd className="col-sm-9">{site.door_code?.trim() || '—'}</dd>
            <dt className="col-sm-3 text-muted">Monitoring</dt>
            <dd className="col-sm-9">
              {site.monitoring_company?.name?.trim() ||
                (site.monitoring_company_id != null
                  ? `Company #${site.monitoring_company_id}`
                  : '—')}
            </dd>
            <dt className="col-sm-3 text-muted">Monitoring notes</dt>
            <dd className="col-sm-9 text-break" style={{ whiteSpace: 'pre-wrap' }}>
              {site.monitoring_notes?.trim() || '—'}
            </dd>
            <dt className="col-sm-3 text-muted">Testing procedures</dt>
            <dd className="col-sm-9 text-break" style={{ whiteSpace: 'pre-wrap' }}>
              {site.testing_procedures?.trim() || '—'}
            </dd>
            <dt className="col-sm-3 text-muted">Location comments</dt>
            <dd className="col-sm-9 text-break" style={{ whiteSpace: 'pre-wrap' }}>
              {site.inspection_tech_notes?.trim() || '—'}
            </dd>
          </dl>
        </Card.Body>
      </Card>
    )
  }

  if (!form || !onFormChange) return null

  return (
    <Card className="border-0 shadow-sm mb-3">
      <Card.Header className="py-2 bg-white fw-semibold">{title}</Card.Header>
      <Card.Body className="d-flex flex-column gap-2 py-2">
        {total > 1 ? (
          <Form.Group>
            <Form.Label className="small mb-1">Label</Form.Label>
            <Form.Control
              style={INPUT_STYLE}
              size="sm"
              value={form.label}
              onChange={(e) => onFormChange({ label: e.target.value })}
            />
          </Form.Group>
        ) : null}
        <div className="row g-2">
          <div className="col-sm-6">
            <Form.Group>
              <Form.Label className="small mb-1">Price/mo</Form.Label>
              <Form.Control
                style={INPUT_STYLE}
                size="sm"
                inputMode="decimal"
                value={form.price_per_month}
                onChange={(e) => onFormChange({ price_per_month: e.target.value })}
              />
            </Form.Group>
          </div>
          <div className="col-sm-6">
            <Form.Group>
              <Form.Label className="small mb-1">Annual month</Form.Label>
              <Form.Select
                style={INPUT_STYLE}
                size="sm"
                value={form.annual_month}
                onChange={(e) => onFormChange({ annual_month: e.target.value })}
              >
                <option value="">—</option>
                {form.annual_month && !ANNUAL_MONTH_SELECT_OPTIONS.includes(form.annual_month) ? (
                  <option value={form.annual_month}>{form.annual_month}</option>
                ) : null}
                {ANNUAL_MONTH_SELECT_OPTIONS.map((monthName) => (
                  <option key={monthName} value={monthName}>
                    {monthName}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          </div>
        </div>
        <Form.Group>
          <Form.Label className="small mb-1">Building</Form.Label>
          <Form.Control
            style={INPUT_STYLE}
            size="sm"
            value={form.building_name}
            onChange={(e) => onFormChange({ building_name: e.target.value })}
          />
        </Form.Group>
        <Form.Group>
          <Form.Label className="small mb-1">Property management</Form.Label>
          <Form.Control
            style={INPUT_STYLE}
            size="sm"
            value={form.property_management_company}
            onChange={(e) => onFormChange({ property_management_company: e.target.value })}
          />
        </Form.Group>
        <div className="row g-2">
          <div className="col-sm-6">
            <Form.Group>
              <Form.Label className="small mb-1">Keys</Form.Label>
              <Form.Control
                style={INPUT_STYLE}
                size="sm"
                value={form.keys}
                onChange={(e) => onFormChange({ keys: e.target.value })}
              />
            </Form.Group>
          </div>
          <div className="col-sm-6">
            <Form.Group>
              <Form.Label className="small mb-1">Barcode</Form.Label>
              <Form.Control
                style={INPUT_STYLE}
                size="sm"
                value={form.barcode}
                onChange={(e) => onFormChange({ barcode: e.target.value })}
              />
            </Form.Group>
          </div>
        </div>
        <Form.Group>
          <Form.Label className="small mb-1">Ring</Form.Label>
          <Form.Control
            style={INPUT_STYLE}
            as="textarea"
            rows={2}
            size="sm"
            value={form.ring_detail}
            onChange={(e) => onFormChange({ ring_detail: e.target.value })}
          />
        </Form.Group>
        <Form.Group>
          <Form.Label className="small mb-1">FACP / panel</Form.Label>
          <Form.Control
            style={INPUT_STYLE}
            as="textarea"
            rows={2}
            size="sm"
            value={form.facp_detail}
            onChange={(e) => onFormChange({ facp_detail: e.target.value })}
          />
        </Form.Group>
        <div className="row g-2">
          <div className="col-sm-6">
            <Form.Group>
              <Form.Label className="small mb-1">Panel location</Form.Label>
              <Form.Control
                style={INPUT_STYLE}
                size="sm"
                value={form.panel_location}
                onChange={(e) => onFormChange({ panel_location: e.target.value })}
              />
            </Form.Group>
          </div>
          <div className="col-sm-6">
            <Form.Group>
              <Form.Label className="small mb-1">Door code</Form.Label>
              <Form.Control
                style={INPUT_STYLE}
                size="sm"
                value={form.door_code}
                onChange={(e) => onFormChange({ door_code: e.target.value })}
              />
            </Form.Group>
          </div>
        </div>
        <Form.Group>
          <Form.Label className="small mb-1">Monitoring company ID</Form.Label>
          <Form.Control
            style={INPUT_STYLE}
            size="sm"
            inputMode="numeric"
            placeholder="Leave blank if none"
            value={form.monitoring_company_id}
            onChange={(e) => onFormChange({ monitoring_company_id: e.target.value })}
          />
          {site.monitoring_company?.name ? (
            <Form.Text className="text-muted">Current: {site.monitoring_company.name}</Form.Text>
          ) : null}
        </Form.Group>
        <Form.Group>
          <Form.Label className="small mb-1">Monitoring notes</Form.Label>
          <Form.Control
            style={INPUT_STYLE}
            as="textarea"
            rows={2}
            size="sm"
            value={form.monitoring_notes}
            onChange={(e) => onFormChange({ monitoring_notes: e.target.value })}
          />
        </Form.Group>
        <Form.Group>
          <Form.Label className="small mb-1">Testing procedures</Form.Label>
          <Form.Control
            style={INPUT_STYLE}
            as="textarea"
            rows={2}
            size="sm"
            value={form.testing_procedures}
            onChange={(e) => onFormChange({ testing_procedures: e.target.value })}
          />
        </Form.Group>
        <Form.Group>
          <Form.Label className="small mb-1">Location comments</Form.Label>
          <Form.Control
            style={INPUT_STYLE}
            as="textarea"
            rows={2}
            size="sm"
            value={form.inspection_tech_notes}
            onChange={(e) => onFormChange({ inspection_tech_notes: e.target.value })}
          />
        </Form.Group>
      </Card.Body>
    </Card>
  )
}
