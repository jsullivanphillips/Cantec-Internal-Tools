import { apiJson } from '../../lib/apiClient'
import type { TechnicianWorksheetLocation, TechnicianWorksheetPayload } from './monthlyRoutesShared'
import { normalizeWorksheetPayload } from './monthlyRoutesShared'
import { portalKeyViewOutcomeStatusClass } from './portalWorkflowShared'
import {
  locationPrimaryLabel,
} from './locationDisplay'

/** Load worksheet stops for the current route month (library master + open run snapshots). */
export async function fetchRouteKeyViewStops(
  routeId: number,
  monthIso: string,
): Promise<TechnicianWorksheetLocation[]> {
  const qs = new URLSearchParams({ month: monthIso, include_stops: '1' })
  const data = await apiJson<TechnicianWorksheetPayload>(
    `/api/monthly_routes/routes/${routeId}/worksheet?${qs.toString()}`,
  )
  return normalizeWorksheetPayload(data).locations ?? []
}

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
