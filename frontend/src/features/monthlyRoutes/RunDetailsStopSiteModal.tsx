import { useCallback, useEffect, useState } from 'react'
import { Modal, Spinner } from 'react-bootstrap'
import PortalClockEventsCard from './PortalClockEventsCard'
import RunDetailsStopSiteEditableFields from './RunDetailsStopSiteEditableFields'
import RunDetailsStopOutcomeSelect from './RunDetailsStopOutcomeSelect'
import {
  runDetailsHeaderMonitoringDisplay,
  runDetailsHeaderPanelDisplay,
  runDetailsHeaderTimesDisplay,
  runDetailsShowAnnualMonthPill,
  runDetailsSkipReasonDisplay,
  runDetailsStopDisplayStatus,
  runDetailsStopHeaderBandClass,
} from './runDetailsStopSiteDisplay'
import { LocationHeading } from './locationDisplay'
import { useRunDetailsWorksheetStops } from './useRunDetailsWorksheetStops'
import type { RunDetailsStopPatchApi } from './useRunDetailsStopPatch'
import type { TechnicianWorksheetRun, TechnicianWorksheetLocation } from './monthlyRoutesShared'
import { portalOutcomeDisplay, portalStopHasTestOutcome } from './portalWorkflowShared'
import { runDetailsOfficeReviewReadOnly } from './runWorkflowShared'

type Props = {
  show: boolean
  locationId: number | null
  routeId: number
  monthDate: string
  run: TechnicianWorksheetRun | null
  onHide: () => void
  stopPatch: RunDetailsStopPatchApi
  onStopMergedFromWorksheet: (stop: TechnicianWorksheetLocation, scope?: 'full' | 'deficiency') => void
  /** Render as a side panel (no Bootstrap Modal shell). */
  embedded?: boolean
}

export default function RunDetailsStopSiteModal({
  show,
  locationId,
  routeId,
  monthDate,
  run,
  onHide,
  stopPatch,
  onStopMergedFromWorksheet,
  embedded = false,
}: Props) {
  const { ensureStopLoaded, getStop, replaceStop, loading, loadingId, error } =
    useRunDetailsWorksheetStops(routeId, monthDate)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    if (!show || locationId == null) return
    setLoadFailed(false)
    void ensureStopLoaded(locationId, { fresh: true }).catch(() => setLoadFailed(true))
  }, [show, locationId, ensureStopLoaded])

  const stop: TechnicianWorksheetLocation | undefined =
    locationId != null ? getStop(locationId) : undefined
  const readOnly = runDetailsOfficeReviewReadOnly(run)
  const displayStatus = stop ? runDetailsStopDisplayStatus(stop) : 'pending'
  const activeSkipLabel = stop ? runDetailsSkipReasonDisplay(stop) : null
  const activePanelDisplay = stop ? runDetailsHeaderPanelDisplay(stop) : null
  const activeMonitoringDisplay = stop ? runDetailsHeaderMonitoringDisplay(stop) : ''
  const activeHeaderTimes = stop ? runDetailsHeaderTimesDisplay(stop) : null
  const outcomeBanner = stop && portalStopHasTestOutcome(stop) ? portalOutcomeDisplay(stop) : null
  const refreshing = loading && locationId != null && loadingId === locationId && stop != null

  const handleStopPatched = useCallback(
    (updated: TechnicianWorksheetLocation) => {
      replaceStop(updated)
      onStopMergedFromWorksheet(updated)
    },
    [replaceStop, onStopMergedFromWorksheet],
  )

  if (!show) return null

  const body = (
    <div className="run-details-stop-site-modal__body">
      {loading && locationId != null && loadingId === locationId && !stop ? (
        <div className="run-details-stop-site-modal__loading p-4 text-center">
          <Spinner animation="border" size="sm" className="me-2" aria-hidden />
          Loading site details…
        </div>
      ) : loadFailed || error ? (
        <p className="text-danger small p-3 mb-0" role="alert">
          {error || 'Failed to load site details.'}
        </p>
      ) : !stop ? (
        <p className="text-muted small p-3 mb-0">Stop not found on this worksheet.</p>
      ) : (
        <div className="portal-worksheet-mockup run-details-stop-site-modal__portal">
          {refreshing ? (
            <div className="run-details-stop-site-modal__refreshing small text-muted px-3 py-1">
              <Spinner animation="border" size="sm" className="me-1" aria-hidden />
              Refreshing…
            </div>
          ) : null}
          <div className={`pw-mock-header ${runDetailsStopHeaderBandClass(stop, monthDate)}`}>
            <div className="pw-mock-header-top">
              <div className="pw-mock-header-stop">
                Stop #{stop.stop_number}
                {runDetailsShowAnnualMonthPill(stop, monthDate, displayStatus) ? (
                  <span className="pw-mock-annual-pill">Annual month</span>
                ) : null}
              </div>
              <RunDetailsStopOutcomeSelect
                stop={stop}
                run={run}
                routeId={routeId}
                monthDate={monthDate}
                readOnly={readOnly}
                onStopUpdated={handleStopPatched}
              />
            </div>
            <LocationHeading
              stop={stop}
              as="h2"
              primaryClassName="pw-mock-header-address h5 mb-0"
              sublineClassName="pw-mock-header-line text-muted"
            />
            {stop.label ? <div className="pw-mock-header-line">{stop.label}</div> : null}
            <div className="pw-mock-header-line text-muted">{activeMonitoringDisplay}</div>
            {activePanelDisplay ? (
              <div className="pw-mock-header-line fw-semibold">{activePanelDisplay}</div>
            ) : null}
            {activeHeaderTimes ? (
              <div className="pw-mock-header-times">{activeHeaderTimes}</div>
            ) : null}
            {outcomeBanner ? (
              <div className="pw-portal-outcome-banner">Current result: {outcomeBanner}</div>
            ) : null}
            {displayStatus === 'skipped' ? (
              <div className="pw-mock-header-skip">
                {activeSkipLabel ? `Skipped: ${activeSkipLabel}` : 'Skipped'}
              </div>
            ) : null}
          </div>

          <PortalClockEventsCard stop={stop} />
          <RunDetailsStopSiteEditableFields
            stop={stop}
            routeId={routeId}
            monthDate={monthDate}
            runId={run?.id ?? null}
            readOnly={readOnly}
            stopPatch={stopPatch}
            onStopMergedFromWorksheet={handleStopPatched}
          />
        </div>
      )}
    </div>
  )

  if (embedded) {
    return (
      <div className="run-details-tickets-site-pair__panel run-details-tickets-site-pair__panel--site run-details-stop-site-modal__content modal-content">
        <div className="modal-header run-details-stop-site-modal__chrome-header run-details-tickets-site-pair__panel-header">
          <div className="modal-title h6 mb-0">Site on this run</div>
          <button type="button" className="btn-close" aria-label="Close" onClick={onHide} />
        </div>
        {body}
      </div>
    )
  }

  return (
    <Modal
      show={show}
      onHide={onHide}
      centered
      size="xl"
      className="run-details-stop-site-modal"
      dialogClassName="run-details-stop-site-modal__dialog"
      contentClassName="run-details-stop-site-modal__content"
    >
      <Modal.Header closeButton className="run-details-stop-site-modal__chrome-header">
        <Modal.Title className="h6 mb-0">Site on this run</Modal.Title>
      </Modal.Header>
      {body}
    </Modal>
  )
}
