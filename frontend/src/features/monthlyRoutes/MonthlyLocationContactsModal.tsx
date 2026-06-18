import { useCallback, useEffect, useState } from 'react'
import { Alert, Modal, Spinner } from 'react-bootstrap'
import { apiJson } from '../../lib/apiClient'

export type ServiceTradeSiteContact = {
  id: number
  first_name: string | null
  last_name: string | null
  display_name: string
  email: string | null
  phone: string | null
  mobile: string | null
  alternate_phone: string | null
  contact_type: string | null
  is_primary: boolean
}

type ContactsPayload = {
  has_service_trade_link: boolean
  contacts: ServiceTradeSiteContact[]
}

type Props = {
  show: boolean
  onHide: () => void
  locationId: number
  locationLabel?: string
}

function contactRoleLabel(contact: ServiceTradeSiteContact): string | null {
  const role = (contact.contact_type || '').trim()
  return role || null
}

function ContactPhoneLine({ label, number }: { label: string; number: string }) {
  const tel = number.replace(/\s+/g, '')
  return (
    <p className="monthly-location-contacts-modal__phone-line">
      <span className="monthly-location-contacts-modal__phone-label">{label}</span>{' '}
      <a href={`tel:${tel}`} className="monthly-location-contacts-modal__phone-value">
        {number}
      </a>
    </p>
  )
}

function ServiceTradeContactRow({ contact }: { contact: ServiceTradeSiteContact }) {
  const role = contactRoleLabel(contact)
  const email = (contact.email || '').trim()
  const phone = (contact.phone || '').trim()
  const mobile = (contact.mobile || '').trim()
  const alternate = (contact.alternate_phone || '').trim()

  return (
    <article className="monthly-location-contacts-modal__row">
      <div className="monthly-location-contacts-modal__name-row">
        <h3 className="monthly-location-contacts-modal__name">{contact.display_name}</h3>
        {contact.is_primary ? (
          <span className="monthly-location-contacts-modal__primary-pill">location primary contact</span>
        ) : null}
      </div>
      {email ? (
        <a href={`mailto:${email}`} className="monthly-location-contacts-modal__email">
          {email}
        </a>
      ) : null}
      {phone ? <ContactPhoneLine label="Phone:" number={phone} /> : null}
      {mobile ? <ContactPhoneLine label="Mobile:" number={mobile} /> : null}
      {alternate ? <ContactPhoneLine label="Alternate:" number={alternate} /> : null}
      {role ? <p className="monthly-location-contacts-modal__role">{role}</p> : null}
    </article>
  )
}

export default function MonthlyLocationContactsModal({
  show,
  onHide,
  locationId,
  locationLabel,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [contacts, setContacts] = useState<ServiceTradeSiteContact[]>([])
  const [hasLink, setHasLink] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const payload = await apiJson<ContactsPayload>(
        `/api/monthly_routes/library/${locationId}/service_trade_contacts`,
      )
      setHasLink(payload.has_service_trade_link)
      setContacts(payload.contacts || [])
    } catch {
      setError('Unable to load ServiceTrade contacts.')
      setContacts([])
      setHasLink(false)
    } finally {
      setLoading(false)
    }
  }, [locationId])

  useEffect(() => {
    if (!show) return
    void load()
  }, [show, load])

  return (
    <Modal
      show={show}
      onHide={onHide}
      centered
      size="lg"
      className="monthly-location-contacts-modal"
      aria-labelledby="monthly-location-contacts-modal-title"
    >
      <Modal.Header closeButton={!loading}>
        <Modal.Title className="h6 mb-0" id="monthly-location-contacts-modal-title">
          Contacts
          {locationLabel ? (
            <span className="d-block small text-muted fw-normal mt-1">{locationLabel}</span>
          ) : null}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="monthly-location-contacts-modal__body">
        {loading ? (
          <div className="monthly-location-contacts-modal__loading" role="status" aria-live="polite">
            <Spinner animation="border" size="sm" />
            <span>Loading contacts…</span>
          </div>
        ) : null}
        {error ? (
          <Alert variant="danger" className="py-2 small mx-3 mt-3">
            {error}
          </Alert>
        ) : null}
        {!loading && !error && hasLink && contacts.length === 0 ? (
          <p className="monthly-location-contacts-modal__empty">No contacts synced for this site yet.</p>
        ) : null}
        {!loading && !error && contacts.length > 0 ? (
          <div className="monthly-location-contacts-modal__list">
            {contacts.map((contact) => (
              <ServiceTradeContactRow key={contact.id} contact={contact} />
            ))}
          </div>
        ) : null}
      </Modal.Body>
    </Modal>
  )
}
