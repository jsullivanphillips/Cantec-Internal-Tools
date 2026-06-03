/**
 * Preflight checks before technicians end a field run on the portal worksheet.
 */

import { isAnnualForMonth, worksheetStopIsOpenClockIn, type TechnicianWorksheetStop } from './monthlyRoutesShared'
import { projectStopsWithWorkflowQueue } from './portalRouteProjection'
import { portalStopHasTestOutcome } from './portalWorkflowShared'
import type { PortalWorkflowQueueItem } from './worksheetOfflineStore'

export function projectedOpenClockStops(
  stops: TechnicianWorksheetStop[],
  routeId: number,
  monthIso: string,
  queue?: PortalWorkflowQueueItem[],
): TechnicianWorksheetStop[] {
  const projected = projectStopsWithWorkflowQueue(stops, routeId, monthIso, queue)
  return projected.filter(worksheetStopIsOpenClockIn)
}

/** Non-annual stops on the run that have no portal ``test_outcome`` yet. */
export function stopsMissingTestOutcome(
  stops: TechnicianWorksheetStop[],
  runMonthIso: string,
): TechnicianWorksheetStop[] {
  return stops.filter((stop) => {
    if (portalStopHasTestOutcome(stop)) return false
    if (isAnnualForMonth(stop.annual_month, runMonthIso)) return false
    return true
  })
}

export type PortalEndRunModalState =
  | { kind: 'open_clock'; stops: TechnicianWorksheetStop[] }
  | { kind: 'untested'; stops: TechnicianWorksheetStop[] }

export function evaluatePortalEndRunPreflight(
  projectedStops: TechnicianWorksheetStop[],
  runMonthIso: string,
): PortalEndRunModalState | null {
  const openClocks = projectedStops.filter(worksheetStopIsOpenClockIn)
  if (openClocks.length > 0) {
    return { kind: 'open_clock', stops: openClocks }
  }
  const untested = stopsMissingTestOutcome(projectedStops, runMonthIso)
  if (untested.length > 0) {
    return { kind: 'untested', stops: untested }
  }
  return null
}
