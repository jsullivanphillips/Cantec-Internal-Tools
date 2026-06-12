import { useState } from 'react'
import { Badge, Button } from 'react-bootstrap'
import RunDetailsDeficiencyDetailModal, {
  type RunDetailsDeficiencyModalContext,
} from './RunDetailsDeficiencyDetailModal'
import ServiceTradeDeficienciesButton from './ServiceTradeDeficienciesButton'
import type { MonthlyRunDetailDeficiencySummary } from './monthlyRoutesShared'
import {
  deficiencyCardPreview,
  deficiencySeverityLabel,
  deficiencySeverityVariant,
  deficiencyStatusLabel,
  deficiencyStatusVariant,
} from './runDetailsDeficiencyDisplay'
import ServiceTradeDeficiencyLink from './ServiceTradeDeficiencyLink'

export default function RunDetailsDeficiencyList({
  deficiencies,
  modalContext,
  routeId,
  monthDate,
  locationId,
  readOnly,
  onDeficiencyUpdated,
  onAdd,
  showServiceTradeDeficiencies = false,
  hasServiceTradeLink = false,
  locationLabel,
  compact,
  className,
}: {
  deficiencies: MonthlyRunDetailDeficiencySummary[]
  modalContext?: RunDetailsDeficiencyModalContext
  routeId: number
  monthDate: string
  locationId: number
  readOnly?: boolean
  onDeficiencyUpdated?: (
    locationId: number,
    updated: MonthlyRunDetailDeficiencySummary,
  ) => void | Promise<void>
  onAdd?: () => void
  showServiceTradeDeficiencies?: boolean
  hasServiceTradeLink?: boolean
  locationLabel?: string
  compact?: boolean
  className?: string
}) {
  const [selected, setSelected] = useState<MonthlyRunDetailDeficiencySummary | null>(null)
  const showAdd = !readOnly && onAdd != null
  const showStView = showServiceTradeDeficiencies
  const showActions = showStView || showAdd

  if (!deficiencies.length && !showActions) {
    if (compact) {
      return <span className="run-details-deficiency-empty">None open</span>
    }
    return null
  }

  return (
    <>
      {showActions ? (
        <div className="run-details-deficiency-actions-wrap">
          {showStView ? (
            <ServiceTradeDeficienciesButton
              locationId={locationId}
              hasServiceTradeLink={hasServiceTradeLink}
              locationLabel={locationLabel ?? modalContext?.locationLabel}
              className="run-details-deficiency-st-btn"
            />
          ) : null}
          {showAdd ? (
            <Button
              type="button"
              variant="outline-danger"
              size="sm"
              className="run-details-deficiency-add-btn"
              onClick={onAdd}
            >
              Add
            </Button>
          ) : null}
        </div>
      ) : null}
      {!deficiencies.length ? (
        compact && !showAdd ? (
          <span className="run-details-deficiency-empty">None open</span>
        ) : null
      ) : (
      <ul
        className={`run-details-deficiency-cards list-unstyled mb-0${
          compact ? ' run-details-deficiency-cards--compact' : ''
        }${className ? ` ${className}` : ''}`}
      >
        {deficiencies.map((def) => {
          const preview = deficiencyCardPreview(def)
          return (
            <li key={def.id} className="run-details-deficiency-cards__item">
              <button
                type="button"
                className="run-details-deficiency-card monthly-location-detail-surface"
                onClick={() => setSelected(def)}
                aria-label={`View details for ${(def.title || '').trim() || 'deficiency'}`}
              >
                <span className="run-details-deficiency-card__title">
                  {def.title || 'Deficiency'}
                </span>
                <span className="run-details-deficiency-card__badges">
                  <Badge bg={deficiencySeverityVariant(def.severity)}>
                    {deficiencySeverityLabel(def.severity)}
                  </Badge>
                  <Badge bg={deficiencyStatusVariant(def.status)}>
                    {deficiencyStatusLabel(def.status)}
                  </Badge>
                </span>
                {preview ? (
                  <span className="run-details-deficiency-card__preview text-muted">{preview}</span>
                ) : null}
                {def.service_trade_deficiency_id != null ? (
                  <span className="run-details-deficiency-card__st-link">
                    <ServiceTradeDeficiencyLink
                      deficiencyId={def.service_trade_deficiency_id}
                      compact
                      onClick={(event) => event.stopPropagation()}
                    />
                  </span>
                ) : null}
                <span className="run-details-deficiency-card__hint" aria-hidden>
                  <i className="bi bi-chevron-right" />
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      )}
      <RunDetailsDeficiencyDetailModal
        show={selected != null}
        deficiency={selected}
        context={modalContext}
        routeId={routeId}
        monthDate={monthDate}
        locationId={locationId}
        readOnly={readOnly}
        onHide={() => setSelected(null)}
        onSaved={async (updated) => {
          await onDeficiencyUpdated?.(locationId, updated)
          setSelected(null)
        }}
      />
    </>
  )
}
