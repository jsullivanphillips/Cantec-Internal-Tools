import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Form } from 'react-bootstrap'
import { apiJson } from '../../lib/apiClient'
import type { MonthlyRouteSummary } from './monthlyRoutesShared'

export const DEFAULT_ROUTE_TECH_COUNT = 2

export function useRouteTechCountField({
  routeId,
  techCount,
  onTechCountPatched,
}: {
  routeId: number
  techCount: number | null | undefined
  onTechCountPatched: (techCount: number | null) => void
}) {
  const effective = techCount ?? DEFAULT_ROUTE_TECH_COUNT
  const [draft, setDraft] = useState(String(effective))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(String(techCount ?? DEFAULT_ROUTE_TECH_COUNT))
  }, [techCount])

  const save = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim()
      let nextStored: number | null
      if (trimmed === '' || trimmed === String(DEFAULT_ROUTE_TECH_COUNT)) {
        nextStored = null
      } else {
        const parsed = Number.parseInt(trimmed, 10)
        if (!Number.isFinite(parsed) || parsed < 1 || parsed > 9) {
          setError('Tech count must be between 1 and 9.')
          setDraft(String(techCount ?? DEFAULT_ROUTE_TECH_COUNT))
          return
        }
        nextStored = parsed
      }

      const prevStored = techCount ?? null
      if (nextStored === prevStored) return

      onTechCountPatched(nextStored)
      setSaving(true)
      setError(null)
      try {
        const body = await apiJson<{ ok: boolean; route: MonthlyRouteSummary }>(
          `/api/monthly_routes/routes/${routeId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tech_count: nextStored }),
          },
        )
        onTechCountPatched(body.route.tech_count ?? null)
        setDraft(String(body.route.tech_count ?? DEFAULT_ROUTE_TECH_COUNT))
      } catch (e) {
        onTechCountPatched(prevStored)
        setDraft(String(prevStored ?? DEFAULT_ROUTE_TECH_COUNT))
        setError(e instanceof Error ? e.message : 'Could not save tech count.')
      } finally {
        setSaving(false)
      }
    },
    [routeId, techCount, onTechCountPatched],
  )

  return { draft, setDraft, saving, error, save }
}

export function RouteTechCountKpiField({
  routeId,
  techCount,
  onTechCountPatched,
}: {
  routeId: number
  techCount: number | null | undefined
  onTechCountPatched: (techCount: number | null) => void
}) {
  const { draft, setDraft, saving, error, save } = useRouteTechCountField({
    routeId,
    techCount,
    onTechCountPatched,
  })
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing])

  const finishEditing = useCallback(() => {
    void save(draft)
    setEditing(false)
  }, [draft, save])

  return (
    <div className="monthly-route-kpi-strip__tech-field">
      {editing ? (
        <Form.Control
          ref={inputRef}
          type="number"
          min={1}
          max={9}
          step={1}
          value={draft}
          disabled={saving}
          aria-label="Techs required"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'route-tech-count-kpi-error' : undefined}
          title={error ?? `Default ${DEFAULT_ROUTE_TECH_COUNT} when unset`}
          placeholder={String(DEFAULT_ROUTE_TECH_COUNT)}
          className="monthly-route-kpi-strip__tech-input tabular-nums"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={finishEditing}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              finishEditing()
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              setDraft(String(techCount ?? DEFAULT_ROUTE_TECH_COUNT))
              setEditing(false)
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="monthly-route-kpi-strip__tech-display tabular-nums"
          disabled={saving}
          aria-label={`Techs required: ${draft}. Click to edit.`}
          title={error ?? `Default ${DEFAULT_ROUTE_TECH_COUNT} when unset`}
          onClick={() => setEditing(true)}
        >
          {draft}
        </button>
      )}
      {error ? (
        <span id="route-tech-count-kpi-error" className="monthly-route-kpi-strip__tech-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  )
}

export default function RouteTechCountCard({
  routeId,
  techCount,
  onTechCountPatched,
}: {
  routeId: number
  techCount: number | null | undefined
  onTechCountPatched: (techCount: number | null) => void
}) {
  const { draft, setDraft, saving, error, save } = useRouteTechCountField({
    routeId,
    techCount,
    onTechCountPatched,
  })

  return (
    <section
      className="monthly-location-detail-surface route-tech-count-card mb-3"
      aria-label="Tech count for expense breakdown"
    >
      <div className="route-tech-count-card__header mb-2">
        <h3 className="h6 mb-0">Techs required</h3>
        <p className="text-muted small mb-0 mt-1">
          Used on the Metrics breakdown (default {DEFAULT_ROUTE_TECH_COUNT})
        </p>
      </div>
      {error ? (
        <Alert variant="danger" className="py-2 small mb-2">
          {error}
        </Alert>
      ) : null}
      <Form.Control
        type="number"
        min={1}
        max={9}
        step={1}
        value={draft}
        disabled={saving}
        placeholder={`${DEFAULT_ROUTE_TECH_COUNT} (default)`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void save(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void save(draft)
          }
        }}
        className="route-tech-count-card__input"
        style={{ maxWidth: '8rem' }}
      />
    </section>
  )
}
