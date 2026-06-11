import { useCallback, useState } from 'react'
import { Alert } from 'react-bootstrap'
import { apiJson } from '../../lib/apiClient'
import { PrepLongTextCell } from './RunDetailsPrepareFields'
import type { MonthlyRouteSummary } from './monthlyRoutesShared'

const FIELD_KEY = 'technician-note'

const EMPTY_PLACEHOLDER =
  'e.g. This route has several annuals — plan extra time at stop 4.'

export default function RouteTechnicianNoteCard({
  routeId,
  technicianNote,
  onTechnicianNotePatched,
}: {
  routeId: number
  technicianNote: string | null | undefined
  onTechnicianNotePatched: (technicianNote: string | null) => void
}) {
  const [activeFieldKey, setActiveFieldKey] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const value = technicianNote ?? ''

  const onCommit = useCallback(
    async (nextRaw: string) => {
      const next = nextRaw.trim()
      const prev = (technicianNote ?? '').trim()
      if (next === prev) return

      const optimistic = next.length > 0 ? next : null
      const rollback = (technicianNote ?? '').trim() || null

      onTechnicianNotePatched(optimistic)
      setSaving(true)
      setError(null)
      try {
        const body = await apiJson<{ ok: boolean; route: MonthlyRouteSummary }>(
          `/api/monthly_routes/routes/${routeId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              technician_note: optimistic,
            }),
          },
        )
        onTechnicianNotePatched(body.route.technician_note ?? null)
      } catch (e) {
        onTechnicianNotePatched(rollback)
        setError(e instanceof Error ? e.message : 'Could not save technician note.')
      } finally {
        setSaving(false)
      }
    },
    [routeId, technicianNote, onTechnicianNotePatched],
  )

  return (
    <section
      className="monthly-location-detail-surface route-technician-note-card"
      aria-label="Technician note for portal worksheet"
    >
      <div className="route-technician-note-card__header">
        <h2 className="monthly-run-detail-section__title mb-0">Technician Note</h2>
        <p className="text-muted small mb-0 mt-1">Shown to technicians on the worksheet header</p>
      </div>
      {error ? (
        <Alert variant="danger" className="py-2 small mb-2">
          {error}
        </Alert>
      ) : null}
      <PrepLongTextCell
        fieldKey={FIELD_KEY}
        value={value}
        disabled={saving}
        saving={saving}
        activeKey={activeFieldKey}
        onActivate={setActiveFieldKey}
        onCommit={(next) => void onCommit(next)}
        emptyPlaceholder={EMPTY_PLACEHOLDER}
      />
    </section>
  )
}
