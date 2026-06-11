import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Modal, Spinner } from 'react-bootstrap'
import type { TechnicianWorksheetLocation } from './monthlyRoutesShared'
import { locationPrimaryLabel } from './locationDisplay'
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
    stop: TechnicianWorksheetLocation,
    deficiencyId: number,
  ) => Promise<{ ok: boolean; stop?: TechnicianWorksheetLocation }>
}

type WizardStep = 'choose' | 'verify' | 'confirm_none'

type Props = {
  show: boolean
  stop: TechnicianWorksheetLocation
  runId?: number | null
  /** When true, completing the modal also clocks out (opened from Clock out). */
  recordAndClockOut?: boolean
  /** When set, open directly on verify / confirm steps (office outcome dropdown). */
  initialOutcome?: PortalTestOutcome | null
  workflowActions: WorkflowActions
  onHide: () => void
  onComplete: (payload: RecordResultsCompletePayload) => Promise<void>
}

const CHOOSE_OUTCOMES = TEST_OUTCOME_OPTIONS.filter((o) => o.value !== 'skipped')

const OUTCOME_META: Record<
  Exclude<PortalTestOutcome, 'skipped'>,
  { icon: string; description: string; tone: 'success' | 'warning' | 'danger' }
> = {
  all_good: {
    icon: 'bi-check-lg',
    description: 'No deficiencies. All tests passed.',
    tone: 'success',
  },
  passed_with_problems: {
    icon: 'bi-exclamation-triangle',
    description: 'Tests passed, but deficiencies were noted.',
    tone: 'warning',
  },
  failed: {
    icon: 'bi-x-lg',
    description: 'System failed testing requirements.',
    tone: 'danger',
  },
}

function severityLabel(severity: string): string {
  const s = severity.toLowerCase()
  if (s === 'inoperable') return 'Inoperable'
  if (s === 'deficient') return 'Deficient'
  if (s === 'suggested') return 'Suggested'
  return severity
}

function severityTone(severity: string): string {
  const s = severity.toLowerCase()
  if (s === 'inoperable') return 'inoperable'
  if (s === 'deficient') return 'deficient'
  if (s === 'suggested') return 'suggested'
  return 'default'
}

function stopAddressLabel(stop: TechnicianWorksheetLocation): string {
  return locationPrimaryLabel(stop) || `Stop #${stop.stop_number}`
}

function modalHeading(recordAndClockOut: boolean): string {
  return recordAndClockOut ? 'Record result and clock out' : 'Record result'
}

export default function PortalRecordResultsModal({
  show,
  stop,
  runId = null,
  recordAndClockOut = false,
  initialOutcome = null,
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
      setLocalStop(stop)
      setVerifyBusyId(null)
      if (initialOutcome) {
        setPendingOutcome(initialOutcome)
        if (portalStopNeedsDeficiencyVerify(initialOutcome, stop, runId)) {
          setStep('verify')
        } else if (portalStopNeedsNoDeficiencyConfirm(initialOutcome, stop)) {
          setStep('confirm_none')
        } else {
          setStep('choose')
        }
      } else {
        setStep('choose')
        setPendingOutcome(null)
      }
    }
    wasOpenRef.current = show
  }, [show, stop.location_id, stop, initialOutcome, runId])

  useEffect(() => {
    if (!show) return
    setLocalStop(stop)
  }, [show, stop])

  const newDeficienciesToVerify = useMemo(
    () => portalStopNewDeficienciesFromPriorRuns(localStop, runId),
    [localStop, runId],
  )
  const canAllGood = portalStopCanChooseAllGood(localStop)
  const verifyRemaining = newDeficienciesToVerify.length
  const [verifyBaseline, setVerifyBaseline] = useState(0)

  useEffect(() => {
    if (!show) {
      setVerifyBaseline(0)
      return
    }
    if (step === 'verify' && verifyRemaining > verifyBaseline) {
      setVerifyBaseline(verifyRemaining)
    }
    if (step === 'choose') {
      setVerifyBaseline(0)
    }
  }, [show, step, verifyRemaining, verifyBaseline])

  const verifyTotal = verifyBaseline || verifyRemaining
  const verifyCompleted = Math.max(0, verifyTotal - verifyRemaining)

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
    [localStop, onComplete, runId],
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
  }, [localStop, onComplete, pendingOutcome, runId])

  const handleConfirmNone = useCallback(() => {
    if (pendingOutcome !== 'passed_with_problems') return
    void onComplete({ outcome: pendingOutcome, confirmedNoDeficiencies: true }).catch(() => {
      setStep('confirm_none')
    })
  }, [onComplete, pendingOutcome])

  const heading = modalHeading(recordAndClockOut)
  const contextLabel = stopAddressLabel(localStop)
  const pendingMeta =
    pendingOutcome && pendingOutcome !== 'skipped' ? OUTCOME_META[pendingOutcome] : null

  return (
    <Modal
      show={show}
      onHide={onHide}
      centered
      className="pw-record-results-modal"
      contentClassName="pw-record-results-modal__content"
      dialogClassName="pw-record-results-modal__dialog"
    >
      <div className="pw-record-results-modal__header">
        <div className="pw-record-results-modal__header-text">
          <h2 className="pw-record-results-modal__title">{heading}</h2>
          <p className="pw-record-results-modal__context">{contextLabel}</p>
        </div>
        <button
          type="button"
          className="pw-record-results-modal__close btn btn-link"
          aria-label="Close"
          onClick={onHide}
        >
          <i className="bi bi-x-lg" aria-hidden />
        </button>
      </div>

      {step !== 'choose' ? (
        <div className="pw-record-results-modal__stepper" aria-label="Workflow progress">
          <div className="pw-record-results-modal__step pw-record-results-modal__step--done">
            <span className="pw-record-results-modal__step-marker">
              <i className="bi bi-check-lg" aria-hidden />
            </span>
            <span className="pw-record-results-modal__step-label">Select result</span>
          </div>
          <div
            className={`pw-record-results-modal__step${step === 'verify' ? ' pw-record-results-modal__step--active' : verifyRemaining === 0 && step === 'confirm_none' ? ' pw-record-results-modal__step--done' : ''}`}
          >
            <span className="pw-record-results-modal__step-marker">
              {step !== 'verify' && verifyRemaining === 0 && step === 'confirm_none' ? (
                <i className="bi bi-check-lg" aria-hidden />
              ) : (
                '2'
              )}
            </span>
            <span className="pw-record-results-modal__step-label">Verify</span>
          </div>
          <div
            className={`pw-record-results-modal__step${step === 'confirm_none' ? ' pw-record-results-modal__step--active' : ''}`}
          >
            <span className="pw-record-results-modal__step-marker">3</span>
            <span className="pw-record-results-modal__step-label">Confirm</span>
          </div>
        </div>
      ) : null}

      <Modal.Body className="pw-record-results-modal__body">
        {step === 'choose' ? (
          <>
            {localStop.is_legacy_outcome ? (
              <div className="pw-record-results-modal__callout pw-record-results-modal__callout--info">
                <i className="bi bi-info-circle" aria-hidden />
                <div>
                  This stop has a legacy outcome on file. Choose a new result to continue with the
                  updated workflow.
                </div>
              </div>
            ) : null}

            {!canAllGood ? (
              <div className="pw-record-results-modal__callout pw-record-results-modal__callout--warning">
                <i className="bi bi-exclamation-triangle" aria-hidden />
                <div>
                  <strong>All good is unavailable</strong> while New or Verified deficiencies are on
                  this stop. Verify or update deficiencies first, or choose Passed with problems /
                  Failed.
                </div>
              </div>
            ) : null}

            <div className="pw-record-results-modal__outcomes" role="list">
              {CHOOSE_OUTCOMES.map((opt) => {
                const meta = OUTCOME_META[opt.value as Exclude<PortalTestOutcome, 'skipped'>]
                const disabled = opt.value === 'all_good' && !canAllGood
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="listitem"
                    className={`pw-record-results-modal__outcome pw-record-results-modal__outcome--${meta.tone}${disabled ? ' pw-record-results-modal__outcome--disabled' : ''}`}
                    disabled={disabled}
                    onClick={() => handlePickOutcome(opt.value)}
                  >
                    <span
                      className={`pw-record-results-modal__outcome-icon pw-record-results-modal__outcome-icon--${meta.tone}`}
                      aria-hidden
                    >
                      <i className={`bi ${meta.icon}`} />
                    </span>
                    <span className="pw-record-results-modal__outcome-copy">
                      <span className="pw-record-results-modal__outcome-label">{opt.label}</span>
                      <span className="pw-record-results-modal__outcome-desc">{meta.description}</span>
                    </span>
                    <i className="bi bi-chevron-right pw-record-results-modal__outcome-chevron" aria-hidden />
                  </button>
                )
              })}
            </div>
          </>
        ) : null}

        {step === 'verify' ? (
          <>
            <p className="pw-record-results-modal__lead">
              Verify each pre-existing New deficiency before continuing. Deficiencies you logged this
              run do not need verification here.
            </p>

            {pendingMeta ? (
              <div
                className={`pw-record-results-modal__pending-badge pw-record-results-modal__pending-badge--${pendingMeta.tone}`}
              >
                <i className={`bi ${pendingMeta.icon}`} aria-hidden />
                <span>
                  Selected:{' '}
                  {CHOOSE_OUTCOMES.find((o) => o.value === pendingOutcome)?.label ?? pendingOutcome}
                </span>
              </div>
            ) : null}

            {verifyTotal > 0 ? (
              <div className="pw-record-results-modal__verify-progress">
                <span className="pw-record-results-modal__verify-count">
                  {verifyRemaining > 0 ? `${verifyRemaining} remaining` : 'All verified'}
                </span>
                <div
                  className="pw-record-results-modal__verify-bar"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={verifyTotal}
                  aria-valuenow={verifyCompleted}
                  aria-label="Deficiencies verified"
                >
                  <div
                    className="pw-record-results-modal__verify-bar-fill"
                    style={{
                      width: `${verifyTotal === 0 ? 100 : (verifyCompleted / verifyTotal) * 100}%`,
                    }}
                  />
                </div>
              </div>
            ) : null}

            <ul className="pw-record-results-modal__def-list">
              {newDeficienciesToVerify.map((def) => (
                <li key={def.id} className="pw-record-results-modal__def-item">
                  <div className="pw-record-results-modal__def-copy">
                    <div className="pw-record-results-modal__def-title">{def.title}</div>
                    <span
                      className={`pw-record-results-modal__severity pw-record-results-modal__severity--${severityTone(def.severity)}`}
                    >
                      {severityLabel(def.severity)}
                    </span>
                  </div>
                  <Button
                    variant="outline-success"
                    size="sm"
                    className="pw-record-results-modal__verify-btn"
                    disabled={verifyBusyId != null}
                    onClick={() => void handleVerify(def)}
                  >
                    {verifyBusyId === def.id ? (
                      <Spinner size="sm" animation="border" />
                    ) : (
                      <>
                        <i className="bi bi-check-lg" aria-hidden />
                        Verify
                      </>
                    )}
                  </Button>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {step === 'confirm_none' ? (
          <>
            {pendingMeta ? (
              <div
                className={`pw-record-results-modal__pending-badge pw-record-results-modal__pending-badge--${pendingMeta.tone}`}
              >
                <i className={`bi ${pendingMeta.icon}`} aria-hidden />
                <span>
                  Selected:{' '}
                  {CHOOSE_OUTCOMES.find((o) => o.value === pendingOutcome)?.label ?? pendingOutcome}
                </span>
              </div>
            ) : null}

            <div className="pw-record-results-modal__confirm-panel">
              <div className="pw-record-results-modal__confirm-icon" aria-hidden>
                <i className="bi bi-question-circle" />
              </div>
              <div>
                <h3 className="pw-record-results-modal__confirm-title">Confirm zero deficiencies</h3>
                <p className="pw-record-results-modal__confirm-text">
                  No deficiencies are recorded for this visit (New or Verified). Confirm Passed with
                  problems with zero deficiencies?
                </p>
              </div>
            </div>
          </>
        ) : null}
      </Modal.Body>

      <Modal.Footer className="pw-record-results-modal__footer">
        {step === 'choose' ? (
          <Button variant="outline-secondary" className="pw-record-results-modal__footer-btn" onClick={onHide}>
            Cancel
          </Button>
        ) : null}
        {step === 'verify' ? (
          <>
            <Button
              variant="outline-secondary"
              className="pw-record-results-modal__footer-btn"
              onClick={() => setStep('choose')}
            >
              Back
            </Button>
            <Button
              variant="primary"
              className="pw-record-results-modal__footer-btn"
              disabled={newDeficienciesToVerify.length > 0 || verifyBusyId != null}
              onClick={handleVerifyContinue}
            >
              Continue
            </Button>
          </>
        ) : null}
        {step === 'confirm_none' ? (
          <>
            <Button
              variant="outline-secondary"
              className="pw-record-results-modal__footer-btn"
              onClick={() => setStep('choose')}
            >
              Back
            </Button>
            <Button
              variant="warning"
              className="pw-record-results-modal__footer-btn pw-record-results-modal__footer-btn--confirm"
              onClick={handleConfirmNone}
            >
              Confirm outcome
            </Button>
          </>
        ) : null}
      </Modal.Footer>
    </Modal>
  )
}
