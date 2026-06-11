import { useState } from 'react'
import { Badge } from 'react-bootstrap'
import RunDetailsDeficiencyDetailModal, {
  type RunDetailsDeficiencyModalContext,
} from './RunDetailsDeficiencyDetailModal'
import type { MonthlyRunDetailDeficiencySummary } from './monthlyRoutesShared'
import {
  deficiencyCardPreview,
  deficiencySeverityLabel,
  deficiencySeverityVariant,
  deficiencyStatusLabel,
  deficiencyStatusVariant,
} from './runDetailsDeficiencyDisplay'

export default function RunDetailsDeficiencyList({
  deficiencies,
  modalContext,
  routeId,
  monthDate,
  locationId,
  readOnly,
  onDeficiencyUpdated,
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
  compact?: boolean
  className?: string
}) {
  const [selected, setSelected] = useState<MonthlyRunDetailDeficiencySummary | null>(null)

  if (!deficiencies.length) {
    if (compact) {
      return <span className="run-details-deficiency-empty">None open</span>
    }
    return null
  }

  return (
    <>
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
                <span className="run-details-deficiency-card__hint" aria-hidden>
                  <i className="bi bi-chevron-right" />
                </span>
              </button>
            </li>
          )
        })}
      </ul>
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
