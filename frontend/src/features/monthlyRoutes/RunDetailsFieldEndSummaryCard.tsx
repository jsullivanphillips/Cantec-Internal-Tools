import { useCallback, useState } from 'react'
import { Alert } from 'react-bootstrap'
import { apiJson } from '../../lib/apiClient'
import RichTextDisplay from '../richText/RichTextDisplay'
import { richTextIsEmpty, richTextValuesEqual } from '../richText/richTextSanitize'
import { PrepLongTextCell } from './RunDetailsPrepareFields'
import type { TechnicianWorksheetRun } from './monthlyRoutesShared'
import { canOfficeEditOutcomes, runFieldEnded } from './runWorkflowShared'

const FIELD_KEY = 'field-end-summary'

const EMPTY_PLACEHOLDER =
  'Technician debrief from the field — edit or add notes for the office review record.'

const COMPACT_EMPTY = 'No end-of-run summary was recorded.'

export default function RunDetailsFieldEndSummaryCard({
  routeId,
  monthDate,
  run,
  onFieldEndSummaryPatched,
  editsDisabled = false,
  compact = false,
}: {
  routeId: number
  monthDate: string
  run: TechnicianWorksheetRun | null
  onFieldEndSummaryPatched: (fieldEndSummary: string | null) => void
  editsDisabled?: boolean
  /** Match exact-history shell styling (read-only snapshot layout). */
  compact?: boolean
}) {
  const [activeFieldKey, setActiveFieldKey] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const value = run?.field_end_summary ?? ''
  const hasContent = !richTextIsEmpty(value)
  const canEdit = run != null && canOfficeEditOutcomes(run) && !editsDisabled && !compact

  const onCommit = useCallback(
    async (nextRaw: string) => {
      const next = nextRaw.trim()
      const prev = (run?.field_end_summary ?? '').trim()
      if (richTextValuesEqual(next, prev)) return

      const optimistic = richTextIsEmpty(next) ? null : next
      const rollback = richTextIsEmpty(prev) ? null : prev

      onFieldEndSummaryPatched(optimistic)
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
              field_end_summary: optimistic,
            }),
          },
        )
        onFieldEndSummaryPatched(body.run.field_end_summary ?? null)
      } catch (e) {
        onFieldEndSummaryPatched(rollback)
        setError(e instanceof Error ? e.message : 'Could not save end-of-run summary.')
      } finally {
        setSaving(false)
      }
    },
    [routeId, monthDate, run?.field_end_summary, onFieldEndSummaryPatched],
  )

  if (!run || !runFieldEnded(run)) return null

  if (compact) {
    return (
      <div className="run-details-history-section run-details-field-end-summary-section">
        <div className="run-details-history-shell run-details-field-end-summary--compact">
          <header className="run-details-history-shell__header">
            <div className="run-details-history-shell__title-block">
              <p className="run-details-history-shell__eyebrow">Run debrief</p>
              <h2 className="run-details-history-shell__title">End of run summary</h2>
            </div>
          </header>
          {hasContent ? (
            <div className="run-details-field-end-summary__compact-body">
              <RichTextDisplay value={value} className="run-details-field-end-summary__compact-rich" />
            </div>
          ) : (
            <p className="run-details-field-end-summary__compact-empty mb-0">{COMPACT_EMPTY}</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <section
      className="monthly-location-detail-surface run-details-field-end-summary"
      aria-label="End of run summary"
    >
      <div className="run-details-field-end-summary__header">
        <h2 className="monthly-run-detail-section__title mb-0">End of run summary</h2>
      </div>
      {error ? (
        <Alert variant="danger" className="py-2 small mb-2">
          {error}
        </Alert>
      ) : null}
      <PrepLongTextCell
        fieldKey={FIELD_KEY}
        value={value}
        disabled={!canEdit || saving}
        saving={saving}
        activeKey={activeFieldKey}
        onActivate={setActiveFieldKey}
        onCommit={(next) => void onCommit(next)}
        emptyPlaceholder={EMPTY_PLACEHOLDER}
        richText
      />
    </section>
  )
}
