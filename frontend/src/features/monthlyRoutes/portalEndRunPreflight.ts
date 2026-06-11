/**
 * Preflight checks before technicians end a field run on the portal worksheet.
 */

import { isAnnualForMonth, worksheetLocationIsOpenClockIn, type TechnicianWorksheetLocation } from './monthlyRoutesShared'
import { projectStopsWithWorkflowQueue } from './portalRouteProjection'
import { portalStopHasTestOutcome } from './portalWorkflowShared'
import type { PortalWorkflowQueueItem } from './worksheetOfflineStore'

export function projectedOpenClockStops(
  stops: TechnicianWorksheetLocation[],
  routeId: number,
  monthIso: string,
  queue?: PortalWorkflowQueueItem[],
): TechnicianWorksheetLocation[] {
  const projected = projectStopsWithWorkflowQueue(stops, routeId, monthIso, queue)
  return projected.filter(worksheetLocationIsOpenClockIn)
}

/** Non-annual stops on the run that have no portal ``test_outcome`` yet. */
export function stopsMissingTestOutcome(
  stops: TechnicianWorksheetLocation[],
  runMonthIso: string,
): TechnicianWorksheetLocation[] {
  return stops.filter((stop) => {
    if (portalStopHasTestOutcome(stop)) return false
    if (isAnnualForMonth(stop.annual_month, runMonthIso)) return false
    return true
  })
}

export type PortalEndRunModalState =
  | { kind: 'open_clock'; stops: TechnicianWorksheetLocation[] }
  | { kind: 'untested'; stops: TechnicianWorksheetLocation[] }

export function evaluatePortalEndRunPreflight(
  projectedStops: TechnicianWorksheetLocation[],
  runMonthIso: string,
): PortalEndRunModalState | null {
  const openClocks = projectedStops.filter(worksheetLocationIsOpenClockIn)
  if (openClocks.length > 0) {
    return { kind: 'open_clock', stops: openClocks }
  }
  const untested = stopsMissingTestOutcome(projectedStops, runMonthIso)
  if (untested.length > 0) {
    return { kind: 'untested', stops: untested }
  }
  return null
}
