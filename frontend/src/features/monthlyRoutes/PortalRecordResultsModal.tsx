import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Modal, Spinner } from 'react-bootstrap'
import type { TechnicianWorksheetStop } from './monthlyRoutesShared'
import {
  portalStopCanChooseAllGood,
  portalStopNeedsDeficiencyVerify,
  portalStopNeedsNoDeficiencyConfirm,
  portalStopNewDeficienciesFromPriorRuns,
  TEST_OUTCOME_OPTIONS,
  type PortalDeficiencySummary,
  type PortalTestOutcome,
} from './portalWorkflowShared'

export type RecordResultsCompletePayload = {
  outcome: PortalTestOutcome
  confirmedNoDeficiencies?: boolean
}

type WorkflowActions = {
  verifyDeficiency: (
    stop: TechnicianWorksheetStop,
    deficiencyId: number,
  ) => Promise<{ ok: boolean; stop?: TechnicianWorksheetStop }>
}

type WizardStep = 'choose' | 'verify' | 'confirm_none'

type Props = {
  show: boolean
  stop: TechnicianWorksheetStop
  runId?: number | null
  title?: string
  workflowActions: WorkflowActions
  onHide: () => void
  onComplete: (payload: RecordResultsCompletePayload) => Promise<void>
}

function severityLabel(severity: string): string {
  const s = severity.toLowerCase()
  if (s === 'inoperable') return 'Inoperable'
  if (s === 'deficient') return 'Deficient'
  if (s === 'suggested') return 'Suggested'
  return severity
}

export default function PortalRecordResultsModal({
  show,
  stop,
  runId = null,
  title,
  workflowActions,
  onHide,
  onComplete,
}: Props) {
  const [step, setStep] = useState<WizardStep>('choose')
  const [pendingOutcome, setPendingOutcome] = useState<PortalTestOutcome | null>(null)
  const [localStop, setLocalStop] = useState(stop)
  const [verifyBusyId, setVerifyBusyId] = useState<number | null>(null)
  const wasOpenRef = useRef(false)

  useEffect(() => {
    if (show && !wasOpenRef.current) {
      setStep('choose')
      setPendingOutcome(null)
      setLocalStop(stop)
      setVerifyBusyId(null)
    }
    wasOpenRef.current = show
  }, [show, stop.testing_site_id, stop])

  useEffect(() => {
    if (!show) return
    setLocalStop(stop)
  }, [show, stop])

  const newDeficienciesToVerify = useMemo(
    () => portalStopNewDeficienciesFromPriorRuns(localStop, runId),
    [localStop, runId],
  )
  const canAllGood = portalStopCanChooseAllGood(localStop)
  const outcomeOptions = TEST_OUTCOME_OPTIONS.filter((o) => o.value !== 'skipped')

  const handlePickOutcome = useCallback(
    (outcome: PortalTestOutcome) => {
      if (outcome === 'all_good' && !portalStopCanChooseAllGood(localStop)) return
      setPendingOutcome(outcome)
      if (portalStopNeedsDeficiencyVerify(outcome, localStop, runId)) {
        setStep('verify')
        return
      }
      if (portalStopNeedsNoDeficiencyConfirm(outcome, localStop)) {
        setStep('confirm_none')
        return
      }
      void onComplete({ outcome }).catch(() => {
        setStep('choose')
      })
    },
    [localStop, onComplete, onHide, runId],
  )

  const handleVerify = useCallback(
    async (def: PortalDeficiencySummary) => {
      setVerifyBusyId(def.id)
      try {
        const res = await workflowActions.verifyDeficiency(localStop, def.id)
        if (res.stop) setLocalStop(res.stop)
      } finally {
        setVerifyBusyId(null)
      }
    },
    [localStop, workflowActions],
  )

  const handleVerifyContinue = useCallback(() => {
    if (!pendingOutcome || portalStopNewDeficienciesFromPriorRuns(localStop, runId).length > 0) return
    if (portalStopNeedsNoDeficiencyConfirm(pendingOutcome, localStop)) {
      setStep('confirm_none')
      return
    }
    void onComplete({ outcome: pendingOutcome }).catch(() => {
      setStep('verify')
    })
  }, [localStop, onComplete, onHide, pendingOutcome, runId])

  const handleConfirmNone = useCallback(() => {
    if (pendingOutcome !== 'passed_with_problems') return
    void onComplete({ outcome: pendingOutcome, confirmedNoDeficiencies: true }).catch(() => {
      setStep('confirm_none')
    })
  }, [onComplete, onHide, pendingOutcome])

  const modalTitle =
    step === 'verify'
      ? `Verify deficiencies — stop #${localStop.stop_number}`
      : step === 'confirm_none'
        ? `Confirm — stop #${localStop.stop_number}`
        : title ?? `Record results — stop #${localStop.stop_number}`

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton>
        <Modal.Title>{modalTitle}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {step === 'choose' ? (
          <>
            {localStop.is_legacy_outcome ? (
              <p className="small text-muted mb-3">
                This stop has a legacy outcome on file. Choose a new result to continue with the
                updated workflow.
              </p>
            ) : null}
            {!canAllGood ? (
              <Alert variant="warning" className="small py-2">
                All good is unavailable while New or Verified deficiencies are on this stop. Verify
                or update deficiencies first, or choose Passed with problems / Failed.
              </Alert>
            ) : null}
            <div className="d-grid gap-2">
              {outcomeOptions.map((opt) => {
                const disabled = opt.value === 'all_good' && !canAllGood
                return (
                  <Button
                    key={opt.value}
                    variant={
                      opt.variant === 'success'
                        ? 'success'
                        : opt.variant === 'warning'
                          ? 'warning'
                          : opt.variant === 'danger'
                            ? 'danger'
                            : 'secondary'
                    }
                    className="pw-portal-outcome-btn"
                    disabled={disabled}
                    onClick={() => handlePickOutcome(opt.value)}
                  >
                    {opt.label}
                  </Button>
                )
              })}
            </div>
          </>
        ) : null}

        {step === 'verify' ? (
          <>
            <p className="small text-muted mb-3">
              Verify each pre-existing New deficiency before continuing. Deficiencies you logged
              this run do not need verification here.
            </p>
            <ul className="list-unstyled mb-0 pw-portal-def-list">
              {newDeficienciesToVerify.map((def) => (
                <li key={def.id} className="pw-portal-def-item d-flex justify-content-between gap-2">
                  <div>
                    <div className="fw-semibold">{def.title}</div>
                    <div className="small text-muted">{severityLabel(def.severity)}</div>
                  </div>
                  <Button
                    variant="outline-success"
                    size="sm"
                    disabled={verifyBusyId != null}
                    onClick={() => void handleVerify(def)}
                  >
                    {verifyBusyId === def.id ? (
                      <Spinner size="sm" animation="border" />
                    ) : (
                      'Verify'
                    )}
                  </Button>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {step === 'confirm_none' ? (
          <p className="mb-0">
            No deficiencies are recorded for this visit (New or Verified). Confirm Passed with
            problems with zero deficiencies?
          </p>
        ) : null}

      </Modal.Body>
      <Modal.Footer>
        {step === 'choose' ? (
          <Button variant="secondary" onClick={onHide}>
            Cancel
          </Button>
        ) : null}
        {step === 'verify' ? (
          <>
            <Button variant="secondary" onClick={() => setStep('choose')}>
              Back
            </Button>
            <Button
              variant="primary"
              disabled={newDeficienciesToVerify.length > 0 || verifyBusyId != null}
              onClick={handleVerifyContinue}
            >
              Continue
            </Button>
          </>
        ) : null}
        {step === 'confirm_none' ? (
          <>
            <Button variant="secondary" onClick={() => setStep('choose')}>
              Cancel
            </Button>
            <Button variant="warning" onClick={handleConfirmNone}>
              Confirm
            </Button>
          </>
        ) : null}
      </Modal.Footer>
    </Modal>
  )
}
