import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Modal, Spinner } from 'react-bootstrap'
import type { ServiceTradeDeficiencySummary } from './monthlyRoutesShared'
import {
  deficiencySeverityLabel,
  deficiencyStatusLabel,
  formatDeficiencyTimestamp,
} from './runDetailsDeficiencyDisplay'
import {
  fetchServiceTradeDeficiencies,
  formatServiceTradeDeficiencyError,
} from './serviceTradeDeficienciesApi'

function StDeficiencyPill({ label }: { label: string }) {
  return <span className="st-deficiency-pill">{label}</span>
}

function ServiceTradeDeficiencyCard({ deficiency }: { deficiency: ServiceTradeDeficiencySummary }) {
  const description = (deficiency.description || '').trim() || 'No description'
  const serviceLine = (deficiency.service_line || '').trim() || 'Deficiency'

  return (
    <article className="st-deficiency-card">
      <div className="st-deficiency-card__content">
        <h3 className="st-deficiency-card__title">{serviceLine}</h3>
        <div className="st-deficiency-card__badges">
          {deficiency.severity ? (
            <StDeficiencyPill label={deficiencySeverityLabel(deficiency.severity)} />
          ) : null}
          {deficiency.status ? (
            <StDeficiencyPill label={deficiencyStatusLabel(deficiency.status)} />
          ) : null}
        </div>
        <p className="st-deficiency-card__description">{description}</p>
        {deficiency.reported_on ? (
          <p className="st-deficiency-card__reported text-muted">
            Reported {formatDeficiencyTimestamp(deficiency.reported_on)}
          </p>
        ) : null}
      </div>
      <Button
        as="a"
        href={deficiency.url}
        target="_blank"
        rel="noopener noreferrer"
        variant="outline-primary"
        className="st-deficiency-card__open-btn"
      >
        <span className="st-deficiency-card__open-btn-inner">
          <i className="bi bi-box-arrow-up-right" aria-hidden />
          Open in ServiceTrade
        </span>
      </Button>
    </article>
  )
}

type Props = {
  show: boolean
  onHide: () => void
  locationId: number
  locationLabel?: string
}

export default function ServiceTradeDeficienciesModal({
  show,
  onHide,
  locationId,
  locationLabel,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deficiencies, setDeficiencies] = useState<ServiceTradeDeficiencySummary[]>([])
  const [resolvedLabel, setResolvedLabel] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const payload = await fetchServiceTradeDeficiencies(locationId)
      setDeficiencies(payload.deficiencies)
      setResolvedLabel(payload.location_label)
    } catch (e) {
      setDeficiencies([])
      setResolvedLabel(null)
      setError(formatServiceTradeDeficiencyError(e))
    } finally {
      setLoading(false)
    }
  }, [locationId])

  useEffect(() => {
    if (!show) {
      setLoading(false)
      setError(null)
      setDeficiencies([])
      setResolvedLabel(null)
      return
    }
    void load()
  }, [show, load])

  const headingLabel = (locationLabel || resolvedLabel || '').trim()

  return (
    <Modal show={show} onHide={onHide} centered size="lg" className="st-deficiencies-modal">
      <Modal.Header closeButton={!loading}>
        <Modal.Title className="h6 mb-0">
          ServiceTrade deficiencies
          {headingLabel ? (
            <span className="st-deficiencies-modal__subtitle d-block small text-muted fw-normal mt-1">
              {headingLabel}
            </span>
          ) : null}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="st-deficiencies-modal__body">
        {loading ? (
          <div className="st-deficiencies-modal__loading py-4 text-center" aria-busy="true">
            <Spinner animation="border" size="sm" className="me-2" aria-hidden />
            Loading deficiencies…
          </div>
        ) : null}
        {!loading && error ? (
          <Alert variant="danger" className="py-2 small mb-0" role="alert">
            {error}
          </Alert>
        ) : null}
        {!loading && !error && deficiencies.length === 0 ? (
          <p className="text-muted small mb-0">No open ServiceTrade deficiencies for this site.</p>
        ) : null}
        {!loading && !error && deficiencies.length > 0 ? (
          <ul className="st-deficiency-cards list-unstyled mb-0">
            {deficiencies.map((def) => (
              <li key={def.deficiency_id} className="st-deficiency-cards__item">
                <ServiceTradeDeficiencyCard deficiency={def} />
              </li>
            ))}
          </ul>
        ) : null}
      </Modal.Body>
      <Modal.Footer className="st-deficiencies-modal__footer">
        <Button variant="secondary" size="sm" onClick={onHide} disabled={loading}>
          Close
        </Button>
      </Modal.Footer>
    </Modal>
  )
}
