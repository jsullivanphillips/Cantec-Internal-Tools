import { useCallback, useState } from 'react'
import { Alert } from 'react-bootstrap'
import { apiJson } from '../../lib/apiClient'
import { PrepLongTextCell } from './RunDetailsPrepareFields'
import type { TechnicianWorksheetRun } from './monthlyRoutesShared'

const FIELD_KEY = 'pre-run-message'

const EMPTY_PLACEHOLDER =
  'e.g. Do not skip 123 Main St — it was missed last month.'

export default function RunDetailsPreRunMessageCard({
  routeId,
  monthDate,
  run,
  onPreRunMessagePatched,
  prepEditsDisabled = false,
  readyEditLocked = false,
}: {
  routeId: number
  monthDate: string
  run: TechnicianWorksheetRun | null
  onPreRunMessagePatched: (preRunMessage: string | null) => void
  prepEditsDisabled?: boolean
  readyEditLocked?: boolean
}) {
  const [activeFieldKey, setActiveFieldKey] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const value = run?.pre_run_message ?? ''

  const onCommit = useCallback(
    async (nextRaw: string) => {
      const next = nextRaw.trim()
      const prev = (run?.pre_run_message ?? '').trim()
      if (next === prev) return

      const optimistic = next.length > 0 ? next : null
      const rollback = (run?.pre_run_message ?? '').trim() || null

      onPreRunMessagePatched(optimistic)
      setSaving(true)
      setError(null)
      try {
        const body = await apiJson<{ ok: boolean; run: TechnicianWorksheetRun }>(
          `/api/monthly_routes/routes/${routeId}/runs`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              month_date: monthDate,
              pre_run_message: optimistic,
            }),
          },
        )
        onPreRunMessagePatched(body.run.pre_run_message ?? null)
      } catch (e) {
        onPreRunMessagePatched(rollback)
        setError(e instanceof Error ? e.message : 'Could not save pre-run message.')
      } finally {
        setSaving(false)
      }
    },
    [routeId, monthDate, run?.pre_run_message, onPreRunMessagePatched],
  )

  return (
    <section
      className="monthly-location-detail-surface run-details-pre-run-message"
      aria-label="Pre-run message for technicians"
    >
      <div className="run-details-pre-run-message__header">
        <h2 className="monthly-run-detail-section__title mb-0">Pre-run message</h2>
      </div>
      {error ? (
        <Alert variant="danger" className="py-2 small mb-2">
          {error}
        </Alert>
      ) : null}
      <PrepLongTextCell
        fieldKey={FIELD_KEY}
        value={value}
        disabled={saving || prepEditsDisabled}
        readyEditLocked={readyEditLocked}
        saving={saving}
        activeKey={activeFieldKey}
        onActivate={setActiveFieldKey}
        onCommit={(next) => void onCommit(next)}
        emptyPlaceholder={EMPTY_PLACEHOLDER}
      />
    </section>
  )
}
