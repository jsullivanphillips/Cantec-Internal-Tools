import { useEffect } from 'react'
import LocationTicketsModal from './LocationTicketsModal'
import RunDetailsStopSiteModal from './RunDetailsStopSiteModal'
import type { RunDetailsStopPatchApi } from './useRunDetailsStopPatch'
import type { TechnicianWorksheetRun, TechnicianWorksheetLocation } from './monthlyRoutesShared'

type Props = {
  show: boolean
  locationId: number
  locationLabel: string
  routeId: number
  monthDate: string
  run: TechnicianWorksheetRun | null
  onHide: () => void
  stopPatch: RunDetailsStopPatchApi
  onStopMergedFromWorksheet: (stop: TechnicianWorksheetLocation, scope?: 'full' | 'deficiency') => void
  onTicketsChanged?: () => void
}

export default function RunDetailsTicketsSiteModalPair({
  show,
  locationId,
  locationLabel,
  routeId,
  monthDate,
  run,
  onHide,
  stopPatch,
  onStopMergedFromWorksheet,
  onTicketsChanged,
}: Props) {
  useEffect(() => {
    if (!show) return undefined
    document.body.classList.add('modal-open')
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onHide()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.classList.remove('modal-open')
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [show, onHide])

  if (!show) return null

  return (
    <>
      <div className="run-details-tickets-site-pair__backdrop" onClick={onHide} aria-hidden />
      <div className="run-details-tickets-site-pair" role="dialog" aria-modal="true">
        <LocationTicketsModal
          embedded
          show
          routeId={routeId}
          locationId={locationId}
          locationLabel={locationLabel}
          monthDate={monthDate}
          onHide={onHide}
          onTicketsChanged={onTicketsChanged}
        />
        <RunDetailsStopSiteModal
          embedded
          show
          locationId={locationId}
          routeId={routeId}
          monthDate={monthDate}
          run={run}
          onHide={onHide}
          stopPatch={stopPatch}
          onStopMergedFromWorksheet={onStopMergedFromWorksheet}
        />
      </div>
    </>
  )
}
