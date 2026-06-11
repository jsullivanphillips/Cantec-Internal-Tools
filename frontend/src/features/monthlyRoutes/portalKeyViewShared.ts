import type { TechnicianWorksheetLocation } from './monthlyRoutesShared'
import { portalKeyViewOutcomeStatusClass } from './portalWorkflowShared'
import {
  locationPrimaryLabel,
} from './locationDisplay'

export type KeyViewItem = {
  locationId: number
  stopNumber: number
  keyCode: string
  ring: string
  addressLabel: string
  statusClass: string
  isActiveStop: boolean
}

export function buildKeyViewItems(
  stops: TechnicianWorksheetLocation[],
  activeStopId: number | null,
): KeyViewItem[] {
  const ordered = [...stops].sort((a, b) => {
    const aNum = Number.isFinite(a.stop_number) ? a.stop_number : Number.MAX_SAFE_INTEGER
    const bNum = Number.isFinite(b.stop_number) ? b.stop_number : Number.MAX_SAFE_INTEGER
    return aNum - bNum || a.location_id - b.location_id || a.location_id - b.location_id
  })

  return ordered.map((stop) => {
    return {
      locationId: stop.location_id,
      stopNumber: stop.stop_number,
      keyCode: (stop.key_number || '—').trim() || '—',
      ring: (stop.ring || '—').trim() || '—',
      addressLabel: locationPrimaryLabel(stop, { compact: true }),
      statusClass: portalKeyViewOutcomeStatusClass(stop),
      isActiveStop: activeStopId != null && stop.location_id === activeStopId,
    }
  })
}
