import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Modal } from 'react-bootstrap'

import { apiJson } from '../../lib/apiClient'
import RichTextEditor, { type RichTextEditorHandle } from '../richText/RichTextEditor'
import RichTextToolbar from '../richText/RichTextToolbar'
import type { TechnicianWorksheetRun } from './monthlyRoutesShared'
import {
  comparisonHeadline,
  comparisonTone,
  formatFieldDuration,
  type PortalRunSummary,
} from './portalRunSummary'
import { prefersReducedMotion, useCountUp } from './useCountUp'

type WizardStep = 'performance' | 'debrief'

type Props = {
  summary: PortalRunSummary | null
  routeId: number
  initialFieldEndSummary?: string | null
  onDismiss: () => void
  onSaved: (run: TechnicianWorksheetRun) => void
}

const COUNT_UP_MS = 650
const COMPARISON_STAGGER_MS = 120
const DEBRIEF_PLACEHOLDER =
  'Summarize how the run went — anything the office should know before review.'

function OutcomeStat({ label, value, animate }: { label: string; value: number; animate: boolean }) {
  const displayed = useCountUp(value, COUNT_UP_MS, animate)
  return (
    <div className="pw-run-summary-stat">
      <span className="pw-run-summary-stat__label">{label}</span>
      <span className="pw-run-summary-stat__value tabular-nums">{displayed ?? value}</span>
    </div>
  )
}

function ComparisonLine({
  text,
  tone,
  visible,
  delayMs,
}: {
  text: string
  tone: 'positive' | 'negative' | 'neutral'
  visible: boolean
  delayMs: number
}) {
  return (
    <p
      className={`pw-run-summary-comparison pw-run-summary-comparison--${tone}${
        visible ? ' pw-run-summary-comparison--revealed' : ''
      }`}
      style={{ transitionDelay: visible ? `${delayMs}ms` : undefined }}
    >
      {text}
    </p>
  )
}

export default function PortalRunSummaryModal({
  summary,
  routeId,
  initialFieldEndSummary,
  onDismiss,
  onSaved,
}: Props) {
  const animate = useMemo(() => !prefersReducedMotion(), [])
  const [step, setStep] = useState<WizardStep>('performance')
  const [comparisonsVisible, setComparisonsVisible] = useState(!animate)
  const [debriefHtml, setDebriefHtml] = useState('')
  const [richTextEditor, setRichTextEditor] = useState<RichTextEditorHandle | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const fieldDurationMinutes = summary?.field_duration_minutes ?? null
  const animatedFieldDuration = useCountUp(fieldDurationMinutes, COUNT_UP_MS, animate && summary != null)

  useEffect(() => {
    if (!summary) {
      setStep('performance')
      setComparisonsVisible(false)
      setDebriefHtml('')
      setSaveError(null)
      return
    }
    setStep('performance')
    setDebriefHtml(initialFieldEndSummary ?? '')
    setSaveError(null)
    if (!animate) {
      setComparisonsVisible(true)
      return
    }
    setComparisonsVisible(false)
    const timer = window.setTimeout(() => setComparisonsVisible(true), COUNT_UP_MS + 80)
    return () => window.clearTimeout(timer)
  }, [summary, animate, initialFieldEndSummary])

  const goToDebrief = useCallback(() => {
    setDebriefHtml(initialFieldEndSummary ?? '')
    setSaveError(null)
    setStep('debrief')
  }, [initialFieldEndSummary])

  const saveDebrief = useCallback(async () => {
    setSaving(true)
    setSaveError(null)
    try {
      const body = await apiJson<{ ok: boolean; run: TechnicianWorksheetRun }>(
        `/api/technician_portal/routes/${routeId}/runs/field_end_summary`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ field_end_summary: debriefHtml.trim() ? debriefHtml : null }),
        },
      )
      onSaved(body.run)
      onDismiss()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save end-of-run summary.')
    } finally {
      setSaving(false)
    }
  }, [routeId, debriefHtml, onSaved, onDismiss])

  if (!summary) return null

  const fieldComparison = summary.comparisons.field_duration
  const finishComparison = summary.comparisons.finish_time
  const comparisonLines: { key: string; text: string; tone: 'positive' | 'negative' | 'neutral' }[] = []

  if (fieldComparison) {
    comparisonLines.push({
      key: 'field_duration',
      text: comparisonHeadline(fieldComparison, 'field_duration'),
      tone: comparisonTone(fieldComparison.direction),
    })
  }
  if (finishComparison) {
    comparisonLines.push({
      key: 'finish_time',
      text: comparisonHeadline(finishComparison, 'finish_time'),
      tone: comparisonTone(finishComparison.direction),
    })
  }

  const performanceStep = step === 'performance'
  const canClosePerformance = comparisonsVisible
  const modalDismissible = performanceStep ? canClosePerformance : !saving

  return (
    <Modal
      show
      centered
      onHide={modalDismissible ? onDismiss : undefined}
      backdrop={modalDismissible ? true : 'static'}
      keyboard={modalDismissible}
      className="pw-run-summary-modal"
      size={performanceStep ? undefined : 'lg'}
    >
      <Modal.Header
        closeButton={modalDismissible}
        className="pw-run-summary-modal__header border-0 pb-0"
      >
        <Modal.Title className="pw-run-summary-modal__title">
          {performanceStep ? (
            <>
              <span className="pw-run-summary-modal__check" aria-hidden>
                <i className="bi bi-check-circle-fill" />
              </span>
              Run complete
            </>
          ) : (
            'End of run summary'
          )}
        </Modal.Title>
      </Modal.Header>

      <div className="pw-run-summary-modal__steps" aria-hidden>
        <span
          className={`pw-run-summary-modal__step${performanceStep ? ' pw-run-summary-modal__step--active' : ' pw-run-summary-modal__step--done'}`}
        />
        <span
          className={`pw-run-summary-modal__step${!performanceStep ? ' pw-run-summary-modal__step--active' : ''}`}
        />
      </div>

      {performanceStep ? (
        <>
          <Modal.Body className="pt-2">
            <p className="pw-run-summary-modal__lead mb-3">Here&apos;s how today&apos;s run stacked up.</p>

            <div className="pw-run-summary-stats pw-run-summary-stats--outcomes mb-3">
              <OutcomeStat label="Tested" value={summary.outcomes.tested} animate={animate} />
              <OutcomeStat label="Annual skips" value={summary.outcomes.skipped_annual} animate={animate} />
              <OutcomeStat
                label="Other skips"
                value={summary.outcomes.skipped_non_annual}
                animate={animate}
              />
            </div>

            <div className="pw-run-summary-stats pw-run-summary-stats--timing mb-2">
              <div className="pw-run-summary-stat">
                <span className="pw-run-summary-stat__label">Field duration</span>
                <span className="pw-run-summary-stat__value tabular-nums">
                  {formatFieldDuration(animatedFieldDuration ?? fieldDurationMinutes)}
                </span>
              </div>
              <div className="pw-run-summary-stat">
                <span className="pw-run-summary-stat__label">Finished at</span>
                <span
                  className={`pw-run-summary-stat__value tabular-nums${
                    comparisonsVisible ? ' pw-run-summary-stat__value--revealed' : ''
                  }`}
                >
                  {summary.field_end_time ?? '—'}
                </span>
              </div>
            </div>

            {comparisonLines.length > 0 ? (
              <div className="pw-run-summary-comparisons mt-3">
                {comparisonLines.map((line, index) => (
                  <ComparisonLine
                    key={line.key}
                    text={line.text}
                    tone={line.tone}
                    visible={comparisonsVisible}
                    delayMs={index * COMPARISON_STAGGER_MS}
                  />
                ))}
              </div>
            ) : !summary.has_sufficient_history ? (
              <p
                className={`pw-run-summary-comparison pw-run-summary-comparison--neutral${
                  comparisonsVisible ? ' pw-run-summary-comparison--revealed' : ''
                }`}
              >
                Not enough past runs on this route to compare yet.
              </p>
            ) : null}
          </Modal.Body>
          <Modal.Footer className="border-0 pt-0">
            <Button variant="success" onClick={goToDebrief} disabled={!comparisonsVisible}>
              Next
            </Button>
          </Modal.Footer>
        </>
      ) : (
        <>
          <Modal.Body className="pt-2">
            <p className="pw-run-summary-modal__lead mb-3">
              Optional debrief for the office — route issues, timing notes, or follow-ups.
            </p>
            {saveError ? (
              <Alert variant="danger" className="py-2 small mb-2">
                {saveError}
              </Alert>
            ) : null}
            <div className="pw-run-summary-debrief">
              <RichTextToolbar editor={richTextEditor} layout="grouped" />
              <RichTextEditor
                value={debriefHtml}
                onChange={setDebriefHtml}
                disabled={saving}
                placeholder={DEBRIEF_PLACEHOLDER}
                className="pw-run-summary-debrief__editor"
                onHandleReady={setRichTextEditor}
              />
            </div>
          </Modal.Body>
          <Modal.Footer className="border-0 pt-0 pw-run-summary-modal__footer-split">
            <Button variant="outline-secondary" onClick={onDismiss} disabled={saving}>
              Skip
            </Button>
            <Button variant="success" onClick={() => void saveDebrief()} disabled={saving}>
              {saving ? 'Saving…' : 'Save debrief'}
            </Button>
          </Modal.Footer>
        </>
      )}
    </Modal>
  )
}
