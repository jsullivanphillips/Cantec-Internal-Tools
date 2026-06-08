import type { TechnicianWorksheetStop } from './monthlyRoutesShared'
import { portalKeyViewOutcomeStatusClass } from './portalWorkflowShared'
import {
  testingSitePositionAtLocation,
  testingSitePrimaryLabel,
} from './testingSiteDisplay'

export type KeyViewItem = {
  testingSiteId: number
  stopNumber: number
  keyCode: string
  ring: string
  addressLabel: string
  statusClass: string
  isActiveStop: boolean
}

export function buildKeyViewItems(
  stops: TechnicianWorksheetStop[],
  activeStopId: number | null,
): KeyViewItem[] {
  const ordered = [...stops].sort((a, b) => {
    const aNum = Number.isFinite(a.stop_number) ? a.stop_number : Number.MAX_SAFE_INTEGER
    const bNum = Number.isFinite(b.stop_number) ? b.stop_number : Number.MAX_SAFE_INTEGER
    return aNum - bNum || a.location_id - b.location_id || a.testing_site_id - b.testing_site_id
  })

  return ordered.map((stop) => {
    const { siteCount, siteIndex } = testingSitePositionAtLocation(stop, ordered)
    return {
      testingSiteId: stop.testing_site_id,
      stopNumber: stop.stop_number,
      keyCode: (stop.key_number || '—').trim() || '—',
      ring: (stop.ring || '—').trim() || '—',
      addressLabel: testingSitePrimaryLabel(stop, { siteCount, siteIndex, compact: true }),
      statusClass: portalKeyViewOutcomeStatusClass(stop),
      isActiveStop: activeStopId != null && stop.testing_site_id === activeStopId,
    }
  })
}
