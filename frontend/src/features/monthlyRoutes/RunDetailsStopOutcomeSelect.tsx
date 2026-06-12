import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button, Form, Overlay } from 'react-bootstrap'

import RunReviewOutcomeLabel from './RunReviewOutcomeLabel'

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

import type { TechnicianWorksheetRun, TechnicianWorksheetLocation } from './monthlyRoutesShared'

import {

  OFFICE_OUTCOME_ON_HOLD_LABEL,

  OFFICE_OUTCOME_ON_HOLD_VALUE,

  OFFICE_OUTCOME_PENDING_VALUE,

  OFFICE_OUTCOME_SKIPPED_ANNUAL_LABEL,

  OFFICE_OUTCOME_SKIPPED_ANNUAL_VALUE,

  officeOutcomeSelectValue,

  portalStopNeedsDeficiencyVerify,

  portalStopNeedsNoDeficiencyConfirm,

  TEST_OUTCOME_OPTIONS,

  type PortalSkipCategory,

  type PortalTestOutcome,

} from './portalWorkflowShared'



export type RunDetailsReviewOutcomeDisplay = {

  headline: string | null

  outcomeVariant: 'review-pill' | 'soft'

}



const REVIEW_OUTCOME_MENU_OPTIONS: { value: string; label: string }[] = [

  { value: OFFICE_OUTCOME_PENDING_VALUE, label: 'Pending' },

  ...TEST_OUTCOME_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label })),

  { value: OFFICE_OUTCOME_SKIPPED_ANNUAL_VALUE, label: OFFICE_OUTCOME_SKIPPED_ANNUAL_LABEL },

]

const REVIEW_OUTCOME_MENU_POPPER_CONFIG = {

  strategy: 'fixed' as const,

  modifiers: [{ name: 'preventOverflow', options: { boundary: 'viewport' as const } }],

}



type Props = {

  stop: TechnicianWorksheetLocation

  run: TechnicianWorksheetRun | null

  routeId: number

  monthDate: string

  readOnly: boolean

  onStopUpdated: (stop: TechnicianWorksheetLocation) => void | Promise<void>

  /** Run review table: result text + pencil menu (dropdown anchored to pencil). */

  layout?: 'select' | 'review'

  reviewDisplay?: RunDetailsReviewOutcomeDisplay

}



function pillStatusClass(selectValue: string): string {

  if (selectValue === OFFICE_OUTCOME_PENDING_VALUE) return 'pending'

  if (selectValue === OFFICE_OUTCOME_SKIPPED_ANNUAL_VALUE) return 'annual'

  if (selectValue === OFFICE_OUTCOME_ON_HOLD_VALUE) return 'annual'

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

  layout = 'select',

  reviewDisplay,

}: Props) {

  const displayStatus = runDetailsStopDisplayStatus(stop)

  const canEdit = !readOnly && canOfficeEditOutcomes(run)

  const reviewLayout = layout === 'review' && reviewDisplay != null

  const [selectValue, setSelectValue] = useState(() => officeOutcomeSelectValue(stop))

  const [menuOpen, setMenuOpen] = useState(false)

  const [saving, setSaving] = useState(false)

  const [skipModalOpen, setSkipModalOpen] = useState(false)

  const [resultsModalOpen, setResultsModalOpen] = useState(false)

  const [pendingOutcome, setPendingOutcome] = useState<PortalTestOutcome | null>(null)

  const [localStop, setLocalStop] = useState(stop)

  const skipRevertRef = useRef<string | null>(null)

  const reviewEditBtnRef = useRef<HTMLButtonElement>(null)



  useEffect(() => {

    setSelectValue(officeOutcomeSelectValue(stop))

    setLocalStop(stop)

    setMenuOpen(false)

  }, [stop])



  const pillClass = canEdit ? pillStatusClass(selectValue) : runDetailsStopStatusPillClass(stop, monthDate)

  const pillLabel = useMemo(() => {

    if (selectValue === OFFICE_OUTCOME_PENDING_VALUE) return 'Pending'

    if (selectValue === OFFICE_OUTCOME_SKIPPED_ANNUAL_VALUE) return OFFICE_OUTCOME_SKIPPED_ANNUAL_LABEL

    if (selectValue === OFFICE_OUTCOME_ON_HOLD_VALUE) return OFFICE_OUTCOME_ON_HOLD_LABEL

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

        const updated = await officeSetStopTestOutcome(routeId, monthDate, stop.location_id, {

          test_outcome: outcome,

          skip_category: opts?.skipCategory,

          skip_note: opts?.skipNote,

          confirmed_no_deficiencies: opts?.confirmedNoDeficiencies,

        })

        setSelectValue(

          outcome === 'skipped' && opts?.skipCategory === 'annual'

            ? OFFICE_OUTCOME_SKIPPED_ANNUAL_VALUE

            : outcome,

        )

        setLocalStop(updated)

        await onStopUpdated(updated)

        setMenuOpen(false)

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

    [routeId, monthDate, stop.location_id, onStopUpdated],

  )



  const applyClear = useCallback(async () => {

    setSaving(true)

    try {

      const updated = await officeClearStopTestOutcome(routeId, monthDate, stop.location_id)

      setSelectValue(OFFICE_OUTCOME_PENDING_VALUE)

      setLocalStop(updated)

      await onStopUpdated(updated)

      setMenuOpen(false)

    } catch (err) {

      setSelectValue(officeOutcomeSelectValue(stop))

      window.alert(formatOutcomeApiError(err))

    } finally {

      setSaving(false)

    }

  }, [routeId, monthDate, stop.location_id, stop, onStopUpdated])



  const handleSelectChange = useCallback(

    (nextRaw: string) => {

      if (!canEdit || saving) return

      const previous = selectValue

      if (nextRaw === previous) return



      if (nextRaw === OFFICE_OUTCOME_PENDING_VALUE) {

        setSelectValue(OFFICE_OUTCOME_PENDING_VALUE)

        void applyClear().catch(() => setSelectValue(previous))

        return

      }



      if (nextRaw === OFFICE_OUTCOME_SKIPPED_ANNUAL_VALUE) {

        setSelectValue(OFFICE_OUTCOME_SKIPPED_ANNUAL_VALUE)

        void applyOutcome('skipped', { skipCategory: 'annual' }).catch(() => setSelectValue(previous))

        return

      }



      const outcome = nextRaw as PortalTestOutcome

      if (outcome === 'skipped') {

        skipRevertRef.current = previous

        setSelectValue(outcome)

        setMenuOpen(false)

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

        setMenuOpen(false)

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

        setSelectValue(officeOutcomeSelectValue(stop))

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

      verifyDeficiency: async (s: TechnicianWorksheetLocation, deficiencyId: number) => {

        try {

          const updated = await officeVerifyDeficiency(

            routeId,

            monthDate,

            s.location_id,

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



  const modals = (

    <>

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



  if (!canEdit) {

    return (

      <span className={`pw-mock-status-pill pw-mock-status-pill--${portalStatusPillClass(stop, monthDate)}`}>

        {runDetailsStopStatusLabel(displayStatus, stop)}

      </span>

    )

  }



  if (reviewLayout) {

    const { headline, outcomeVariant } = reviewDisplay

    return (

      <>

        <div className="run-details-review-location-result__outcome-row">

          <div className="run-details-review-location-result__outcome">

            {headline ? (

              <RunReviewOutcomeLabel

                stop={stop}

                monthDate={monthDate}

                headline={headline}

                badgeClass=""

                variant={outcomeVariant}

                className="run-details-review-location-result__outcome-label"

              />

            ) : (

              <span className="run-details-review-location-result__outcome-pending text-muted small">

                Pending

              </span>

            )}

          </div>

          <Button

            ref={reviewEditBtnRef}

            variant="outline-secondary"

            size="sm"

            className="run-details-review-location-result__outcome-edit-btn"

            disabled={saving}

            aria-expanded={menuOpen}

            aria-haspopup="menu"

            aria-label={`Change test outcome for stop ${stop.stop_number}`}

            onClick={() => {

              if (!saving) setMenuOpen((open) => !open)

            }}

          >

            <i className="bi bi-pencil" aria-hidden />

          </Button>

          <Overlay

            show={menuOpen}

            target={reviewEditBtnRef}

            container={typeof document !== 'undefined' ? document.body : undefined}

            placement="bottom-end"

            rootClose

            flip

            offset={[0, 4]}

            transition={false}

            popperConfig={REVIEW_OUTCOME_MENU_POPPER_CONFIG}

            onHide={() => setMenuOpen(false)}

          >

            {({ style, ...overlayProps }) => (

              <div

                {...overlayProps}

                style={style}

                className="dropdown-menu show run-details-review-outcome-menu"

                role="menu"

              >

                {REVIEW_OUTCOME_MENU_OPTIONS.map((opt) => (

                  <button

                    key={opt.value}

                    type="button"

                    role="menuitem"

                    className={`dropdown-item${selectValue === opt.value ? ' active' : ''}`}

                    disabled={saving}

                    onClick={() => {

                      if (selectValue === opt.value) {

                        setMenuOpen(false)

                        return

                      }

                      handleSelectChange(opt.value)

                    }}

                  >

                    {opt.label}

                  </button>

                ))}

              </div>

            )}

          </Overlay>

        </div>

        {modals}

      </>

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

          <option value={OFFICE_OUTCOME_PENDING_VALUE}>Pending</option>

          {TEST_OUTCOME_OPTIONS.map((opt) => (

            <option key={opt.value} value={opt.value}>

              {opt.label}

            </option>

          ))}

          <option value={OFFICE_OUTCOME_SKIPPED_ANNUAL_VALUE}>{OFFICE_OUTCOME_SKIPPED_ANNUAL_LABEL}</option>

        </Form.Select>

      </label>

      {modals}

    </>

  )

}


