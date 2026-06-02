import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Form } from 'react-bootstrap'
import PortalRecordResultsModal, {
  type RecordResultsCompletePayload,
} from './PortalRecordResultsModal'
import PortalSkipModal from './PortalSkipModal'
import {
  officeClearStopTestOutcome,
  officeSetStopTestOutcome,
  officeVerifyDeficiency,
} from './officeStopSiteApi'
import {
  runDetailsStopDisplayStatus,
  runDetailsStopStatusLabel,
  runDetailsStopStatusPillClass,
} from './runDetailsStopSiteDisplay'
import { portalStatusPillClass } from './portalWorkflowShared'
import { canOfficeEditOutcomes } from './runWorkflowShared'
import type { TechnicianWorksheetRun, TechnicianWorksheetStop } from './monthlyRoutesShared'
import {
  portalStopHasTestOutcome,
  portalStopNeedsDeficiencyVerify,
  portalStopNeedsNoDeficiencyConfirm,
  TEST_OUTCOME_OPTIONS,
  type PortalSkipCategory,
  type PortalTestOutcome,
} from './portalWorkflowShared'

const PENDING_VALUE = '__pending__'

type Props = {
  stop: TechnicianWorksheetStop
  run: TechnicianWorksheetRun | null
  routeId: number
  monthDate: string
  readOnly: boolean
  onStopUpdated: (stop: TechnicianWorksheetStop) => void | Promise<void>
}

function outcomeSelectValue(stop: TechnicianWorksheetStop): string {
  if (portalStopHasTestOutcome(stop)) {
    return (stop.test_outcome || '').trim().toLowerCase()
  }
  return PENDING_VALUE
}

function pillStatusClass(selectValue: string): string {
  if (selectValue === PENDING_VALUE) return 'pending'
  if (selectValue === 'skipped') return 'skipped'
  if (selectValue === 'passed_with_problems') return 'passed-problems'
  if (selectValue === 'failed') return 'failed'
  if (selectValue === 'all_good') return 'tested'
  return 'pending'
}

function formatOutcomeApiError(err: unknown): string {
  if (err && typeof err === 'object') {
    const o = err as { error?: unknown; message?: unknown }
    if (typeof o.error === 'string' && o.error.trim()) return o.error
    if (typeof o.message === 'string' && o.message.trim()) return o.message
  }
  if (typeof err === 'string' && err.trim()) return err
  return 'Could not save test outcome. Try again or refresh the site.'
}

export default function RunDetailsStopOutcomeSelect({
  stop,
  run,
  routeId,
  monthDate,
  readOnly,
  onStopUpdated,
}: Props) {
  const displayStatus = runDetailsStopDisplayStatus(stop)
  const canEdit = !readOnly && canOfficeEditOutcomes(run)
  const [selectValue, setSelectValue] = useState(() => outcomeSelectValue(stop))
  const [saving, setSaving] = useState(false)
  const [skipModalOpen, setSkipModalOpen] = useState(false)
  const [resultsModalOpen, setResultsModalOpen] = useState(false)
  const [pendingOutcome, setPendingOutcome] = useState<PortalTestOutcome | null>(null)
  const [localStop, setLocalStop] = useState(stop)
  const skipRevertRef = useRef<string | null>(null)

  useEffect(() => {
    setSelectValue(outcomeSelectValue(stop))
    setLocalStop(stop)
  }, [stop])

  const pillClass = canEdit ? pillStatusClass(selectValue) : runDetailsStopStatusPillClass(stop, monthDate)
  const pillLabel = useMemo(() => {
    if (selectValue === PENDING_VALUE) return 'Pending'
    const opt = TEST_OUTCOME_OPTIONS.find((o) => o.value === selectValue)
    if (opt) return opt.label
    return runDetailsStopStatusLabel(displayStatus, stop)
  }, [selectValue, displayStatus, stop])

  const applyOutcome = useCallback(
    async (
      outcome: PortalTestOutcome,
      opts?: { skipCategory?: PortalSkipCategory; skipNote?: string; confirmedNoDeficiencies?: boolean },
    ) => {
      setSaving(true)
      try {
        const updated = await officeSetStopTestOutcome(routeId, monthDate, stop.testing_site_id, {
          test_outcome: outcome,
          skip_category: opts?.skipCategory,
          skip_note: opts?.skipNote,
          confirmed_no_deficiencies: opts?.confirmedNoDeficiencies,
        })
        setSelectValue(outcome)
        setLocalStop(updated)
        await onStopUpdated(updated)
      } catch (err) {
        if (skipRevertRef.current != null) {
          setSelectValue(skipRevertRef.current)
          skipRevertRef.current = null
        }
        window.alert(formatOutcomeApiError(err))
        throw err
      } finally {
        setSaving(false)
      }
    },
    [routeId, monthDate, stop.testing_site_id, onStopUpdated],
  )

  const applyClear = useCallback(async () => {
    setSaving(true)
    try {
      const updated = await officeClearStopTestOutcome(routeId, monthDate, stop.testing_site_id)
      setSelectValue(PENDING_VALUE)
      setLocalStop(updated)
      await onStopUpdated(updated)
    } catch (err) {
      setSelectValue(outcomeSelectValue(stop))
      window.alert(formatOutcomeApiError(err))
    } finally {
      setSaving(false)
    }
  }, [routeId, monthDate, stop.testing_site_id, stop, onStopUpdated])

  const handleSelectChange = useCallback(
    (nextRaw: string) => {
      if (!canEdit || saving) return
      const previous = selectValue
      if (nextRaw === previous) return

      if (nextRaw === PENDING_VALUE) {
        setSelectValue(PENDING_VALUE)
        void applyClear().catch(() => setSelectValue(previous))
        return
      }

      const outcome = nextRaw as PortalTestOutcome
      if (outcome === 'skipped') {
        skipRevertRef.current = previous
        setSelectValue(outcome)
        setSkipModalOpen(true)
        return
      }

      if (
        portalStopNeedsDeficiencyVerify(outcome, localStop, run?.id ?? null) ||
        portalStopNeedsNoDeficiencyConfirm(outcome, localStop)
      ) {
        skipRevertRef.current = previous
        setPendingOutcome(outcome)
        setSelectValue(outcome)
        setResultsModalOpen(true)
        return
      }

      setSelectValue(outcome)
      void applyOutcome(outcome).catch(() => setSelectValue(previous))
    },
    [canEdit, saving, selectValue, applyClear, applyOutcome, localStop, run?.id],
  )

  const handleSkipConfirm = useCallback(
    (category: PortalSkipCategory, note: string) => {
      setSkipModalOpen(false)
      skipRevertRef.current = null
      void applyOutcome('skipped', { skipCategory: category, skipNote: note }).catch(() => {
        setSelectValue(outcomeSelectValue(stop))
      })
    },
    [applyOutcome, stop],
  )

  const handleSkipHide = useCallback(() => {
    setSkipModalOpen(false)
    if (skipRevertRef.current != null) {
      setSelectValue(skipRevertRef.current)
      skipRevertRef.current = null
    }
  }, [])

  const handleResultsComplete = useCallback(
    async ({ outcome, confirmedNoDeficiencies }: RecordResultsCompletePayload) => {
      const previous = skipRevertRef.current ?? selectValue
      skipRevertRef.current = null
      setResultsModalOpen(false)
      setPendingOutcome(null)
      try {
        await applyOutcome(outcome, { confirmedNoDeficiencies })
      } catch {
        setSelectValue(previous)
      }
    },
    [applyOutcome, selectValue],
  )

  const handleResultsHide = useCallback(() => {
    setResultsModalOpen(false)
    setPendingOutcome(null)
    if (skipRevertRef.current != null) {
      setSelectValue(skipRevertRef.current)
      skipRevertRef.current = null
    }
  }, [])

  const workflowActions = useMemo(
    () => ({
      verifyDeficiency: async (s: TechnicianWorksheetStop, deficiencyId: number) => {
        try {
          const updated = await officeVerifyDeficiency(
            routeId,
            monthDate,
            s.testing_site_id,
            deficiencyId,
          )
          setLocalStop(updated)
          return { ok: true as const, stop: updated }
        } catch {
          return { ok: false as const }
        }
      },
    }),
    [routeId, monthDate],
  )

  if (!canEdit) {
    return (
      <span className={`pw-mock-status-pill pw-mock-status-pill--${portalStatusPillClass(stop, monthDate)}`}>
        {runDetailsStopStatusLabel(displayStatus, stop)}
      </span>
    )
  }

  return (
    <>
      <label className="pw-mock-status-pill-select-wrap mb-0">
        <span className="visually-hidden">Test outcome for stop #{stop.stop_number}</span>
        <Form.Select
          className={`pw-mock-status-pill-select pw-mock-status-pill-select--${pillClass}`}
          value={selectValue}
          disabled={saving}
          aria-label={`Test outcome: ${pillLabel}`}
          onChange={(e) => handleSelectChange(e.target.value)}
        >
          <option value={PENDING_VALUE}>Pending</option>
          {TEST_OUTCOME_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Form.Select>
      </label>
      <PortalSkipModal
        show={skipModalOpen}
        stopNumber={stop.stop_number}
        onHide={handleSkipHide}
        onConfirm={handleSkipConfirm}
      />
      <PortalRecordResultsModal
        show={resultsModalOpen}
        stop={localStop}
        runId={run?.id ?? null}
        initialOutcome={pendingOutcome}
        workflowActions={workflowActions}
        onHide={handleResultsHide}
        onComplete={handleResultsComplete}
      />
    </>
  )
}
