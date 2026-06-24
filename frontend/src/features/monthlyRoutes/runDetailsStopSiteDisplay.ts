import {
  worksheetLocationIsOpenClockIn,
  worksheetLocationSkipIsAnnual,
  type TechnicianWorksheetLocation,
} from './monthlyRoutesShared'
import { stopScheduledAnnualAutoSkipActive } from './prepAnnualSchedule'
import {
  portalHeaderBandClass,
  portalOutcomeDisplay,
  portalSkipReasonDetail,
  portalStatusPillClass,
  portalStopHasTestOutcome,
  portalStopVisualTone,
} from './portalWorkflowShared'
import { stopMonitoringSummaryLabel } from './stopMonitoringDisplay'

export type RunDetailsStopDisplayStatus = 'pending' | 'in_progress' | 'tested' | 'skipped'

export function runDetailsStopDisplayStatus(stop: TechnicianWorksheetLocation): RunDetailsStopDisplayStatus {
  if (portalStopHasTestOutcome(stop)) {
    const outcome = (stop.test_outcome || '').trim().toLowerCase()
    if (outcome === 'skipped') return 'skipped'
    return 'tested'
  }
  const rs = (stop.result_status || '').trim().toLowerCase()
  if (rs === 'tested') return 'tested'
  if (rs === 'skipped') return 'skipped'
  if (worksheetLocationIsOpenClockIn(stop)) return 'in_progress'
  return 'pending'
}

export function runDetailsStopStatusLabel(
  status: RunDetailsStopDisplayStatus,
  stop: TechnicianWorksheetLocation,
): string {
  const outcomeLabel = portalOutcomeDisplay(stop)
  if (outcomeLabel && portalStopHasTestOutcome(stop)) return outcomeLabel
  if (status === 'tested') return 'Tested'
  if (status === 'skipped') {
    return worksheetLocationSkipIsAnnual(stop) ? 'Annual skip' : 'Skipped'
  }
  if (status === 'in_progress') return 'In progress'
  return 'Pending'
}

export function runDetailsStopHeaderBandClass(
  stop: TechnicianWorksheetLocation,
  runMonthIso: string,
): string {
  return portalHeaderBandClass(stop, runMonthIso)
}

export function runDetailsStopStatusPillClass(
  stop: TechnicianWorksheetLocation,
  runMonthIso: string,
): string {
  return portalStatusPillClass(stop, runMonthIso)
}

export function runDetailsStopHasTestedOutcome(stop: TechnicianWorksheetLocation): boolean {
  const tone = portalStopVisualTone(stop, '')
  return tone === 'all_good' || tone === 'passed_with_problems' || tone === 'failed'
}

export function runDetailsShowAnnualMonthPill(
  stop: TechnicianWorksheetLocation,
  _runMonthIso: string,
  status: RunDetailsStopDisplayStatus,
): boolean {
  if (runDetailsStopHasTestedOutcome(stop)) return false
  if (status === 'skipped') return worksheetLocationSkipIsAnnual(stop)
  return stopScheduledAnnualAutoSkipActive(stop)
}

export function runDetailsHeaderMonitoringDisplay(stop: TechnicianWorksheetLocation): string {
  return stopMonitoringSummaryLabel(stop)
}

export function runDetailsHeaderPanelDisplay(stop: TechnicianWorksheetLocation): string | null {
  const makeModel = (stop.panel || '').trim()
  const location = (stop.panel_location || '').trim()
  if (makeModel && location) return `${makeModel} - ${location}`
  if (makeModel) return makeModel
  if (location) return location
  return (stop.label || '').trim() || null
}

export function runDetailsSkipReasonDisplay(stop: TechnicianWorksheetLocation): string | null {
  if (runDetailsStopDisplayStatus(stop) === 'skipped') {
    return portalSkipReasonDetail(stop)
  }
  return null
}

export function runDetailsHeaderTimesDisplay(stop: TechnicianWorksheetLocation): string | null {
  const timeIn = (stop.time_in || '').trim()
  const timeOut = (stop.time_out || '').trim()
  if (!timeIn && !timeOut) return null
  const parts: string[] = []
  if (timeIn) parts.push(`IN: ${timeIn}`)
  if (timeOut) parts.push(`OUT: ${timeOut}`)
  return parts.join(' · ')
}
