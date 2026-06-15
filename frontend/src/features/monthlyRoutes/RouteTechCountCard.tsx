import { useCallback, useEffect, useState } from 'react'
import { Alert, Form } from 'react-bootstrap'
import { apiJson } from '../../lib/apiClient'
import type { MonthlyRouteSummary } from './monthlyRoutesShared'

const DEFAULT_TECH_COUNT = 2

export default function RouteTechCountCard({
  routeId,
  techCount,
  onTechCountPatched,
}: {
  routeId: number
  techCount: number | null | undefined
  onTechCountPatched: (techCount: number | null) => void
}) {
  const effective = techCount ?? DEFAULT_TECH_COUNT
  const [draft, setDraft] = useState(String(effective))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(String(techCount ?? DEFAULT_TECH_COUNT))
  }, [techCount])

  const save = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim()
      let nextStored: number | null
      if (trimmed === '' || trimmed === String(DEFAULT_TECH_COUNT)) {
        nextStored = null
      } else {
        const parsed = Number.parseInt(trimmed, 10)
        if (!Number.isFinite(parsed) || parsed < 1 || parsed > 9) {
          setError('Tech count must be between 1 and 9.')
          setDraft(String(techCount ?? DEFAULT_TECH_COUNT))
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
        setDraft(String(body.route.tech_count ?? DEFAULT_TECH_COUNT))
      } catch (e) {
        onTechCountPatched(prevStored)
        setDraft(String(prevStored ?? DEFAULT_TECH_COUNT))
        setError(e instanceof Error ? e.message : 'Could not save tech count.')
      } finally {
        setSaving(false)
      }
    },
    [routeId, techCount, onTechCountPatched],
  )

  return (
    <section
      className="monthly-location-detail-surface route-tech-count-card mb-3"
      aria-label="Tech count for expense breakdown"
    >
      <div className="route-tech-count-card__header mb-2">
        <h3 className="h6 mb-0">Techs required</h3>
        <p className="text-muted small mb-0 mt-1">
          Used on the Metrics breakdown (default {DEFAULT_TECH_COUNT})
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
        placeholder={`${DEFAULT_TECH_COUNT} (default)`}
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
