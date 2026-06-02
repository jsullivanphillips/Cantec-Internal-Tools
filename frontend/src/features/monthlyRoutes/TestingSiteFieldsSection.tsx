import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { Accordion, Alert, Button, Card, Form } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import {
  annualMonthDropdownOptions,
  buildTestingSiteEditForm,
  normalizeAnnualMonthForSelect,
  type LibraryLocation,
  type MonitoringCompanySummary,
  type TestingSiteEditForm,
  type TestingSiteSummary,
} from './monthlyRoutesShared'
import MonitoringCompanySelect, {
  monitoringCompanyDisplayName,
  monitoringCompanyPhonesText,
} from './MonitoringCompanySelect'
import { useMonitoringCompanies } from './useMonitoringCompanies'

const INPUT_STYLE: CSSProperties = {
  backgroundColor: '#f8fafc',
  borderColor: '#c8d0df',
}

type TestingSiteFieldsSectionProps = {
  mode: 'view' | 'edit' | 'inline'
  site: TestingSiteSummary
  index: number
  total: number
  location?: LibraryLocation | null
  form?: TestingSiteEditForm
  onFormChange?: (patch: Partial<TestingSiteEditForm>) => void
  onInlineSave?: (form: TestingSiteEditForm) => Promise<void> | void
  onDelete?: (site: TestingSiteSummary) => Promise<void> | void
  deleting?: boolean
  collapsible?: boolean
  defaultExpanded?: boolean
}

type EditableTestingSiteField = Exclude<keyof TestingSiteEditForm, 'id' | 'sort_order'>

type InlineFieldOption = {
  value: string
  label: string
}

type SummaryChip = {
  label?: string
  value: string
  tone?: 'success' | 'info' | 'muted'
}

const COMMENT_PREVIEW_LINES = 3

function stopTitle(
  site: TestingSiteSummary,
  index: number,
  total: number,
  location?: LibraryLocation | null
): string {
  const label = site.label?.trim()
  if (label) return label
  if (total === 1) return location?.address?.trim() || 'Testing location'
  return `Testing location ${index + 1}`
}

function formatPrice(value: number | null | undefined): string {
  return value != null ? `$${value.toFixed(2)}` : '—'
}

function formatRunCommentMonth(value?: string | null): string | null {
  const raw = value?.trim()
  if (!raw) return null
  const [year, month] = raw.split('-').map((part) => Number.parseInt(part, 10))
  if (!year || !month) return raw
  return new Date(year, month - 1, 1).toLocaleString(undefined, {
    month: 'long',
    year: 'numeric',
  })
}

function panelDisplay(site: TestingSiteSummary): string {
  return (site.panel ?? site.facp_detail ?? '').trim()
}

function annualDisplay(site: TestingSiteSummary): string {
  return normalizeAnnualMonthForSelect(site.annual_month) || site.annual_month?.trim() || ''
}

function monitoringDisplay(site: TestingSiteSummary): string {
  return (
    site.monitoring_company?.name?.trim() ||
    (site.monitoring_company_id != null ? `Company #${site.monitoring_company_id}` : '')
  )
}

function cardSummary(site: TestingSiteSummary): SummaryChip[] {
  const panel = panelDisplay(site)
  const annual = annualDisplay(site)
  const key = site.key?.keycode || site.keys?.trim() || ''
  const chips: Array<SummaryChip | null> = [
    { value: formatPrice(site.price_per_month), tone: 'success' },
    annual ? { label: 'Annual', value: annual, tone: 'info' } : null,
    key ? { label: 'Key', value: key } : null,
    panel ? { label: 'Panel', value: panel } : null,
  ]
  return chips.filter((chip): chip is SummaryChip => chip != null)
}

function getErrorMessage(err: unknown): string {
  if (typeof err === 'object' && err && 'error' in err) {
    return String((err as { error: unknown }).error)
  }
  return 'Unable to save this field.'
}

function TestingSiteCardShell({
  title,
  summaryChips,
  monitoringSummary,
  collapsible,
  defaultExpanded,
  children,
}: {
  title: string
  summaryChips: SummaryChip[]
  monitoringSummary?: string
  collapsible?: boolean
  defaultExpanded?: boolean
  children: ReactNode
}) {
  const summary =
    summaryChips.length > 0 ? (
      <span className="monthly-testing-site-summary-chips">
        {summaryChips.map((chip) => (
          <span
            key={`${chip.label}:${chip.value}`}
            className={`monthly-testing-site-summary-chip${
              chip.tone ? ` monthly-testing-site-summary-chip--${chip.tone}` : ''
            }`}
          >
            {chip.label ? <span>{chip.label}</span> : null}
            <strong>{chip.value}</strong>
          </span>
        ))}
      </span>
    ) : (
      <span className="monthly-testing-site-card-summary">Testing location details</span>
    )

  if (collapsible) {
    return (
      <Accordion
        className="monthly-testing-site-card mb-3"
        defaultActiveKey={defaultExpanded ? 'site' : undefined}
      >
        <Accordion.Item eventKey="site">
          <Accordion.Header>
            <span className="monthly-testing-site-card-heading">
              <span className="monthly-testing-site-card-main">
                <span className="monthly-testing-site-card-title">{title}</span>
                {summary}
              </span>
              {monitoringSummary ? (
                <span className="monthly-testing-site-monitoring-pill">
                  <span>Monitoring</span>
                  <strong>{monitoringSummary}</strong>
                </span>
              ) : null}
            </span>
          </Accordion.Header>
          <Accordion.Body>{children}</Accordion.Body>
        </Accordion.Item>
      </Accordion>
    )
  }

  return (
    <Card className="border-0 shadow-sm mb-3">
      <Card.Header className="py-2 bg-white fw-semibold">{title}</Card.Header>
      <Card.Body className="py-2 small">{children}</Card.Body>
    </Card>
  )
}

function CollapsibleCommentPreview({
  text,
  emptyText = '—',
}: {
  text?: string | null
  emptyText?: string
}) {
  const contentRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [canToggle, setCanToggle] = useState(false)
  const value = text?.trim() || ''

  useEffect(() => {
    const el = contentRef.current
    if (!el || !value) {
      setCanToggle(false)
      setExpanded(false)
      return
    }

    const measure = () => {
      const lineHeight = Number.parseFloat(window.getComputedStyle(el).lineHeight || '0')
      const maxHeight = (lineHeight || 18) * COMMENT_PREVIEW_LINES
      setCanToggle(el.scrollHeight > maxHeight + 1)
    }

    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [value])

  if (!value) return <>{emptyText}</>

  return (
    <div
      className={`monthly-testing-site-comment-preview${
        expanded ? ' monthly-testing-site-comment-preview--expanded' : ''
      }${canToggle ? ' monthly-testing-site-comment-preview--toggleable' : ''}`}
    >
      <div ref={contentRef} className="monthly-testing-site-comment-preview-text">
        {value}
      </div>
      {canToggle ? (
        <button
          type="button"
          className="monthly-testing-site-comment-preview-toggle"
          onClick={(e) => {
            e.stopPropagation()
            setExpanded((current) => !current)
          }}
        >
          {expanded ? 'View less' : 'View more'}
        </button>
      ) : null}
    </div>
  )
}

function LatestRunCommentBlock({
  comment,
  month,
}: {
  comment?: string | null
  month?: string | null
}) {
  const monthLabel = formatRunCommentMonth(month)
  return (
    <div className="monthly-testing-site-latest-run-comment monthly-testing-site-latest-run-comment--section">
      <div className="monthly-testing-site-latest-run-comment-label">
        <span>Latest run comment</span>
        {monthLabel ? (
          <span className="monthly-testing-site-latest-run-comment-month">{monthLabel}</span>
        ) : null}
      </div>
      <div className="monthly-testing-site-latest-run-comment-text">
        <CollapsibleCommentPreview text={comment} emptyText="No run comment yet." />
      </div>
    </div>
  )
}

function TestingSiteViewFields({
  site,
  total,
}: {
  site: TestingSiteSummary
  total: number
}) {
  const panel = panelDisplay(site)

  return (
    <dl className="row mb-0 gy-2">
      {total > 1 ? (
        <>
          <dt className="col-sm-3 text-muted">Label</dt>
          <dd className="col-sm-9">{site.label?.trim() || '—'}</dd>
        </>
      ) : null}
      <dt className="col-sm-3 text-muted">Price/mo</dt>
      <dd className="col-sm-9">{formatPrice(site.price_per_month)}</dd>
      <dt className="col-sm-3 text-muted">Building</dt>
      <dd className="col-sm-9">{site.building_name?.trim() || '—'}</dd>
      <dt className="col-sm-3 text-muted">PMC</dt>
      <dd className="col-sm-9">{site.property_management_company?.trim() || '—'}</dd>
      <dt className="col-sm-3 text-muted">Annual</dt>
      <dd className="col-sm-9">{annualDisplay(site) || '—'}</dd>
      <dt className="col-sm-3 text-muted">Key</dt>
      <dd className="col-sm-9">
        {site.key ? <Link to={`/keys/${site.key.id}`}>{site.key.keycode}</Link> : site.keys?.trim() || '—'}
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
      <dt className="col-sm-3 text-muted">Monitoring company</dt>
      <dd className="col-sm-9">{monitoringDisplay(site) || '—'}</dd>
      <dt className="col-sm-3 text-muted">Account #</dt>
      <dd className="col-sm-9">{site.monitoring_account_number?.trim() || '—'}</dd>
      <dt className="col-sm-3 text-muted">Monitoring notes</dt>
      <dd className="col-sm-9 text-break" style={{ whiteSpace: 'pre-wrap' }}>
        {site.monitoring_notes?.trim() || '—'}
      </dd>
      <dt className="col-sm-3 text-muted">Testing procedures</dt>
      <dd className="col-sm-9 text-break" style={{ whiteSpace: 'pre-wrap' }}>
        <CollapsibleCommentPreview text={site.testing_procedures} />
      </dd>
      <dt className="col-sm-3 text-muted">Location comments</dt>
      <dd className="col-sm-9 text-break" style={{ whiteSpace: 'pre-wrap' }}>
        <CollapsibleCommentPreview text={site.inspection_tech_notes} />
      </dd>
      <dt className="col-sm-3 text-muted">
        Latest run comment
        {formatRunCommentMonth(site.latest_run_comment_month) ? (
          <span className="d-block small fw-normal">
            {formatRunCommentMonth(site.latest_run_comment_month)}
          </span>
        ) : null}
      </dt>
      <dd className="col-sm-9 text-break" style={{ whiteSpace: 'pre-wrap' }}>
        <CollapsibleCommentPreview text={site.latest_run_comment} emptyText="No run comment yet." />
      </dd>
    </dl>
  )
}

function InlineTestingSiteFieldRow({
  fieldKey,
  label,
  value,
  displayValue,
  multiline,
  fullWidth = multiline,
  inputMode,
  selectOptions,
  helperText,
  collapsiblePreview,
  onSave,
}: {
  fieldKey: EditableTestingSiteField
  label: string
  value: string
  displayValue?: ReactNode
  multiline?: boolean
  fullWidth?: boolean
  inputMode?: 'decimal' | 'numeric'
  selectOptions?: InlineFieldOption[]
  helperText?: ReactNode
  collapsiblePreview?: boolean
  onSave: (fieldKey: EditableTestingSiteField, value: string) => Promise<void> | void
}) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const display = displayValue ?? (value.trim() || '—')

  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const startEdit = () => {
    if (saving) return
    setDraft(value)
    setSaveError(null)
    setEditing(true)
  }

  const cancel = () => {
    setDraft(value)
    setSaveError(null)
    setEditing(false)
  }

  const commit = async () => {
    const next = draft.trim()
    if (next === value.trim()) {
      setEditing(false)
      setSaveError(null)
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      await onSave(fieldKey, next)
      setEditing(false)
    } catch (err) {
      setSaveError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <div
        className={`monthly-testing-site-field-row monthly-testing-site-field-row--editable${
          multiline ? ' monthly-testing-site-field-row--multiline' : ''
        }${fullWidth ? ' monthly-testing-site-field-row--full' : ''}${
          collapsiblePreview ? ' monthly-testing-site-field-row--collapsible-preview' : ''
        }`}
        role="button"
        tabIndex={0}
        onClick={(e) => {
          const target = e.target
          if (target instanceof HTMLElement && target.closest('a, button')) return
          startEdit()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            startEdit()
          }
        }}
      >
        <div className="monthly-testing-site-field-label">{label}</div>
        <div className="monthly-testing-site-field-value">{display}</div>
      </div>
    )
  }

  return (
    <div
      className={`monthly-testing-site-field-row monthly-testing-site-field-row--editing${
        multiline ? ' monthly-testing-site-field-row--multiline' : ''
      }${fullWidth ? ' monthly-testing-site-field-row--full' : ''}`}
    >
      <label className="monthly-testing-site-field-label" htmlFor={inputId}>
        {label}
      </label>
      <div className="monthly-testing-site-field-value">
        {selectOptions ? (
          <select
            ref={inputRef as RefObject<HTMLSelectElement>}
            id={inputId}
            className="monthly-testing-site-field-input"
            value={draft}
            disabled={saving}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                cancel()
              }
            }}
          >
            {selectOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : multiline ? (
          <textarea
            ref={inputRef as RefObject<HTMLTextAreaElement>}
            id={inputId}
            className="monthly-testing-site-field-input"
            rows={3}
            value={draft}
            disabled={saving}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                cancel()
              }
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                void commit()
              }
            }}
          />
        ) : (
          <input
            ref={inputRef as RefObject<HTMLInputElement>}
            id={inputId}
            type="text"
            className="monthly-testing-site-field-input"
            inputMode={inputMode}
            value={draft}
            disabled={saving}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void commit()
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                cancel()
              }
            }}
          />
        )}
        {helperText ? <div className="monthly-testing-site-field-helper">{helperText}</div> : null}
        {saveError ? (
          <Alert variant="danger" className="monthly-testing-site-field-error py-1 px-2 mb-0 mt-2">
            {saveError}
          </Alert>
        ) : null}
        <div className="monthly-testing-site-field-edit-actions">
          <button
            type="button"
            className="monthly-testing-site-field-edit-btn"
            disabled={saving}
            onClick={cancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="monthly-testing-site-field-edit-btn monthly-testing-site-field-edit-btn--primary"
            disabled={saving}
            onClick={() => void commit()}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function InlineMonitoringCompanyFieldRow({
  site,
  form,
  companies,
  companiesLoading,
  onCompanyCreated,
  onSave,
}: {
  site: TestingSiteSummary
  form: TestingSiteEditForm
  companies: MonitoringCompanySummary[]
  companiesLoading?: boolean
  onCompanyCreated: (company: MonitoringCompanySummary) => void
  onSave: (fieldKey: EditableTestingSiteField, value: string) => Promise<void> | void
}) {
  const inputId = useId()
  const [editing, setEditing] = useState(false)
  const [draftId, setDraftId] = useState(form.monitoring_company_id)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const parsedId = form.monitoring_company_id.trim()
    ? Number.parseInt(form.monitoring_company_id, 10)
    : null
  const displayName = monitoringCompanyDisplayName(
    parsedId != null && !Number.isNaN(parsedId) ? parsedId : null,
    companies,
    site.monitoring_company?.name,
  )
  const phones = monitoringCompanyPhonesText(
    site.monitoring_company ??
      (parsedId != null && !Number.isNaN(parsedId)
        ? companies.find((row) => row.id === parsedId)
        : null),
  )

  useEffect(() => {
    if (!editing) setDraftId(form.monitoring_company_id)
  }, [form.monitoring_company_id, editing])

  const commit = async () => {
    const next = draftId.trim()
    if (next === form.monitoring_company_id.trim()) {
      setEditing(false)
      setSaveError(null)
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      await onSave('monitoring_company_id', next)
      setEditing(false)
    } catch (err) {
      setSaveError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <div
        className="monthly-testing-site-field-row monthly-testing-site-field-row--editable"
        role="button"
        tabIndex={0}
        onClick={(e) => {
          const target = e.target
          if (target instanceof HTMLElement && target.closest('a, button')) return
          setSaveError(null)
          setEditing(true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setSaveError(null)
            setEditing(true)
          }
        }}
      >
        <div className="monthly-testing-site-field-label">Monitoring company</div>
        <div className="monthly-testing-site-field-value">
          <div>{displayName}</div>
          {phones ? <div className="text-muted small">{phones}</div> : null}
        </div>
      </div>
    )
  }

  return (
    <div className="monthly-testing-site-field-row monthly-testing-site-field-row--editing">
      <label className="monthly-testing-site-field-label" htmlFor={inputId}>
        Monitoring company
      </label>
      <div className="monthly-testing-site-field-value">
        <MonitoringCompanySelect
          id={inputId}
          companies={companies}
          value={draftId.trim() ? Number.parseInt(draftId, 10) || null : null}
          disabled={saving || companiesLoading}
          onChange={(nextId) => setDraftId(nextId != null ? String(nextId) : '')}
          onCompanyCreated={onCompanyCreated}
        />
        {saveError ? <div className="text-danger small mt-1">{saveError}</div> : null}
        <div className="monthly-testing-site-field-edit-actions">
          <button
            type="button"
            className="monthly-testing-site-field-edit-btn"
            disabled={saving}
            onClick={() => {
              setDraftId(form.monitoring_company_id)
              setSaveError(null)
              setEditing(false)
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="monthly-testing-site-field-edit-btn monthly-testing-site-field-edit-btn--primary"
            disabled={saving}
            onClick={() => void commit()}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function InlineTestingSiteSection({
  title,
  variant,
  children,
}: {
  title: string
  variant?: 'access' | 'comments'
  children: ReactNode
}) {
  return (
    <section
      className={`monthly-testing-site-field-section${
        variant ? ` monthly-testing-site-field-section--${variant}` : ''
      }`}
    >
      <div className="monthly-testing-site-field-section-title">{title}</div>
      <div className="monthly-testing-site-field-section-grid">{children}</div>
    </section>
  )
}

function TestingSiteInlineFields({
  site,
  total,
  location,
  onInlineSave,
}: {
  site: TestingSiteSummary
  total: number
  location?: LibraryLocation | null
  onInlineSave: (form: TestingSiteEditForm) => Promise<void> | void
}) {
  const form = buildTestingSiteEditForm(site, location)
  const annualOptions = annualMonthDropdownOptions(form.annual_month)
  const { companies, loading: companiesLoading, appendCompany } = useMonitoringCompanies()

  const saveField = (fieldKey: EditableTestingSiteField, value: string) =>
    onInlineSave({ ...form, [fieldKey]: value })

  return (
    <div className="monthly-testing-site-field-grid">
      <InlineTestingSiteSection title="Identity & billing">
        {total > 1 ? (
          <InlineTestingSiteFieldRow
            fieldKey="label"
            label="Label"
            value={form.label}
            displayValue={site.label?.trim() || '—'}
            onSave={saveField}
          />
        ) : null}
        <InlineTestingSiteFieldRow
          fieldKey="price_per_month"
          label="Price/mo"
          value={form.price_per_month}
          displayValue={formatPrice(site.price_per_month)}
          inputMode="decimal"
          onSave={saveField}
        />
        <InlineTestingSiteFieldRow
          fieldKey="building_name"
          label="Building"
          value={form.building_name}
          displayValue={site.building_name?.trim() || '—'}
          onSave={saveField}
        />
        <InlineTestingSiteFieldRow
          fieldKey="property_management_company"
          label="PMC"
          value={form.property_management_company}
          displayValue={site.property_management_company?.trim() || '—'}
          onSave={saveField}
        />
        <InlineTestingSiteFieldRow
          fieldKey="annual_month"
          label="Annual"
          value={form.annual_month}
          displayValue={annualDisplay(site) || '—'}
          selectOptions={annualOptions}
          onSave={saveField}
        />
      </InlineTestingSiteSection>

      <InlineTestingSiteSection title="Access" variant="access">
        <InlineTestingSiteFieldRow
          fieldKey="keys"
          label="Key"
          value={form.keys}
          displayValue={
            site.key ? <Link to={`/keys/${site.key.id}`}>{site.key.keycode}</Link> : site.keys?.trim() || '—'
          }
          onSave={saveField}
        />
        <InlineTestingSiteFieldRow
          fieldKey="barcode"
          label="Barcode"
          value={form.barcode}
          displayValue={site.barcode?.trim() || '—'}
          onSave={saveField}
        />
        <InlineTestingSiteFieldRow
          fieldKey="door_code"
          label="Door code"
          value={form.door_code}
          displayValue={site.door_code?.trim() || '—'}
          onSave={saveField}
        />
        <InlineTestingSiteFieldRow
          fieldKey="ring_detail"
          label="Ring"
          value={form.ring_detail}
          displayValue={(site.ring_detail ?? site.ring ?? '').trim() || '—'}
          multiline
          fullWidth={false}
          onSave={saveField}
        />
      </InlineTestingSiteSection>

      <InlineTestingSiteSection title="Panel & monitoring">
        <InlineTestingSiteFieldRow
          fieldKey="facp_detail"
          label="FACP / panel"
          value={form.facp_detail}
          displayValue={panelDisplay(site) || '—'}
          multiline
          onSave={saveField}
        />
        <InlineTestingSiteFieldRow
          fieldKey="panel_location"
          label="Panel location"
          value={form.panel_location}
          displayValue={site.panel_location?.trim() || '—'}
          onSave={saveField}
        />
        <InlineMonitoringCompanyFieldRow
          site={site}
          form={form}
          companies={companies}
          companiesLoading={companiesLoading}
          onCompanyCreated={appendCompany}
          onSave={saveField}
        />
        <InlineTestingSiteFieldRow
          fieldKey="monitoring_account_number"
          label="Account #"
          value={form.monitoring_account_number}
          displayValue={site.monitoring_account_number?.trim() || '—'}
          onSave={saveField}
        />
        <InlineTestingSiteFieldRow
          fieldKey="monitoring_notes"
          label="Monitoring notes"
          value={form.monitoring_notes}
          displayValue={site.monitoring_notes?.trim() || '—'}
          multiline
          onSave={saveField}
        />
      </InlineTestingSiteSection>

      <InlineTestingSiteSection title="Comments" variant="comments">
        <InlineTestingSiteFieldRow
          fieldKey="testing_procedures"
          label="Testing procedures"
          value={form.testing_procedures}
          displayValue={<CollapsibleCommentPreview text={site.testing_procedures} />}
          multiline
          collapsiblePreview
          onSave={saveField}
        />
        <InlineTestingSiteFieldRow
          fieldKey="inspection_tech_notes"
          label="Location comments"
          value={form.inspection_tech_notes}
          displayValue={<CollapsibleCommentPreview text={site.inspection_tech_notes} />}
          multiline
          collapsiblePreview
          onSave={saveField}
        />
        <LatestRunCommentBlock
          comment={site.latest_run_comment}
          month={site.latest_run_comment_month}
        />
      </InlineTestingSiteSection>
    </div>
  )
}

function TestingSiteEditFormFields({
  site,
  total,
  form,
  onFormChange,
}: {
  site: TestingSiteSummary
  total: number
  form: TestingSiteEditForm
  onFormChange: (patch: Partial<TestingSiteEditForm>) => void
}) {
  const { companies, loading: companiesLoading, appendCompany } = useMonitoringCompanies()
  const companyId = form.monitoring_company_id.trim()
    ? Number.parseInt(form.monitoring_company_id, 10)
    : null

  return (
    <div className="d-flex flex-column gap-2">
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
              {annualMonthDropdownOptions(form.annual_month).map((opt) => (
                <option key={opt.value || '__empty'} value={opt.value}>
                  {opt.label}
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
        <Form.Label className="small mb-1">Monitoring company</Form.Label>
        <MonitoringCompanySelect
          companies={companies}
          value={companyId != null && !Number.isNaN(companyId) ? companyId : null}
          disabled={companiesLoading}
          onChange={(nextId) =>
            onFormChange({ monitoring_company_id: nextId != null ? String(nextId) : '' })
          }
          onCompanyCreated={appendCompany}
        />
      </Form.Group>
      <Form.Group>
        <Form.Label className="small mb-1">Account #</Form.Label>
        <Form.Control
          style={INPUT_STYLE}
          size="sm"
          value={form.monitoring_account_number}
          onChange={(e) => onFormChange({ monitoring_account_number: e.target.value })}
        />
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
      <LatestRunCommentBlock comment={site.latest_run_comment} month={site.latest_run_comment_month} />
    </div>
  )
}

export default function TestingSiteFieldsSection({
  mode,
  site,
  index,
  total,
  location,
  form,
  onFormChange,
  onInlineSave,
  onDelete,
  deleting,
  collapsible,
  defaultExpanded,
}: TestingSiteFieldsSectionProps) {
  const title = stopTitle(site, index, total, location)
  const summaryChips = cardSummary(site)
  const monitoringSummary = monitoringDisplay(site)
  const deleteControl =
    total > 1 && onDelete ? (
      <div className="monthly-testing-site-card-actions">
        <Button
          type="button"
          variant="outline-danger"
          size="sm"
          disabled={deleting}
          onClick={() => void onDelete(site)}
        >
          {deleting ? 'Removing…' : 'Remove testing site'}
        </Button>
      </div>
    ) : null

  if (mode === 'view') {
    return (
      <TestingSiteCardShell
        title={title}
        summaryChips={summaryChips}
        monitoringSummary={monitoringSummary}
        collapsible={collapsible}
        defaultExpanded={defaultExpanded}
      >
        <TestingSiteViewFields site={site} total={total} />
        {deleteControl}
      </TestingSiteCardShell>
    )
  }

  if (mode === 'inline') {
    if (!onInlineSave) return null
    return (
      <TestingSiteCardShell
        title={title}
        summaryChips={summaryChips}
        monitoringSummary={monitoringSummary}
        collapsible={collapsible}
        defaultExpanded={defaultExpanded}
      >
        <TestingSiteInlineFields
          site={site}
          total={total}
          location={location}
          onInlineSave={onInlineSave}
        />
        {deleteControl}
      </TestingSiteCardShell>
    )
  }

  if (!form || !onFormChange) return null

  return (
    <TestingSiteCardShell
      title={title}
      summaryChips={summaryChips}
      monitoringSummary={monitoringSummary}
      collapsible={collapsible}
      defaultExpanded={defaultExpanded}
    >
      <TestingSiteEditFormFields site={site} total={total} form={form} onFormChange={onFormChange} />
      {deleteControl}
    </TestingSiteCardShell>
  )
}
