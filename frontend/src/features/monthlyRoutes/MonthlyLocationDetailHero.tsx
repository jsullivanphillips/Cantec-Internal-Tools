import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Dropdown } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import { formatCurrencyCad as formatPriceCad } from '../../lib/formatCurrencyCad'
import { apiJson } from '../../lib/apiClient'
import LocationTicketsModal from './LocationTicketsModal'
import MonthlyLocationContactsModal from './MonthlyLocationContactsModal'
import MonthlyLocationTagsEditor from './MonthlyLocationTagsEditor'
import {
  formatStartUpDateDisplay,
  lastRecordedTestSummary,
  libraryDisplayPricePerMonth,
  libraryKeycodeDisplay,
  libraryRouteDisplay,
  nextSiteRouteTestDayLabel,
  splitHeroAddressLines,
  type LibraryLocation,
  type LinkedKeyUiStatus,
} from './monthlyRoutesShared'
import { fetchLocationTickets } from './locationTicketsShared'

function locationTitle(location: LibraryLocation): string {
  return location.label?.trim() || location.address?.trim() || 'Untitled location'
}

function locationStatusLabel(location: LibraryLocation): string {
  return (location.status_raw || location.status_normalized || '').replace(/_/g, ' ') || '—'
}

function LocationHeroStatusBadge({
  normalized,
  label,
  onClick,
}: {
  normalized: string
  label: string
  onClick?: () => void
}) {
  const className = `monthly-location-hero-status-badge monthly-location-hero-status-badge--${
    normalized || 'unknown'
  } text-capitalize`

  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick}>
        {label}
      </button>
    )
  }

  return <span className={className}>{label}</span>
}

function linkedKeyIcon(ui: LinkedKeyUiStatus | undefined): {
  icon: string
  tone: 'out' | 'in' | 'unknown'
  title: string
} {
  if (ui?.is_out) {
    return {
      icon: 'bi-box-arrow-up-right',
      tone: 'out',
      title: `Signed out to ${ui.current_loc?.trim() || '—'}`,
    }
  }
  if (ui?.is_in) {
    return {
      icon: 'bi-check-circle-fill',
      tone: 'in',
      title: `At home (${ui.home_loc?.trim() || 'Office'})`,
    }
  }
  return {
    icon: 'bi-question-circle',
    tone: 'unknown',
    title: ui?.status_text?.trim() || 'Key status unknown',
  }
}

function HeroKeyValue({ location }: { location: LibraryLocation }) {
  const text = libraryKeycodeDisplay(location).trim() || '—'
  const keyRecord = location.key

  if (keyRecord != null) {
    const { icon, tone, title } = linkedKeyIcon(keyRecord.ui)
    return (
      <span className="monthly-location-detail-hero-key" title={title}>
        <Link to={`/keys/${keyRecord.id}`} className="monthly-location-detail-hero-key__link">
          {text}
          <i className={`bi ${icon} monthly-location-detail-hero-key__icon monthly-location-detail-hero-key__icon--${tone}`} aria-hidden />
        </Link>
      </span>
    )
  }

  return <span>{text}</span>
}

function HeroColumn({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="monthly-location-detail-hero-column">
      <div className="monthly-location-detail-hero-column__label">{label}</div>
      <div className="monthly-location-detail-hero-column__content">{children}</div>
    </div>
  )
}

function HeroContentLine({ children }: { children: ReactNode }) {
  return <div className="monthly-location-detail-hero-line">{children}</div>
}

type Props = {
  location: LibraryLocation
  heroActionsBusy: boolean
  serviceTradeLinkedUrl: string | null
  hasServiceTradeLink: boolean
  savedAnnualMonthLabel?: string | null
  savedAnnualMonthSyncing?: boolean
  onOpenStatusModal: () => void
  onOpenIdentityEdit: () => void
  onOpenRouteModal: () => void
  onOpenDeleteModal: () => void
  onOpenStDeficiencies: () => void
  onOpenStLinkEdit: () => void
  onLocationUpdated: (location: LibraryLocation) => void
  sessionUsername?: string | null
}

export default function MonthlyLocationDetailHero({
  location,
  heroActionsBusy,
  serviceTradeLinkedUrl,
  hasServiceTradeLink,
  savedAnnualMonthLabel = null,
  savedAnnualMonthSyncing = false,
  onOpenStatusModal,
  onOpenIdentityEdit,
  onOpenRouteModal,
  onOpenDeleteModal,
  onOpenStDeficiencies,
  onOpenStLinkEdit,
  onLocationUpdated,
  sessionUsername = null,
}: Props) {
  const [showContactsModal, setShowContactsModal] = useState(false)
  const [showTicketsModal, setShowTicketsModal] = useState(false)
  const [contactCount, setContactCount] = useState<number | null>(null)
  const [ticketCount, setTicketCount] = useState<number | null>(null)

  const statusLabel = locationStatusLabel(location)
  const { streetLine, localityLine } = splitHeroAddressLines(location)
  const routeLabel = libraryRouteDisplay(location)
  const routeLabelText = routeLabel.trim() || 'Unassigned'
  const routeDetailId = location.monthly_route?.id ?? location.monthly_route_id ?? null
  const displayPrice = libraryDisplayPricePerMonth(location)
  const propertyManagementLabel = location.property_management_company?.trim() || '—'
  const buildingName = location.building_name?.trim() || ''
  const savedAnnualMonthDisplay = savedAnnualMonthSyncing
    ? '…'
    : savedAnnualMonthLabel?.trim() || '—'
  const nextTestDay = useMemo(() => nextSiteRouteTestDayLabel(location), [location])
  const lastTest = useMemo(
    () =>
      lastRecordedTestSummary(location.months, {
        monthly_route: location.monthly_route,
      }),
    [location.months, location.monthly_route],
  )

  useEffect(() => {
    if (!hasServiceTradeLink) {
      setContactCount(0)
      return
    }
    let active = true
    apiJson<{ contacts: unknown[] }>(
      `/api/monthly_routes/library/${location.id}/service_trade_contacts`,
    )
      .then((payload) => {
        if (active) setContactCount((payload.contacts || []).length)
      })
      .catch(() => {
        if (active) setContactCount(null)
      })
    return () => {
      active = false
    }
  }, [hasServiceTradeLink, location.id])

  useEffect(() => {
    if (routeDetailId == null) {
      setTicketCount(0)
      return
    }
    let active = true
    fetchLocationTickets(routeDetailId, location.id, false)
      .then((rows) => {
        if (active) setTicketCount(rows.length)
      })
      .catch(() => {
        if (active) setTicketCount(null)
      })
    return () => {
      active = false
    }
  }, [routeDetailId, location.id])

  const contactsPillLabel = !hasServiceTradeLink
    ? '0 Contacts'
    : contactCount == null
      ? 'Contacts'
      : `${contactCount} Contact${contactCount === 1 ? '' : 's'}`
  const contactsDisabled = !hasServiceTradeLink || contactCount === 0

  const ticketsPillLabel =
    routeDetailId == null
      ? '0 Tickets'
      : ticketCount == null
        ? 'Tickets'
        : `${ticketCount} Ticket${ticketCount === 1 ? '' : 's'}`
  const ticketsDisabled = routeDetailId == null

  const locationLabel = locationTitle(location)

  const routeValue =
    routeDetailId != null && routeLabel.trim() ? (
      <Link to={`/monthlies/routes/${routeDetailId}`} className="monthly-location-detail-hero-link">
        {routeLabelText}
      </Link>
    ) : (
      <span>{routeLabelText}</span>
    )

  return (
    <>
      <section className="monthly-location-detail-hero monthly-location-detail-surface">
        <div className="monthly-location-detail-hero-title-row">
          <div className="monthly-location-detail-hero-title-group">
            <h1 className="monthly-location-detail-title">{locationTitle(location)}</h1>
            <LocationHeroStatusBadge
              normalized={location.status_normalized || 'unknown'}
              label={statusLabel}
              onClick={onOpenStatusModal}
            />
            <button
              type="button"
              className="monthly-location-detail-hero-contacts-pill"
              disabled={contactsDisabled}
              title={
                !hasServiceTradeLink
                  ? 'Link this site to ServiceTrade to view contacts.'
                  : contactCount === 0
                    ? 'No contacts synced for this site.'
                    : undefined
              }
              onClick={() => setShowContactsModal(true)}
            >
              <i className="bi bi-people" aria-hidden />
              {contactsPillLabel}
            </button>
            <button
              type="button"
              className="monthly-location-detail-hero-tickets-pill"
              disabled={ticketsDisabled}
              title={routeDetailId == null ? 'Assign a route to manage tickets.' : undefined}
              onClick={() => setShowTicketsModal(true)}
            >
              <i className="bi bi-ticket-perforated" aria-hidden />
              {ticketsPillLabel}
            </button>
          </div>
          <div className="monthly-location-detail-hero-actions">
            <Dropdown align="end" className="monthly-location-detail-hero-actions-dropdown">
              <Dropdown.Toggle
                variant="outline-secondary"
                size="sm"
                className="monthly-location-detail-action"
                id="monthly-location-detail-actions"
                disabled={heroActionsBusy}
              >
                <i className="bi bi-three-dots-vertical" aria-hidden />
                Actions
              </Dropdown.Toggle>
              <Dropdown.Menu>
                <Dropdown.Item onClick={onOpenIdentityEdit}>
                  <i className="bi bi-pencil me-2" aria-hidden />
                  Edit
                </Dropdown.Item>
                <Dropdown.Divider />
                <Dropdown.Item onClick={onOpenRouteModal}>
                  <i className="bi bi-signpost-split me-2" aria-hidden />
                  Change route
                </Dropdown.Item>
                <Dropdown.Item onClick={onOpenStatusModal}>
                  <i className="bi bi-sliders me-2" aria-hidden />
                  Change status
                </Dropdown.Item>
                <Dropdown.Divider />
                {serviceTradeLinkedUrl ? (
                  <Dropdown.Item
                    href={serviceTradeLinkedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <i className="bi bi-box-arrow-up-right me-2" aria-hidden />
                    Open in Service Trade
                  </Dropdown.Item>
                ) : (
                  <Dropdown.Item disabled title="Link this site to ServiceTrade to open it.">
                    <i className="bi bi-box-arrow-up-right me-2" aria-hidden />
                    Open in Service Trade
                  </Dropdown.Item>
                )}
                <Dropdown.Item
                  disabled={!hasServiceTradeLink}
                  title={
                    hasServiceTradeLink ? undefined : 'Link this site to ServiceTrade to view deficiencies.'
                  }
                  onClick={onOpenStDeficiencies}
                >
                  <i className="bi bi-exclamation-triangle me-2" aria-hidden />
                  View ST Deficiencies
                </Dropdown.Item>
                <Dropdown.Item onClick={onOpenStLinkEdit}>
                  <i className="bi bi-pencil me-2" aria-hidden />
                  Edit ST Link
                </Dropdown.Item>
                <Dropdown.Divider />
                <Dropdown.Item
                  className="text-danger"
                  disabled={heroActionsBusy}
                  onClick={onOpenDeleteModal}
                >
                  <i className="bi bi-trash me-2" aria-hidden />
                  Delete location
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown>
          </div>
        </div>

        <div className="monthly-location-detail-hero-columns">
          <HeroColumn label="Location">
            <HeroContentLine>{streetLine}</HeroContentLine>
            {localityLine ? <HeroContentLine>{localityLine}</HeroContentLine> : null}
            {buildingName ? (
              <HeroContentLine>
                <span className="monthly-location-detail-hero-muted-label">Building</span> {buildingName}
              </HeroContentLine>
            ) : null}
            {serviceTradeLinkedUrl ? (
              <HeroContentLine>
                <a
                  href={serviceTradeLinkedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="monthly-location-detail-hero-link"
                >
                  Open ServiceTrade location
                </a>
              </HeroContentLine>
            ) : null}
          </HeroColumn>
          <HeroColumn label="Property management">
            <HeroContentLine>{propertyManagementLabel}</HeroContentLine>
            <HeroContentLine>
              <span className="monthly-location-detail-hero-muted-label">Key</span>{' '}
              <HeroKeyValue location={location} />
            </HeroContentLine>
            <HeroContentLine>
              <span className="monthly-location-detail-hero-muted-label">Annual</span>{' '}
              {savedAnnualMonthDisplay}
            </HeroContentLine>
          </HeroColumn>
          <HeroColumn label="Route">
            <HeroContentLine>{routeValue}</HeroContentLine>
            <HeroContentLine>
              <span className="monthly-location-detail-hero-muted-label">Next test</span>{' '}
              {nextTestDay}
            </HeroContentLine>
            <HeroContentLine>
              <span className="monthly-location-detail-hero-muted-label">Last test</span>{' '}
              {lastTest || '—'}
            </HeroContentLine>
          </HeroColumn>
          <HeroColumn label="Billing">
            <HeroContentLine>
              <span className="monthly-location-detail-hero-muted-label">Monthly price</span>{' '}
              {formatPriceCad(displayPrice)}
            </HeroContentLine>
            <HeroContentLine>
              <span className="monthly-location-detail-hero-muted-label">Startup date</span>{' '}
              {formatStartUpDateDisplay(location.start_up_date)}
            </HeroContentLine>
          </HeroColumn>
        </div>

        <MonthlyLocationTagsEditor location={location} onLocationUpdated={onLocationUpdated} />
      </section>

      <MonthlyLocationContactsModal
        show={showContactsModal}
        onHide={() => setShowContactsModal(false)}
        locationId={location.id}
        locationLabel={locationLabel}
      />
      {routeDetailId != null ? (
        <LocationTicketsModal
          show={showTicketsModal}
          onHide={() => setShowTicketsModal(false)}
          routeId={routeDetailId}
          locationId={location.id}
          locationLabel={locationLabel}
          monthDate={null}
          sessionUsername={sessionUsername}
          onTicketsChanged={() => {
            void fetchLocationTickets(routeDetailId, location.id, false)
              .then((rows) => setTicketCount(rows.length))
              .catch(() => setTicketCount(null))
          }}
        />
      ) : null}
    </>
  )
}
