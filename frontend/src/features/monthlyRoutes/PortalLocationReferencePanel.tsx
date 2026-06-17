import RichTextDisplay from '../richText/RichTextDisplay'
import PortalBootstrapIcon from './PortalBootstrapIcon'
import {
  libraryLocationHasMapCoordinates,
  STATUS_OPTIONS,
  type MonitoringCompanySummary,
} from './monthlyRoutesShared'
import {
  getPortalMapsProvider,
  openMapsLocation,
  type PortalMapsProvider,
} from './portalMapsLinks'
import {
  monitoringPhoneTelHref,
  stopHasMonitoring,
  stopMonitoringDisplay,
} from './stopMonitoringDisplay'

export type PortalLocationReference = {
  id: number
  label: string
  address: string
  display_address?: string | null
  building_name?: string | null
  property_management_company?: string | null
  route_label?: string | null
  status_normalized?: string | null
  keys?: string | null
  ring_detail?: string | null
  door_code?: string | null
  panel?: string | null
  panel_location?: string | null
  monitoring_company?: string | null
  monitoring_company_id?: number | null
  monitoring_account_number?: string | null
  monitoring_password?: string | null
  monitoring_notes?: string | null
  monitoring_company_record?: MonitoringCompanySummary | null
  access_instructions?: string | null
  testing_procedures?: string | null
  inspection_tech_notes?: string | null
  annual_month?: string | null
  latitude?: number | null
  longitude?: number | null
  latest_run_comment?: string | null
  latest_run_comment_month?: string | null
  service_trade_site_location_id?: number | null
  service_trade_site_location_url?: string | null
}

type PortalLocationReferencePanelProps = {
  location: PortalLocationReference
}

function FieldRow({ label, value }: { label: string; value: string }) {
  if (!value || value === '—') return null
  return (
    <div className="portal-location-ref-row">
      <span className="portal-location-ref-row__label">{label}</span>
      <span className="portal-location-ref-row__value">{value}</span>
    </div>
  )
}

function RichSection({ title, html }: { title: string; html: string | null | undefined }) {
  const trimmed = (html || '').trim()
  if (!trimmed) return null
  return (
    <section className="portal-location-ref-section">
      <h2 className="portal-location-ref-section__title">{title}</h2>
      <RichTextDisplay value={trimmed} className="portal-location-ref-rich" />
    </section>
  )
}

function portalLocationStatusKey(normalized?: string | null): string {
  const key = (normalized || '').trim().toLowerCase()
  return STATUS_OPTIONS.some((option) => option.value === key) ? key : 'unknown'
}

function portalLocationStatusLabel(normalized?: string | null): string {
  const key = (normalized || '').trim().toLowerCase()
  const match = STATUS_OPTIONS.find((option) => option.value === key)
  if (match) return match.label
  if (key) return key.replace(/_/g, ' ')
  return 'Unknown'
}

function monitoringSourceForLocation(location: PortalLocationReference) {
  const legacyObject =
    location.monitoring_company_record ??
    (typeof location.monitoring_company === 'object' && location.monitoring_company != null
      ? (location.monitoring_company as MonitoringCompanySummary)
      : null)
  const companyName =
    typeof location.monitoring_company === 'string'
      ? location.monitoring_company
      : legacyObject?.name ?? null

  return {
    monitoring_company: companyName,
    monitoring_company_id: location.monitoring_company_id,
    monitoring_account_number: location.monitoring_account_number,
    monitoring_password: location.monitoring_password,
    monitoring_notes: location.monitoring_notes,
    monitoring_company_record: legacyObject,
  }
}

export default function PortalLocationReferencePanel({ location }: PortalLocationReferencePanelProps) {
  const monitoringSource = monitoringSourceForLocation(location)
  const monitoring = stopMonitoringDisplay(monitoringSource)
  const showMonitoring =
    stopHasMonitoring(monitoringSource) ||
    monitoring.phones.length > 0 ||
    (location.monitoring_notes || '').trim().length > 0

  const mapsProvider: PortalMapsProvider = getPortalMapsProvider() ?? 'apple'
  const addressLine = (location.display_address || location.address || '').trim()
  const canDirections = libraryLocationHasMapCoordinates(location) || Boolean(addressLine)

  const openDirections = () => {
    openMapsLocation(mapsProvider, {
      display_address: location.display_address || location.address,
      latitude: location.latitude,
      longitude: location.longitude,
    })
  }

  const serviceTradeUrl = location.service_trade_site_location_url?.trim() || null

  return (
    <div className="portal-location-ref-panel">
      <section className="portal-location-ref-hero" aria-label="Site address">
        <div className="portal-location-ref-hero__header">
          {location.route_label ? (
            <div className="portal-location-ref-hero__route">{location.route_label}</div>
          ) : null}
          <span
            className={`portal-location-ref-hero__status portal-location-ref-hero__status--${portalLocationStatusKey(location.status_normalized)}`}
          >
            {portalLocationStatusLabel(location.status_normalized)}
          </span>
        </div>
        <div className="portal-location-ref-hero__address">{addressLine || 'Address not on file'}</div>
        {canDirections ? (
          <button type="button" className="portal-flow-btn-outline portal-location-ref-hero__directions" onClick={openDirections}>
            <PortalBootstrapIcon name="geo-alt" className="me-2" aria-hidden />
            Directions
          </button>
        ) : null}
      </section>

      {location.annual_month?.trim() ? (
        <div className="portal-location-ref-annual">
          Annual month: <strong>{location.annual_month.trim()}</strong>
        </div>
      ) : null}

      {location.property_management_company?.trim() ? (
        <section className="portal-location-ref-section">
          <h2 className="portal-location-ref-section__title">Property management</h2>
          <FieldRow label="Company" value={location.property_management_company.trim()} />
        </section>
      ) : null}

      <section className="portal-location-ref-section">
        <h2 className="portal-location-ref-section__title">Site access</h2>
        <FieldRow label="Key" value={(location.keys || '—').trim()} />
        <FieldRow label="Ring" value={(location.ring_detail || '—').trim()} />
        <FieldRow label="Door code" value={(location.door_code || '—').trim()} />
      </section>

      <section className="portal-location-ref-section">
        <h2 className="portal-location-ref-section__title">Panel</h2>
        <FieldRow label="Make / model" value={(location.panel || '—').trim()} />
        <FieldRow label="Location" value={(location.panel_location || '—').trim()} />
      </section>

      <section className="portal-location-ref-section">
        <h2 className="portal-location-ref-section__title">Monitoring</h2>
        {showMonitoring ? (
          <>
            <FieldRow label="Company" value={monitoring.company} />
            {monitoring.phones.map((phone) => (
              <div key={phone} className="portal-location-ref-row">
                <span className="portal-location-ref-row__label">Phone</span>
                <a className="portal-location-ref-row__link" href={monitoringPhoneTelHref(phone)}>
                  {phone}
                </a>
              </div>
            ))}
            <FieldRow label="Account" value={monitoring.account} />
            <FieldRow label="Password" value={monitoring.password} />
            {monitoring.notes !== '—' ? <FieldRow label="Notes" value={monitoring.notes} /> : null}
          </>
        ) : (
          <p className="portal-location-ref-plain mb-0">No monitoring information on file.</p>
        )}
      </section>

      <RichSection title="Access instructions" html={location.access_instructions} />
      <RichSection title="Testing procedures" html={location.testing_procedures} />
      <RichSection title="Inspection tech notes" html={location.inspection_tech_notes} />

      {location.latest_run_comment?.trim() ? (
        <section className="portal-location-ref-section">
          <h2 className="portal-location-ref-section__title">Latest run comment</h2>
          <p className="portal-location-ref-plain">{location.latest_run_comment.trim()}</p>
        </section>
      ) : null}

      <section className="portal-location-ref-servicetrade-card" aria-label="ServiceTrade">
        {serviceTradeUrl ? (
          <a
            href={serviceTradeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="portal-flow-btn-outline portal-location-ref-servicetrade-card__btn"
          >
            <PortalBootstrapIcon name="box-arrow-up-right" className="me-2" aria-hidden />
            Open in ServiceTrade
          </a>
        ) : (
          <button
            type="button"
            className="portal-flow-btn-outline portal-location-ref-servicetrade-card__btn"
            disabled
            title="This location is not linked to ServiceTrade yet."
          >
            <PortalBootstrapIcon name="box-arrow-up-right" className="me-2" aria-hidden />
            Open in ServiceTrade
          </button>
        )}
      </section>
    </div>
  )
}
